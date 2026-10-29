import { json, fail } from "@/lib/server/http";
import { generateContent } from "@/lib/server/content-writer.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const token = process.env.OPS_TOKEN;

  if (!token || req.headers.get("x-ops-token") !== token) {
    return fail(401, "Unauthorized");
  }

  const body = await req.json().catch(() => null);

  if (!body || typeof body !== "object" || !body.brief) {
    return fail(400, "A brief is required");
  }

  try {
    const content = await generateContent(body.brief);
    return json({ content });
  } catch (error: any) {
    console.error("Content generation failed:", error.message);
    return fail(500, "Content generation failed");
  }
}
