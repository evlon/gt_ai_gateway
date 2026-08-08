import { Model } from "sutando";
import { inspect, InspectOptions } from "util";

class SgModelFallback extends Model {
    table = "model_fallback";

    id!: number;
    model_id!: number;
    vendor_id!: number;
    vendor_model_id!: number | null;
    priority!: number;

    created_at!: Date;
    updated_at!: Date;

    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

export { SgModelFallback };
