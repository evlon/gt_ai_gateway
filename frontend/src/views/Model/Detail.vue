<template>
    <div class="model-detail">
        <a-page-header
            title="模型详情"
            @back="handleBack"
        />
        <a-card v-if="model" :loading="loading">
            <a-descriptions :column="1" bordered>
                <a-descriptions-item label="ID">{{ model.id }}</a-descriptions-item>
                <a-descriptions-item label="模型名称">{{ model.name }}</a-descriptions-item>
                <a-descriptions-item label="所属供应商 ID">
                    {{ model.vendor_id }}
                </a-descriptions-item>
                <a-descriptions-item label="状态">
                    <a-tag :color="Boolean(model.enable) ? 'green' : 'red'">
                        {{ Boolean(model.enable) ? '启用' : '禁用' }}
                    </a-tag>
                </a-descriptions-item>
                <a-descriptions-item label="供应商模型">
                    {{ vendorModel?.model_id || '-' }}
                </a-descriptions-item>
                <a-descriptions-item label="支持协议">
                    <template v-if="vendorModel?.allowed_formats?.length">
                        <a-tag v-for="fmt in vendorModel.allowed_formats" :key="fmt" color="blue">
                            {{ fmt }}
                        </a-tag>
                    </template>
                    <span v-else>-</span>
                </a-descriptions-item>
                <a-descriptions-item label="价格">
                    输入: ¥{{ (model.prices?.input || 0).toFixed(6) }} / 千tokens<br/>
                    输出: ¥{{ (model.prices?.output || 0).toFixed(6) }} / 千tokens<br/>
                    缓存读取: ¥{{ (model.prices?.cache_read || 0).toFixed(6) }} / 千tokens
                </a-descriptions-item>
                <a-descriptions-item label="创建时间">
                    {{ formatDate(model.created_at) }}
                </a-descriptions-item>
                <a-descriptions-item label="更新时间">
                    {{ formatDate(model.updated_at) }}
                </a-descriptions-item>
            </a-descriptions>
        </a-card>

        <a-card title="Fallback 供应商模型" :loading="loading" style="margin-top: 16px;">
            <a-empty v-if="fallbacks.length === 0" description="未配置 fallback 备选" />
            <a-table
                v-else
                :data-source="fallbacks"
                :columns="fallbackColumns"
                :pagination="false"
                size="middle"
                row-key="id"
            >
                <template #bodyCell="{ column, record }">
                    <template v-if="column.key === 'index'">
                        {{ fallbackOrder(record) }}
                    </template>
                    <template v-else-if="column.key === 'vendor'">
                        {{ vendorName(record.vendor_id) }}
                    </template>
                    <template v-else-if="column.key === 'model'">
                        {{ vendorModelName(record.vendor_model_id) }}
                    </template>
                </template>
            </a-table>
        </a-card>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getModel, listModelFallbacks } from '@/api/model';
import { fetchVendorModelsByIds, fetchVendorsByIds } from '@/api/vendor';
import { formatDate } from '@/utils/format';
import type { Model, ModelFallback } from '@/types/model';
import type { VendorModel, Vendor as VendorType } from '@/types/vendor';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const model = ref<Model | null>(null);
const vendorModel = ref<VendorModel | null>(null);
const fallbacks = ref<ModelFallback[]>([]);
const vendorsMap = ref<Record<number, VendorType>>({});
const vendorModelsMap = ref<Record<number, VendorModel>>({});

const fallbackColumns = [
    { title: '优先级', key: 'index', width: 80 },
    { title: '备选供应商', key: 'vendor' },
    { title: '备选上游模型', key: 'model' },
];

onMounted(async () => {
    const id = Number(route.params.id);
    if (id) {
        await loadModel(id);
    }
});

function fallbackOrder(record: ModelFallback): number {
    return fallbacks.value.findIndex(fb => fb.id === record.id) + 1;
}

function vendorName(vendorId: number): string {
    return vendorsMap.value[vendorId]?.name ?? `#${vendorId}`;
}

function vendorModelName(vendorModelId: number | null): string {
    if (vendorModelId == null) return '自动（使用模型名称）';
    return vendorModelsMap.value[vendorModelId]?.model_id ?? `#${vendorModelId}`;
}

async function loadModel(id: number) {
    loading.value = true;
    try {
        const m = await getModel(id);
        model.value = m;
        if (m.vendor_model_id) {
            const vms = await fetchVendorModelsByIds([m.vendor_model_id]);
            if (vms && vms.length > 0) {
                vendorModel.value = vms[0] ?? null;
            }
        }

        // 加载 fallback 配置及其供应商/上游模型信息
        const fbs = await listModelFallbacks(id);
        fallbacks.value = fbs || [];

        const vendorIds = [...new Set(fallbacks.value.map(fb => fb.vendor_id))];
        const vendorModelIds = [...new Set(
            fallbacks.value.map(fb => fb.vendor_model_id).filter((x): x is number => x != null),
        )];

        if (vendorIds.length > 0) {
            const vs = await fetchVendorsByIds(vendorIds);
            for (const v of vs) {
                vendorsMap.value[v.id] = v;
            }
        }
        if (vendorModelIds.length > 0) {
            const vms = await fetchVendorModelsByIds(vendorModelIds);
            for (const vm of vms) {
                vendorModelsMap.value[vm.id] = vm;
            }
        }
    } catch (error) {
        console.error('加载模型失败:', error);
    } finally {
        loading.value = false;
    }
}

function handleBack() {
    router.push('/model');
}
</script>

<style scoped>
.model-detail {
    max-width: 800px;
}
</style>
