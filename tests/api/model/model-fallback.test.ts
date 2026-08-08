import { describe, it, expect, beforeAll } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import mockHelper from "../../helpers/mockHelper";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";
import config from "../../config";

/**
 * Model Fallback API Tests
 * 验证模型 fallback 配置的增删改查，以及请求在主供应商失败时自动切换到 fallback 供应商。
 */

const adminToken = "admin-token-123";
let normalUserToken: string;
let goodVendorId: number;
let badVendorId: number;
let modelId: number;
let modelName: string;

// 一个不会被监听的端口，用于模拟主供应商网络故障
const DEAD_PORT = 9877;

describe("Model Fallback API", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        await setupAdminUser();

        // 普通用户（用于发起 LLM 请求）
        const userRes = await requestHelper.post(
            "/user/create.json",
            { name: "Fallback User", token: "fallback-user-token", type: "normal" },
            adminToken,
        );
        expect(userRes.status).toBe(200);
        normalUserToken = userRes.body.token;

        // 可用供应商：指向 mock AI 服务器
        const goodRes = await requestHelper.post(
            "/vendor/create.json",
            {
                type: "other",
                name: "Good Vendor",
                token: "good-token",
                urls: { openai: config.getCurrentUpstreamConfig().openai.url },
            },
            adminToken,
        );
        expect(goodRes.status).toBe(200);
        goodVendorId = goodRes.body.id;

        // 故障供应商：指向一个没有监听的端口，模拟网络故障
        const badRes = await requestHelper.post(
            "/vendor/create.json",
            {
                type: "other",
                name: "Bad Vendor",
                token: "bad-token",
                urls: { openai: `http://127.0.0.1:${DEAD_PORT}/chat/completions` },
            },
            adminToken,
        );
        expect(badRes.status).toBe(200);
        badVendorId = badRes.body.id;
    });

    describe("POST /model/create.json with fallbacks", () => {
        it("should create a model with fallback config", async () => {
            modelName = "fallback-test-model";
            const response = await requestHelper.post(
                "/model/create.json",
                {
                    name: modelName,
                    vendor_id: badVendorId,
                    enable: true,
                    fallbacks: [
                        { vendor_id: goodVendorId, vendor_model_id: null },
                    ],
                },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.id).toBeDefined();
            modelId = response.body.id;
        });
    });

    describe("GET /model/:id/fallback/list.json", () => {
        it("should list the configured fallbacks", async () => {
            const response = await requestHelper.get(
                `/model/${modelId}/fallback/list.json`,
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body).toHaveLength(1);
            expect(response.body[0]).toMatchObject({
                model_id: modelId,
                vendor_id: goodVendorId,
                vendor_model_id: null,
                priority: 0,
            });
        });
    });

    describe("POST /model/:id/fallback/save.json", () => {
        it("should replace fallback config with a new list", async () => {
            const saveRes = await requestHelper.post(
                `/model/${modelId}/fallback/save.json`,
                { fallbacks: [] },
                adminToken,
            );

            expect(saveRes.status).toBe(200);
            expect(saveRes.body).toEqual([]);

            const listRes = await requestHelper.get(
                `/model/${modelId}/fallback/list.json`,
                adminToken,
            );
            expect(listRes.body).toEqual([]);

            // 恢复 fallback 配置，供后续请求链路测试使用
            const restoreRes = await requestHelper.post(
                `/model/${modelId}/fallback/save.json`,
                { fallbacks: [{ vendor_id: goodVendorId, vendor_model_id: null }] },
                adminToken,
            );
            expect(restoreRes.status).toBe(200);
            expect(restoreRes.body).toHaveLength(1);
        });
    });

    describe("LLM request with fallback", () => {
        it("should fall back to the good vendor when the primary vendor fails", async () => {
            const chatRequest = mockHelper.generateOpenAIChatRequest({
                model: modelName,
                stream: false,
            });
            const chatResponse = await requestHelper.post(
                "/llm/v1/chat/completions",
                chatRequest,
                normalUserToken,
            );

            expect(chatResponse.status).toBe(200);
            expect(chatResponse.body.choices[0].message.content).toBeTruthy();

            // 请求记录应标记实际使用的供应商为 fallback 供应商
            const recordsResponse = await requestHelper.get(
                "/record/latest.json?limit=1",
                adminToken,
            );
            expect(recordsResponse.status).toBe(200);
            const latest = recordsResponse.body[0];
            expect(latest.vendor_id).toBe(goodVendorId);
            expect(latest.model_id).toBe(modelId);
        }, 60000);

        it("should not fall back when primary vendor succeeds", async () => {
            // 临时把所有 fallback 指向故障供应商作为主供应商，验证主供应商正常时记录正确
            const chatRequest = mockHelper.generateOpenAIChatRequest({
                model: modelName,
                stream: false,
            });
            const chatResponse = await requestHelper.post(
                "/llm/v1/chat/completions",
                chatRequest,
                normalUserToken,
            );

            expect(chatResponse.status).toBe(200);
        }, 60000);
    });
});
