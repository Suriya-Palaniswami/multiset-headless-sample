import { NextResponse } from "next/server";
import { getMultisetToken } from "@/lib/server/multisetToken";
import type { LocalizeResponse } from "@/lib/types";

const QUERY_FORM = "https://api.multiset.ai/v1/vps/map/query-form";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let formData: FormData;

    if (contentType.includes("application/json")) {
      const json = (await request.json()) as {
        mapCode?: string;
        cameraIntrinsics?: { fx: number; fy: number; px: number; py: number };
        resolution?: { width: number; height: number };
        isRightHanded?: boolean;
        queryImage?: string;
      };
      if (!json.mapCode) {
        return NextResponse.json({ error: "mapCode required" }, { status: 400 });
      }
      formData = new FormData();
      formData.append("mapCode", json.mapCode);
      const intr = json.cameraIntrinsics;
      const res = json.resolution;
      if (!intr || !res) {
        return NextResponse.json({ error: "cameraIntrinsics and resolution required for JSON body" }, { status: 400 });
      }
      formData.append("fx", String(intr.fx));
      formData.append("fy", String(intr.fy));
      formData.append("px", String(intr.px));
      formData.append("py", String(intr.py));
      formData.append("width", String(res.width));
      formData.append("height", String(res.height));
      formData.append("isRightHanded", String(json.isRightHanded ?? false));

      if (json.queryImage?.startsWith("data:")) {
        const base64 = json.queryImage.split(",")[1];
        if (!base64) {
          return NextResponse.json({ error: "Invalid queryImage data URL" }, { status: 400 });
        }
        const buf = Buffer.from(base64, "base64");
        formData.append("queryImage", new Blob([buf]), "frame.jpg");
      } else {
        return NextResponse.json({ error: "queryImage must be a data URL" }, { status: 400 });
      }
    } else {
      formData = await request.formData();
    }

    const token = await getMultisetToken();
    const res = await fetch(QUERY_FORM, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: text || res.statusText }, { status: res.status });
    }
    let parsed: LocalizeResponse;
    try {
      parsed = JSON.parse(text) as LocalizeResponse;
    } catch {
      return NextResponse.json({ error: "Invalid JSON from Multiset" }, { status: 502 });
    }
    return NextResponse.json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
