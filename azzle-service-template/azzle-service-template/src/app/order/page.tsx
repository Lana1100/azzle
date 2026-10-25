import { Suspense } from "react";
import { OrderFlow } from "./order-flow";
import { service } from "@/lib/service";
export const metadata = { title: `${service.copy.orderTitle || "Order"} — ${service.name}` };
export default function Page() {
  return <Suspense><OrderFlow /></Suspense>;
}
