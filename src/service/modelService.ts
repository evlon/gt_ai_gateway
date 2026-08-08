import { SgModel } from "../model/sgModel";
import { SgModelFallback } from "../model/sgModelFallback";

import { SgVendor } from "../model/sgVendor";
import { SgVendorModel } from "../model/sgVendorModel";
import customError from "../util/customError";


interface FallbackInput {
    id?: number;
    vendor_id: number;
    vendor_model_id?: number | null;
}


async function getModel(modelName: string, enable?: boolean): Promise<SgModel | null> {
    if (modelName == null) return null;

    const query = SgModel.query().where("name", modelName);

    // 如果 enable 参数非空，则按 enable 过滤
    if (enable !== undefined) {
        query.where("enable", enable);
    }

    return await query.first();
}


async function listEnabledModels() {
    const models = await SgModel.query()
        .where("enable", 1)
        .orderBy("id", "asc")
        .get();
    const modelList = models.toArray<SgModel>();
    const vendorIds = [...new Set(modelList.map(model => model.vendor_id as number))];
    const vendorList = vendorIds.length > 0
        ? (await SgVendor.query().whereIn("id", vendorIds).get()).toArray<SgVendor>()
        : [];
    const vendorMap = new Map(vendorList.map(vendor => [vendor.id, vendor]));

    return modelList.map(model => {
        const vendor = vendorMap.get(model.vendor_id!);
        if (!vendor) {
            throw new customError.AppError(`Vendor not found for model ${model.name}`, 500);
        }

        return {
            id: model.name,
            object: "model",
            created: Math.floor(new Date(model.created_at).getTime() / 1000),
            owned_by: vendor.name,
        };
    });
}


async function checkDuplicateEnabledModel(
    name: string,
    excludeId?: number,
): Promise<boolean> {
    const query = SgModel.query()
        .where("name", name)
        .where("enable", 1);
    if (excludeId) {
        query.where("id", "!=", excludeId);
    }
    const existing = await query.first();
    return !!existing;
}


async function updateModel(
    modelId: number,
    data: { name?: string; vendor_id?: number; enable?: boolean; prices?: any; vendor_model_id?: number | null },
): Promise<SgModel | null> {
    const model = await SgModel.query().find(modelId);

    if (!model) {
        return null;
    }

    // Validate vendor_id exists if provided
    if (data.vendor_id !== undefined) {
        const vendor = await SgVendor.query().find(data.vendor_id);
        if (!vendor) {
            return null;
        }
    }

    // Check for duplicate enabled model when enabling or changing name
    const newName = data.name ?? model.name ?? "";
    const newEnable = data.enable !== undefined ? data.enable : model.enable;

    if (newEnable) {
        const isDuplicate = await checkDuplicateEnabledModel(newName, modelId);
        if (isDuplicate) {
            throw new customError.AppError("An enabled model with this name already exists", 409);
        }
    }

    // Note: name, vendor_id, enable, input_price, output_price can be updated. The id cannot be modified.
    const updateData: Record<string, unknown> = {
        name: newName,
        vendor_id: data.vendor_id ?? model.vendor_id,
        enable: newEnable,
    };

    if (data.prices !== undefined) {
        updateData.prices = JSON.stringify(data.prices);
    }

    if ("vendor_model_id" in data) {
        updateData.vendor_model_id = data.vendor_model_id ?? null;
    }

    await SgModel.query()
        .where("id", modelId)
        .update(updateData);

    return await SgModel.query().find(modelId);
}


async function deleteModel(modelId: number): Promise<boolean> {
    const model = await SgModel.query().find(modelId);

    if (!model) {
        return false;
    }

    // 删除模型时同时清理其 fallback 配置
    await SgModelFallback.query().where("model_id", modelId).delete();
    await SgModel.query().where("id", modelId).delete();
    return true;
}


/**
 * 获取某模型的全部 fallback 配置（按 priority 升序）
 */
async function listFallbacks(modelId: number): Promise<SgModelFallback[]> {
    const fallbacks = await SgModelFallback.query()
        .where("model_id", modelId)
        .orderBy("priority", "asc")
        .get();
    return fallbacks.toArray<SgModelFallback>();
}


/**
 * 整体替换某模型的 fallback 配置（先删后建）。
 * fallbacks 为空数组时清空全部配置。
 */
async function saveFallbacks(modelId: number, fallbacks: FallbackInput[]): Promise<SgModelFallback[]> {
    const model = await SgModel.query().find(modelId);
    if (!model) {
        throw new customError.NotFoundError("Model not found");
    }

    const list = Array.isArray(fallbacks) ? fallbacks : [];

    // 校验每个 fallback 引用的 vendor 与 vendor_model 存在
    for (const item of list) {
        const vendor = await SgVendor.query().find(item.vendor_id);
        if (!vendor) {
            throw new customError.AppError(`Vendor ${item.vendor_id} not found`, 400);
        }
        if (item.vendor_model_id != null) {
            const vendorModel = await SgVendorModel.query().find(item.vendor_model_id);
            if (!vendorModel) {
                throw new customError.AppError(`Vendor model ${item.vendor_model_id} not found`, 400);
            }
            if (vendorModel.vendor_id !== item.vendor_id) {
                throw new customError.AppError(
                    `Vendor model ${item.vendor_model_id} does not belong to vendor ${item.vendor_id}`,
                    400,
                );
            }
        }
    }

    // 事务式整体替换：先删旧配置，再按 priority 顺序写入新配置
    await SgModelFallback.query().where("model_id", modelId).delete();

    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        await SgModelFallback.query().create({
            model_id: modelId,
            vendor_id: item.vendor_id,
            vendor_model_id: item.vendor_model_id ?? null,
            priority: i,
        });
    }

    return await listFallbacks(modelId);
}

export default {
    getModel,
    listEnabledModels,
    updateModel,
    deleteModel,
    listFallbacks,
    saveFallbacks,
};
