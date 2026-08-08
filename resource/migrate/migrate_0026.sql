-- 模型回退（fallback）配置表
-- 一个网关模型(model)在主供应商之外，可配置多个备选供应商模型。
-- 主通道仍由 model.vendor_id / model.vendor_model_id 表示；备选通道用本表记录。
-- priority 越小越靠前，主供应商失败时按 priority 升序依次尝试。
CREATE TABLE IF NOT EXISTS model_fallback (
    id              INTEGER   NOT NULL PRIMARY KEY AUTOINCREMENT,
    model_id        INTEGER   NOT NULL REFERENCES model(id),
    vendor_id       INTEGER   NOT NULL REFERENCES vendor(id),
    vendor_model_id INTEGER   NULL REFERENCES vendor_model(id),
    priority        INTEGER   NOT NULL DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_fallback_model_priority ON model_fallback (model_id, priority);
CREATE INDEX IF NOT EXISTS idx_model_fallback_model_id ON model_fallback (model_id);
