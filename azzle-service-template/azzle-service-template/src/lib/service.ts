// Typed access to the active service config (src/config/service.mjs) for TS code.
import raw from "@/config/service.mjs";
import type { ServiceConfig, OrderField } from "@/config/service-types";
export const service = raw as unknown as ServiceConfig;
export type { ServiceConfig, OrderField };
export const priceLabel = `$${Number(service.priceUsd).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(service.priceUsd) ? 0 : 2, maximumFractionDigits: 2 })}`;
export const STEPS: string[] = service.steps?.length === 5 ? service.steps : ["Your details", "Check the brief", "Sign in", "Pay", "Review and approve"];
