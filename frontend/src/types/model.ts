import type { BaseEntity, TableQuery } from './index';

export interface ModelFallback extends BaseEntity {
    model_id: number;
    vendor_id: number;
    vendor_model_id: number | null;
    priority: number;
}

export interface ModelFallbackInput {
    id?: number;
    vendor_id: number;
    vendor_model_id?: number | null;
}

export interface Model extends BaseEntity {
    name: string;
    vendor_id: number;
    vendor_model_id: number | null;
    enable: boolean;
    prices?: {
        input?: number;
        output?: number;
        cache_read?: number;
    } | null;
}

export interface CreateModelRequest {
    name: string;
    vendor_id: number;
    enable?: boolean;
    prices?: {
        input?: number;
        output?: number;
        cache_read?: number;
    } | null;
    vendor_model_id?: number | null;
    fallbacks?: ModelFallbackInput[];
}

export interface UpdateModelRequest {
    name?: string;
    vendor_id?: number;
    enable?: boolean;
    prices?: {
        input?: number;
        output?: number;
        cache_read?: number;
    } | null;
    vendor_model_id?: number | null;
    fallbacks?: ModelFallbackInput[];
}

export interface ModelQuery extends TableQuery {
    vendor_id?: number;
}
