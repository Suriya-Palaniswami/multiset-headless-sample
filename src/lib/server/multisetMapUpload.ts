import { getMultisetToken } from "./multisetToken";

const V2_BASE = "https://api.multiset.ai/v2";

export type VpsMapSource = {
  provider: "unity" | "matterport" | "leica" | "navvis" | string;
  fileType: "zip" | "e57" | string;
  coordinateSystem: "LHS" | "RHS" | string;
};

export type CreateVpsMapBody = {
  mapName: string;
  fileSize: number;
  coordinates: { latitude: number; longitude: number; altitude: number };
  heading?: number;
  source?: VpsMapSource;
};

export type SignedUrlPart = { partNumber: number; signedUrl: string };

/** Normalized response from POST /v2/vps/map (handles minor key variations). */
export type CreateVpsMapResult = {
  message?: string;
  mapCode: string;
  mapId: string;
  uploadId: string;
  key: string;
  signedUrls: SignedUrlPart[];
};

function normalizeCreateResponse(data: Record<string, unknown>): CreateVpsMapResult {
  const mapId = String(data.mapId ?? data.map_id ?? "");
  const mapCode = String(data.mapCode ?? data.map_code ?? "");
  const key = String(data.key ?? "");
  const uploadUrls = (data.uploadUrls ?? data.upload_urls) as Record<string, unknown> | undefined;
  const uploadId = String(uploadUrls?.uploadId ?? uploadUrls?.upload_id ?? data.uploadId ?? data.upload_id ?? "");
  const raw = (uploadUrls?.signedUrls ?? uploadUrls?.signed_urls ?? data.signedUrls) as unknown;
  const arr = Array.isArray(raw) ? raw : [];
  const signedUrls: SignedUrlPart[] = arr.map((item) => {
    const o = item as Record<string, unknown>;
    return {
      partNumber: Number(o.partNumber ?? o.part_number ?? 0),
      signedUrl: String(o.signedUrl ?? o.signed_url ?? ""),
    };
  });
  if (!mapId || !mapCode || !uploadId || !key || signedUrls.length === 0) {
    throw new Error(`Unexpected create map response shape: ${JSON.stringify(data)}`);
  }
  return {
    message: data.message as string | undefined,
    mapCode,
    mapId,
    uploadId,
    key,
    signedUrls,
  };
}

export async function createVpsMap(body: CreateVpsMapBody): Promise<CreateVpsMapResult> {
  const token = await getMultisetToken();
  const res = await fetch(`${V2_BASE}/vps/map`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Create map failed: ${res.status} ${text}`);
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Create map: invalid JSON: ${text}`);
  }
  return normalizeCreateResponse(data);
}

export type CompleteVpsMapBody = {
  uploadId: string;
  key: string;
  parts: Array<{ ETag: string; PartNumber: number }>;
};

export async function completeVpsMapUpload(mapId: string, body: CompleteVpsMapBody): Promise<unknown> {
  const token = await getMultisetToken();
  const res = await fetch(`${V2_BASE}/vps/map/complete-upload/${encodeURIComponent(mapId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Complete upload failed: ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}
