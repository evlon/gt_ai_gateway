import { ApiFormat } from "../constants";
import { SgModel } from "../model/sgModel";
import { SgVendor } from "../model/sgVendor";
import { SgVendorModel } from "../model/sgVendorModel";
import customError from "../util/customError";
import modelService from "./modelService";
import recordService from "./recordService";


/**
 * 一次候选（供应商模型）通道。
 */
interface Candidate {
    vendor: SgVendor;
    vendorModel: SgVendorModel | null;
}


interface LlmRequestContext {
    modelConfig: SgModel;
    /** 主供应商，向后兼容（等于 candidates[0].vendor） */
    vendor: SgVendor;
    /** 候选列表，首位为主供应商，其后为 fallback */
    candidates: Candidate[];
}


async function resolveContext(
    userId: number,
    modelName: string,
    body: string,
    format: ApiFormat,
): Promise<LlmRequestContext> {
    const modelConfig = await modelService.getModel(modelName, true);
    if (modelConfig == null) {
        await recordService.recordFailedRequest(userId, modelName, body, format, "model_not_found");
        throw new customError.NotFoundError("model not found");
    }

    const vendor = await SgVendor.query().find(modelConfig.vendor_id!);
    if (vendor == null) {
        await recordService.recordFailedRequest(
            userId,
            modelName,
            body,
            format,
            "vendor_not_found",
            modelConfig.id,
            modelConfig.vendor_id,
        );
        throw new customError.NotFoundError("vendor not found");
    }

    // 构建候选列表：首位为主供应商，其后为 fallback 备选
    const candidates: Candidate[] = [];

    let primaryVendorModel: SgVendorModel | null = null;
    if (modelConfig.vendor_model_id != null) {
        primaryVendorModel = await SgVendorModel.query().find(modelConfig.vendor_model_id);
    }
    candidates.push({ vendor, vendorModel: primaryVendorModel });

    // fallback 备选通道
    const fallbacks = await modelService.listFallbacks(modelConfig.id);
    for (const fb of fallbacks) {
        const fbVendor = await SgVendor.query().find(fb.vendor_id);
        if (!fbVendor) continue;
        let fbVendorModel: SgVendorModel | null = null;
        if (fb.vendor_model_id != null) {
            fbVendorModel = await SgVendorModel.query().find(fb.vendor_model_id);
        }
        candidates.push({ vendor: fbVendor, vendorModel: fbVendorModel });
    }

    return { modelConfig, vendor, candidates };
}

export default { resolveContext };
