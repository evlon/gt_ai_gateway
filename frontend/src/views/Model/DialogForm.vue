<template>
    <a-modal
        v-model:open="visible"
        :title="isEdit ? '编辑模型' : '新建模型'"
        @cancel="handleCancel"
        :confirm-loading="loading"
    >
        <template #footer>
            <div class="modal-footer">
                <a-button :disabled="!formState.vendor_id" @click="handleTest">测试连通性</a-button>
                <div>
                    <a-button @click="handleCancel">Cancel</a-button>
                    <a-button type="primary" :loading="loading" @click="handleOk">OK</a-button>
                </div>
            </div>
        </template>
        <a-form
            :model="formState"
            :rules="rules"
            layout="vertical"
            ref="formRef"
        >
            <a-form-item label="模型名称" name="name">
                <a-input v-model:value="formState.name" placeholder="请输入模型名称" />
            </a-form-item>
            <a-form-item label="所属供应商" name="vendor_id">
                <a-select
                    v-model:value="formState.vendor_id"
                    placeholder="请选择供应商"
                    :loading="vendorsLoading"
                    @change="handleVendorChange"
                >
                    <a-select-option
                        v-for="vendor in vendors"
                        :key="vendor.id"
                        :value="vendor.id"
                    >
                        {{ vendor.name }}
                    </a-select-option>
                </a-select>
            </a-form-item>
            <a-form-item label="上游模型" name="vendor_model_id">
                <a-select
                    v-model:value="formState.vendor_model_id"
                    placeholder="自动（使用模型名称）"
                    :loading="vendorModelsLoading"
                    allow-clear
                    :disabled="!formState.vendor_id"
                >
                    <a-select-option
                        v-for="vm in vendorModels"
                        :key="vm.id"
                        :value="vm.id"
                    >
                        {{ vm.model_id }}
                    </a-select-option>
                </a-select>
            </a-form-item>

            <div class="fallback-section">
                <div class="fallback-header">
                    <span class="fallback-title">Fallback 供应商模型</span>
                    <a-tooltip title="主供应商请求失败（网络异常 / 5xx / 429）时，将按顺序切换到以下备选供应商重试。留空则不启用回退。">
                        <InfoCircleOutlined style="font-size: 12px; color: #999; margin-left: 4px;" />
                    </a-tooltip>
                </div>
                <a-empty
                    v-if="formState.fallbacks.length === 0"
                    :image="simpleImage"
                    description="暂无备选，点击下方按钮添加"
                    style="padding: 8px 0;"
                />
                <div
                    v-for="(item, index) in formState.fallbacks"
                    :key="index"
                    class="fallback-row"
                >
                    <div class="fallback-row-index">{{ index + 1 }}</div>
                    <a-select
                        v-model:value="item.vendor_id"
                        class="fallback-row-vendor"
                        placeholder="备选供应商"
                        :loading="isFallbackVendorLoading(item.vendor_id)"
                        @change="handleFallbackVendorChange(index)"
                    >
                        <a-select-option
                            v-for="vendor in vendors"
                            :key="vendor.id"
                            :value="vendor.id"
                        >
                            {{ vendor.name }}
                        </a-select-option>
                    </a-select>
                    <a-select
                        v-model:value="item.vendor_model_id"
                        class="fallback-row-model"
                        placeholder="自动（使用模型名称）"
                        allow-clear
                        :loading="isFallbackVendorLoading(item.vendor_id)"
                        :disabled="!item.vendor_id"
                    >
                        <a-select-option
                            v-for="vm in getFallbackVendorModels(item.vendor_id)"
                            :key="vm.id"
                            :value="vm.id"
                        >
                            {{ vm.model_id }}
                        </a-select-option>
                    </a-select>
                    <div class="fallback-row-actions">
                        <a-button
                            size="small"
                            type="text"
                            :disabled="index === 0"
                            @click="moveFallbackUp(index)"
                        >
                            <ArrowUpOutlined />
                        </a-button>
                        <a-button
                            size="small"
                            type="text"
                            :disabled="index === formState.fallbacks.length - 1"
                            @click="moveFallbackDown(index)"
                        >
                            <ArrowDownOutlined />
                        </a-button>
                        <a-button size="small" type="text" danger @click="removeFallback(index)">
                            <DeleteOutlined />
                        </a-button>
                    </div>
                </div>
                <a-button type="dashed" block class="fallback-add" @click="addFallback">
                    <PlusOutlined />
                    添加 Fallback
                </a-button>
            </div>

            <a-form-item label="状态" name="enable">
                <a-switch v-model:checked="formState.enable" />
            </a-form-item>
            <SettingsCollapse v-if="moduleBillingEnabled" v-model:activeKey="billingExpanded" panel-key="billing" header="价格设置">
                <div class="settings-row">
                    <label class="settings-label">
                        输入价格
                        <a-tooltip title="输入token的计费价格 (元/千tokens)">
                            <InfoCircleOutlined style="font-size: 12px; color: #999; margin-left: 4px;" />
                        </a-tooltip>
                    </label>
                    <div style="flex: 1">
                        <a-input-number
                            v-model:value="formState.prices.input"
                            placeholder="请输入输入价格"
                            :min="0"
                            :precision="6"
                            style="width: 100%"
                        />
                    </div>
                </div>
                <div class="settings-row">
                    <label class="settings-label">
                        输出价格
                        <a-tooltip title="输出token的计费价格 (元/千tokens)">
                            <InfoCircleOutlined style="font-size: 12px; color: #999; margin-left: 4px;" />
                        </a-tooltip>
                    </label>
                    <div style="flex: 1">
                        <a-input-number
                            v-model:value="formState.prices.output"
                            placeholder="请输入输出价格"
                            :min="0"
                            :precision="6"
                            style="width: 100%"
                        />
                    </div>
                </div>
                <div class="settings-row">
                    <label class="settings-label">
                        缓存读取价格
                        <a-tooltip title="缓存命中时读取token的计费价格 (元/千tokens)">
                            <InfoCircleOutlined style="font-size: 12px; color: #999; margin-left: 4px;" />
                        </a-tooltip>
                    </label>
                    <div style="flex: 1">
                        <a-input-number
                            v-model:value="formState.prices.cache_read"
                            placeholder="请输入缓存读取价格"
                            :min="0"
                            :precision="6"
                            style="width: 100%"
                        />
                    </div>
                </div>
            </SettingsCollapse>
        </a-form>
    </a-modal>

    <DialogTest ref="testDialogRef" />
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import type { FormInstance } from 'ant-design-vue/es';
import { InfoCircleOutlined, PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons-vue';
import { createModel, updateModel, listModelFallbacks } from '@/api/model';
import { listVendors, listVendorModels } from '@/api/vendor';
import { getConfig } from '@/api/config';
import SettingsCollapse from '@/components/common/SettingsCollapse.vue';
import type { Model, ModelFallbackInput } from '@/types/model';
import type { Vendor as VendorType, VendorModel } from '@/types/vendor';
import { normalizeListResponse } from '@/utils/listResponse';
import { notifyError, notifyRequestError, notifySuccess } from '@/utils/requestFeedback';
import DialogTest from '@/views/Vendor/DialogTest.vue';
import { Empty } from 'ant-design-vue';

const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE;

const emit = defineEmits<{
    success: [model: Model];
}>();

const visible = ref(false);
const loading = ref(false);
const formRef = ref<FormInstance>();
const billingExpanded = ref<string[]>([]);
const testDialogRef = ref<InstanceType<typeof DialogTest>>();

const isEdit = ref(false);
const currentId = ref<number>(0);

const formState = reactive({
    name: '',
    vendor_id: undefined as number | undefined,
    vendor_model_id: undefined as number | undefined,
    enable: true,
    fallbacks: [] as ModelFallbackInput[],
    prices: {
        input: undefined as number | undefined,
        output: undefined as number | undefined,
        cache_read: undefined as number | undefined,
    },
});

const rules = {
    name: [{ required: true, message: '请输入模型名称' }],
    vendor_id: [{ required: true, message: '请选择供应商' }],
};

const vendors = ref<VendorType[]>([]);
const vendorsLoading = ref(false);
const moduleBillingEnabled = ref(false);
const vendorModels = ref<VendorModel[]>([]);
const vendorModelsLoading = ref(false);

// fallback 行的供应商模型缓存：vendorId -> VendorModel[]，以及加载中状态
const fallbackVendorModelsMap = reactive<Record<number, VendorModel[]>>({});
const fallbackVendorLoading = reactive<Record<number, boolean>>({});

const upstreamModelName = computed(() => {
    if (formState.vendor_model_id) {
        return vendorModels.value.find(vm => vm.id === formState.vendor_model_id)?.model_id ?? formState.name;
    }
    return formState.name;
});

async function loadVendors() {
    vendorsLoading.value = true;
    try {
        vendors.value = normalizeListResponse(await listVendors({ page: 1, pageSize: 1000 })).list;
    } catch (error) {
        notifyRequestError(error, '加载供应商列表失败');
    } finally {
        vendorsLoading.value = false;
    }
}

async function loadVendorModels(vendorId: number) {
    vendorModelsLoading.value = true;
    try {
        vendorModels.value = await listVendorModels(vendorId);
    } catch (error) {
        vendorModels.value = [];
    } finally {
        vendorModelsLoading.value = false;
    }
}

function handleVendorChange(vendorId: number) {
    formState.vendor_model_id = undefined;
    vendorModels.value = [];
    if (vendorId) {
        void loadVendorModels(vendorId);
    }
}

// ---- Fallback 相关逻辑 ----

function getFallbackVendorModels(vendorId: number | undefined): VendorModel[] {
    if (!vendorId) return [];
    if (!fallbackVendorModelsMap[vendorId]) {
        void loadFallbackVendorModels(vendorId);
    }
    return fallbackVendorModelsMap[vendorId] ?? [];
}

function isFallbackVendorLoading(vendorId: number | undefined): boolean {
    return !!vendorId && !!fallbackVendorLoading[vendorId];
}

async function loadFallbackVendorModels(vendorId: number) {
    fallbackVendorLoading[vendorId] = true;
    try {
        fallbackVendorModelsMap[vendorId] = await listVendorModels(vendorId);
    } catch (error) {
        fallbackVendorModelsMap[vendorId] = [];
    } finally {
        fallbackVendorLoading[vendorId] = false;
    }
}

function handleFallbackVendorChange(index: number) {
    const item = formState.fallbacks[index];
    if (item) {
        item.vendor_model_id = undefined;
        if (item.vendor_id) {
            void loadFallbackVendorModels(item.vendor_id);
        }
    }
}

function addFallback() {
    formState.fallbacks.push({
        vendor_id: undefined as any,
        vendor_model_id: undefined,
    });
}

function removeFallback(index: number) {
    formState.fallbacks.splice(index, 1);
}

function moveFallbackUp(index: number) {
    if (index <= 0) return;
    const arr = formState.fallbacks;
    const removed = arr.splice(index, 1);
    if (removed.length === 0) return;
    arr.splice(index - 1, 0, removed[0]!);
}

function moveFallbackDown(index: number) {
    const arr = formState.fallbacks;
    if (index >= arr.length - 1) return;
    const removed = arr.splice(index, 1);
    if (removed.length === 0) return;
    arr.splice(index + 1, 0, removed[0]!);
}

function handleTest() {
    const vendor = vendors.value.find(v => v.id === formState.vendor_id);
    if (!vendor) return;
    const vendorModelName = formState.vendor_model_id
        ? (vendorModels.value.find(vm => vm.id === formState.vendor_model_id)?.model_id ?? null)
        : null;
    testDialogRef.value?.open(vendor, upstreamModelName.value || undefined, {
        modelName: formState.name,
        vendorModelName,
    });
}

function openCreate() {
    isEdit.value = false;
    currentId.value = 0;
    billingExpanded.value = [];
    formState.fallbacks = [];
    void loadVendors();
    getConfig().then(config => {
        moduleBillingEnabled.value = config.module_billing_enabled === 'true';
    });
    visible.value = true;
}

async function openEdit(model: Model) {
    isEdit.value = true;
    currentId.value = model.id;
    billingExpanded.value = [];
    formState.name = model.name;
    formState.vendor_id = model.vendor_id;
    formState.vendor_model_id = model.vendor_model_id ?? undefined;
    formState.enable = Boolean(model.enable);
    formState.fallbacks = [];
    formState.prices = {
        input: model.prices?.input || undefined,
        output: model.prices?.output || undefined,
        cache_read: model.prices?.cache_read || undefined,
    };
    void loadVendors();
    if (model.vendor_id) {
        void loadVendorModels(model.vendor_id);
    }
    // 加载已有 fallback 配置
    try {
        const fallbacks = await listModelFallbacks(model.id);
        formState.fallbacks = (fallbacks || []).map(fb => ({
            vendor_id: fb.vendor_id,
            vendor_model_id: fb.vendor_model_id ?? undefined,
        }));
        // 预加载 fallback 供应商的模型列表
        for (const fb of formState.fallbacks) {
            if (fb.vendor_id) {
                void loadFallbackVendorModels(fb.vendor_id);
            }
        }
    } catch (error) {
        console.error('加载 fallback 配置失败:', error);
    }
    getConfig().then(config => {
        moduleBillingEnabled.value = config.module_billing_enabled === 'true';
    });
    visible.value = true;
}

function buildFallbackPayload(): ModelFallbackInput[] {
    return formState.fallbacks
        .filter(item => !!item.vendor_id)
        .map(item => ({
            vendor_id: item.vendor_id,
            vendor_model_id: item.vendor_model_id ?? null,
        }));
}

async function handleOk() {
    try {
        await formRef.value?.validate();
        loading.value = true;

        if (isEdit.value) {
            const model = await updateModel(currentId.value, {
                ...formState,
                vendor_model_id: formState.vendor_model_id ?? null,
                fallbacks: buildFallbackPayload(),
            });
            notifySuccess('更新成功');
            emit('success', model);
        } else {
            if (formState.vendor_id === undefined) {
                notifyError('请选择供应商');
                return;
            }
            const model = await createModel({
                name: formState.name,
                vendor_id: formState.vendor_id,
                enable: formState.enable,
                vendor_model_id: formState.vendor_model_id ?? null,
                fallbacks: buildFallbackPayload(),
                prices: {
                    input: formState.prices.input ?? undefined,
                    output: formState.prices.output ?? undefined,
                    cache_read: formState.prices.cache_read ?? undefined,
                },
            });
            notifySuccess('创建成功');
            emit('success', model);
        }
        handleCancel();
    } catch (error) {
        notifyRequestError(isEdit.value ? '更新失败' : '创建失败');
    } finally {
        loading.value = false;
    }
}

function handleCancel() {
    visible.value = false;
    isEdit.value = false;
    currentId.value = 0;
    formState.name = '';
    formState.vendor_id = undefined;
    formState.vendor_model_id = undefined;
    formState.enable = true;
    formState.fallbacks = [];
    formState.prices = {
        input: undefined,
        output: undefined,
        cache_read: undefined,
    };
    vendorModels.value = [];
}

defineExpose({ openCreate, openEdit });
</script>

<style scoped>
.modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
}

.modal-footer > div {
    display: flex;
    gap: 8px;
}

.fallback-section {
    margin-bottom: 20px;
    padding: 12px;
    background: #fafafa;
    border: 1px solid #f0f0f0;
    border-radius: 8px;
}

.fallback-header {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 500;
    color: #333;
}

.fallback-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}

.fallback-row-index {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: #1677ff;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
}

.fallback-row-vendor {
    flex: 1;
}

.fallback-row-model {
    flex: 1;
}

.fallback-row-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
}

.fallback-add {
    margin-top: 4px;
}
</style>
