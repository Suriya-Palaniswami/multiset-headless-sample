import { NextResponse } from "next/server";
import {
  extractMeshKey,
  getMapDetails,
  getFileDownloadUrl,
} from "@/lib/server/multisetMap";

type Params = { params: { mapCode: string } };

export async function GET(_request: Request, context: Params) {
  try {
    const { mapCode } = context.params;
    const details = (await getMapDetails(mapCode)) as Record<string, unknown>;
    const key = extractMeshKey(details);
    if (!key) {
      return NextResponse.json(
        { error: "No mesh key found in map details (mapMesh.*.meshLink)" },
        { status: 404 }
      );
    }
    const url = await getFileDownloadUrl(key);
    return NextResponse.json({ url, meshKey: key });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
