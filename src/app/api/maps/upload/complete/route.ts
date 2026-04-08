import { NextResponse } from "next/server";
import { completeVpsMapUpload, type CompleteVpsMapBody } from "@/lib/server/multisetMapUpload";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{ mapId: string } & CompleteVpsMapBody>;
    if (!body.mapId || typeof body.mapId !== "string") {
      return NextResponse.json({ error: "mapId is required" }, { status: 400 });
    }
    if (!body.uploadId || !body.key || !Array.isArray(body.parts) || body.parts.length === 0) {
      return NextResponse.json({ error: "uploadId, key, and non-empty parts[] are required" }, { status: 400 });
    }

    const result = await completeVpsMapUpload(body.mapId, {
      uploadId: body.uploadId,
      key: body.key,
      parts: body.parts.map((p) => ({
        ETag: String(p.ETag ?? (p as { etag?: string }).etag ?? ""),
        PartNumber: Number(p.PartNumber ?? (p as { partNumber?: number }).partNumber ?? 0),
      })),
    });
    return NextResponse.json(result ?? { ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
