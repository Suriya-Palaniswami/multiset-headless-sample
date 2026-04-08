import { NextResponse } from "next/server";
import { listMaps } from "@/lib/server/multisetMap";

export async function GET() {
  try {
    const data = await listMaps();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    let hint: string | undefined;
    if (msg.includes("Failed to get Multiset token") || msg.includes("must be set")) {
      hint =
        "Confirm MULTISET_CLIENT_ID and MULTISET_CLIENT_SECRET in .env.local (no extra spaces), then restart `npm run dev`. Server-only vars are not available in the browser.";
    } else if (msg.includes("List maps failed")) {
      hint =
        "Token may be OK but Multiset returned an error listing maps. Check the Multiset dashboard that this M2M client is active, or try again later if the API returns 500.";
    }
    return NextResponse.json({ error: msg, ...(hint ? { hint } : {}) }, { status: 502 });
  }
}
