import { OrderStatus } from "./order-status";
import { service } from "@/lib/service";
export const metadata = { title: `Your order — ${service.name}`, robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderStatus id={id} />;
}
