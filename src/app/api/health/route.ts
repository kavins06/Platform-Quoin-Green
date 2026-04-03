import { NextResponse } from "next/server";
import { getPlatformRuntimeHealth } from "@/server/lib/runtime-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getPlatformRuntimeHealth();

  return NextResponse.json(
    health,
    { status: health.status === "ok" ? 200 : 503 },
  );
}
