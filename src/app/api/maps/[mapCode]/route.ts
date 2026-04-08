import { NextResponse } from "next/server";
import { getMapDetails } from "@/lib/server/multisetMap";

type Params = { params: { mapCode: string } };

export async function GET(_request: Request, context: Params) {
  try {
    const { mapCode } = context.params;
    const data = await getMapDetails(mapCode);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
