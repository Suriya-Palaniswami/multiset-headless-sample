import { NextResponse } from "next/server";
import { extractMeshKey, getFileDownloadUrl, getMapDetails } from "@/lib/server/multisetMap";

export const dynamic = "force-dynamic";

type Params = { params: { mapCode: string } };

/**
 * Same-origin GLB stream for the editor (and any client loader). Direct S3 presigned URLs
 * typically block browser fetches from Netlify origins (CORS).
 */
export async function GET(_request: Request, context: Params) {
  try {
    const { mapCode } = context.params;
    const details = (await getMapDetails(mapCode)) as Record<string, unknown>;
    const key = extractMeshKey(details);
    if (!key) {
      return NextResponse.json({ error: "No mesh key in map details" }, { status: 404 });
    }
    const presigned = await getFileDownloadUrl(key);
    const upstream = await fetch(presigned, { cache: "no-store" });
    if (!upstream.ok) {
      const t = await upstream.text();
      return NextResponse.json({ error: `Upstream mesh fetch failed: ${upstream.status}`, detail: t }, { status: 502 });
    }
    const blob = await upstream.blob();
    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
