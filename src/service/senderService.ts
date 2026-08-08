import { Context } from "hono";
import { SgModel } from "../model/sgModel";
import { SgUser } from "../model/sgUser";
import { SgVendor } from "../model/sgVendor";
import { SgVendorModel } from "../model/sgVendorModel";
import recordService from "./recordService";
import { SgRecordStatus, ApiFormat, VendorAuthMode } from "../constants";
import pluginService from "./pluginService";
import hostService from "./hostService";
import { ConverterFactory } from "../util/protocolConverter/ConverterFactory";
import type { BaseConverter } from "../util/protocolConverter/BaseConverter";
import customError from "../util/customError";
import protocolUtils from "../util/protocolUtils";
import streamLogService from "./streamLogService";
import responseHandlerService from "./responseHandlerService";
import fetchUtil from "../util/fetchUtil";


/**
 * 一次候选（供应商模型）通道。
 * vendorModel 为 null 时表示自动按网关模型名匹配该供应商下的上游模型。
 */
interface Candidate {
    vendor: SgVendor;
    vendorModel: SgVendorModel | null;
}


/**
 * attemptUpstream 的返回结果。
 * retry=false 表示可立即返回给客户端的终态响应（成功或 4xx 业务错误）；
 * retry=true 表示发生了可回退失败（网络异常或上游 5xx/429），应由外层切换到下一候选重试。
 */
type AttemptResult =
    | { retry: false; response: Response }
    | { retry: true; status: number | null; errorText: string; contentType: string | null; error?: unknown };


/**
 * 判断某次失败是否可回退：
 * - 网络异常（fetch 抛错）可回退；
 * - 上游返回 5xx / 429 可回退；
 * - 客户端主动断开（AbortError）不可回退。
 */
function isRetryableFetchError(e: any): boolean {
    if (e?.name === "AbortError") return false;
    return true;
}


/**
 * 解析候选通道的上游模型名与支持格式。
 */
async function resolveVendorModelInfo(
    candidate: Candidate,
    modelConfig: SgModel,
): Promise<{ vendorModelName: string | null; supportedFormats: ApiFormat[] }> {
    let vendorModelName: string | null = null;
    let supportedFormats: ApiFormat[] = [];

    if (candidate.vendorModel) {
        vendorModelName = candidate.vendorModel.model_id;
        supportedFormats = candidate.vendorModel.getSupportedFormats() ?? [];
    } else {
        // 自动模式：根据网关模型名称自动匹配该供应商下的上游模型
        vendorModelName = modelConfig.name;
        const matchedVendorModel = await SgVendorModel.query()
            .where("vendor_id", candidate.vendor.id)
            .where("model_id", modelConfig.name)
            .first();
        if (matchedVendorModel) {
            supportedFormats = matchedVendorModel.getSupportedFormats() ?? [];
        }
    }

    // 如果 vendorModel 未配置限制格式，使用 vendor 支持的格式
    if (supportedFormats.length === 0) {
        supportedFormats = candidate.vendor.getSupportedFormats() ?? [];
    }

    return { vendorModelName, supportedFormats };
}


/**
 * 对单个候选通道构建并发送上游请求。
 * 若为终态（成功或 4xx 业务错误）返回 retry=false 的响应；
 * 若为可回退失败（网络异常 / 5xx / 429）返回 retry=true，交由外层重试。
 */
async function attemptUpstream(
    c: Context,
    user: SgUser,
    modelConfig: SgModel,
    candidate: Candidate,
    format: ApiFormat,
    body: string,
    record: any,
): Promise<AttemptResult> {
    const { vendor, vendorModel } = candidate;

    const { vendorModelName, supportedFormats } = await resolveVendorModelInfo(candidate, modelConfig);

    // 根据客户端请求的格式和 vendor/vendorModel 支持的格式，计算最终应该用什么格式
    const upstreamFormat = protocolUtils.resolveUpstreamFormat(format, supportedFormats);
    const needsConversion = format !== upstreamFormat;

    const url = vendor.getUrlByFormat(upstreamFormat);

    // 2. 构建上游请求 headers，过滤掉 Cloudflare 注入的 cf- 前缀 header
    const finalHeaders = new Headers();
    const EXCLUDED_HEADERS = [
        "authorization",
        "x-api-key",
        "anthropic-version",
        "content-length",
        "host",
        "origin",
        "referer",
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ];

    for (const [key, value] of c.req.raw.headers.entries()) {
        const lowerKey = key.toLowerCase();
        if (
            !lowerKey.startsWith("cf-") &&
            !lowerKey.startsWith("sec-") &&
            !EXCLUDED_HEADERS.includes(lowerKey)
        ) {
            finalHeaders.set(key, value);
        }
    }

    if (upstreamFormat === ApiFormat.ANTHROPIC) {
        if (vendor.config.auth_mode === VendorAuthMode.BEARER_TOKEN) {
            finalHeaders.set("Authorization", vendor.token.startsWith("Bearer ") ? vendor.token : `Bearer ${vendor.token}`);
        } else {
            finalHeaders.set("x-api-key", vendor.token);
            finalHeaders.set("anthropic-version", "2023-06-01");
        }
    } else {
        finalHeaders.set("Authorization", vendor.token.startsWith("Bearer ") ? vendor.token : `Bearer ${vendor.token}`);
    }

    // 强制设置 content-type
    finalHeaders.set("Content-Type", "application/json");

    // 3. 替换上游模型名：若候选配置了具体 vendor_model，用其上游模型名替换请求体中的 model 字段
    let upstreamBody = body;
    if (vendorModel) {
        try {
            const bodyJson = JSON.parse(upstreamBody);
            bodyJson.model = vendorModel.model_id;
            upstreamBody = JSON.stringify(bodyJson);
        } catch (e) {
            console.log("[senderService] Failed to substitute model name:", e);
        }
    }

    // 4. 应用插件 (转换前)
    const hostKey = await hostService.getHostKey();
    upstreamBody = await pluginService.applyRequestPlugins(upstreamBody, format, hostKey, user.name);

    let converter: BaseConverter | null = null;
    if (needsConversion) {
        converter = ConverterFactory.create(format, upstreamFormat);
        if (!converter) {
            throw new customError.AppError(
                `Unsupported protocol conversion: ${format} → ${upstreamFormat}`,
                400,
            );
        }
        console.log(`[senderService] Using protocol converter: ${converter.constructor.name}, client=${format}, upstream=${upstreamFormat}`);
        upstreamBody = converter.convertRequestBody(upstreamBody);
    }

    let requestModel = "unknown";
    try {
        const parsedBody = JSON.parse(upstreamBody);
        requestModel = parsedBody.model || "unknown";
    } catch (e) {}
    converter?.updateModel(requestModel);

    // 5. OpenAI 流式请求注入 stream_options，让上游在最后一帧返回 usage
    if (upstreamFormat === ApiFormat.OPENAI) {
        try {
            const bodyJson = JSON.parse(upstreamBody);
            if (bodyJson.stream === true) {
                bodyJson.stream_options = { include_usage: true };
                upstreamBody = JSON.stringify(bodyJson);
            }
        } catch (e) {
            console.log("Failed to inject stream_options:", e);
        }
    }

    // 6. 应用插件 (转换后)
    if (needsConversion) {
        upstreamBody = await pluginService.applyRequestPlugins(upstreamBody, upstreamFormat, hostKey, user.name);
    }

    await streamLogService.writeRequestLog(record, upstreamBody);

    // 7. 发起上游请求
    let upstreamRes: Response;
    try {
        const dispatcher = await fetchUtil.getDispatcher(vendor.config);
        upstreamRes = await fetch(url, {
            method: "POST",
            headers: finalHeaders,
            body: upstreamBody,
            signal: c.req.raw.signal,
            ...(dispatcher ? { dispatcher: dispatcher } as any : {}),
        });
    } catch (e: any) {
        console.error("Upstream fetch failed:", e);
        if (!isRetryableFetchError(e)) {
            throw e;
        }
        return {
            retry: true,
            status: null,
            errorText: String(e),
            contentType: null,
            error: e,
        };
    }

    console.log("upstream response status:", upstreamRes.status, "vendor:", vendor.name);

    // 非 2xx 响应：5xx / 429 视为可回退，其余（4xx 业务错误）直接返回给客户端
    if (!upstreamRes.ok) {
        if (upstreamRes.status === 429 || upstreamRes.status >= 500) {
            const errorText = await upstreamRes.text();
            return {
                retry: true,
                status: upstreamRes.status,
                errorText,
                contentType: upstreamRes.headers.get("content-type"),
            };
        }

        // 4xx 业务错误：不回退，交由响应处理器标记失败并返回给客户端
        return {
            retry: false,
            response: format === ApiFormat.RESPONSES
                ? await responseHandlerService.handleResponsesNonStreamResponse(c, upstreamRes, record, modelConfig, user, converter, upstreamFormat)
                : await responseHandlerService.handleChatNonStreamResponse(c, upstreamRes, record, modelConfig, user, format, upstreamFormat, converter),
        };
    }

    const isStream =
        upstreamRes.ok &&
        upstreamRes.headers.get("content-type")?.startsWith("text/event-stream");

    // 8. 按响应类型分发处理（成功响应，或已建立流后不再回退）
    if (format === ApiFormat.RESPONSES) {
        return {
            retry: false,
            response: isStream
                ? await responseHandlerService.handleResponsesStreamResponse(c, upstreamRes, record, modelConfig, user, converter, upstreamFormat)
                : await responseHandlerService.handleResponsesNonStreamResponse(c, upstreamRes, record, modelConfig, user, converter, upstreamFormat),
        };
    }

    return {
        retry: false,
        response: isStream
            ? await responseHandlerService.handleChatStreamResponse(c, upstreamRes, record, modelConfig, user, format, upstreamFormat, converter)
            : await responseHandlerService.handleChatNonStreamResponse(c, upstreamRes, record, modelConfig, user, format, upstreamFormat, converter),
    };
}


async function sendRequest(
    c: Context,
    user: SgUser,
    modelConfig: SgModel,
    candidates: Candidate[],
    format: ApiFormat,
    body: string,
): Promise<Response> {
    const list = candidates.length > 0 ? candidates : [];

    // 无候选时直接报错（正常情况不会发生）
    if (list.length === 0) {
        throw new customError.AppError("No upstream candidate available", 502);
    }

    const primary = list[0];
    const primaryInfo = await resolveVendorModelInfo(primary, modelConfig);
    const primaryUpstreamFormat = protocolUtils.resolveUpstreamFormat(format, primaryInfo.supportedFormats);

    // 1. 创建数据库记录（先按主通道创建，回退时更新实际使用的供应商信息）
    const record = await recordService.create(
        user.id,
        modelConfig.id,
        body,
        format,
        primaryUpstreamFormat,
        primary.vendor.id,
        primaryInfo.vendorModelName,
    );
    await recordService.update(record.id, {
        status: SgRecordStatus.PROCESSING,
        start_at: new Date(),
    });

    let lastRetryable: { status: number | null; errorText: string; contentType: string | null; error?: unknown } | null = null;

    for (let i = 0; i < list.length; i++) {
        const candidate = list[i];

        // 切换到非主候选时，更新记录中实际使用的供应商信息
        if (i > 0) {
            const info = await resolveVendorModelInfo(candidate, modelConfig);
            const upstreamFormat = protocolUtils.resolveUpstreamFormat(format, info.supportedFormats);
            await recordService.update(record.id, {
                vendor_id: candidate.vendor.id,
                vendor_model_name: info.vendorModelName,
                upstream_format: upstreamFormat !== format ? upstreamFormat : null,
            });
        }

        const result = await attemptUpstream(c, user, modelConfig, candidate, format, body, record);

        if (result.retry) {
            console.warn(
                `[senderService] candidate ${i} (vendor=${candidate.vendor.name}) failed, falling back: ${result.errorText}`,
            );
            lastRetryable = result;
            continue;
        }

        return result.response;
    }

    // 所有候选均失败
    console.error("[senderService] All upstream candidates failed, last error:", lastRetryable?.errorText);

    await recordService.update(record.id, {
        status: SgRecordStatus.FAILED,
        response_data: lastRetryable?.errorText ?? null,
        end_at: new Date(),
    });

    // 网络异常：抛出原始错误，交给全局错误处理返回 500
    if (lastRetryable?.status == null) {
        throw lastRetryable?.error ?? new Error(lastRetryable?.errorText ?? "All upstream candidates failed");
    }

    // 上游 5xx/429：将最后一个错误响应返回给客户端
    const lastStatus = lastRetryable.status as number;
    c.status(lastStatus as any);
    if (lastRetryable.contentType) {
        c.res.headers.set("Content-Type", lastRetryable.contentType);
    }
    return c.body(lastRetryable.errorText);
}


export default {
    sendRequest,
};
