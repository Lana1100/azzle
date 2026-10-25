import { OpsDashboard } from "./ops-dashboard";
import { service } from "@/lib/service";
export const metadata = { title: `Ops — ${service.name}`, robots: { index: false } };
export default function Page() { return <OpsDashboard />; }
