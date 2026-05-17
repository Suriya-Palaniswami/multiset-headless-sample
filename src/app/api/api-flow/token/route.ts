import { NextResponse } from "next/server";
import { getMultisetToken } from "@/lib/server/multisetToken";

export const dynamic = "force-dynamic";

const UPSTREAM_ENDPOINT = "https://api.multiset.ai/v1/m2m/token";

function redactToken(token: string): string {
  if (token.length <= 14) {
    return "<redacted>";
  }

  return `${token.slice(0, 7)}...${token.slice(-6)}`;
}

export async function POST() {
  const startedAt = Date.now();

  try {
    const token = await getMultisetToken(true);

    return NextResponse.json({
      upstreamEndpoint: UPSTREAM_ENDPOINT,
      method: "POST",
      status: 200,
      durationMs: Date.now() - startedAt,
      response: {
        token: redactToken(token),
        tokenLength: token.length,
        note: "Bearer token redacted before sending this debug response to the browser.",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        upstreamEndpoint: UPSTREAM_ENDPOINT,
        method: "POST",
        status: 502,
        durationMs: Date.now() - startedAt,
        error: message,
      },
      { status: 502 },
    );
  }
}
