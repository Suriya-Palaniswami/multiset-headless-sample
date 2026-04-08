import { getMultisetToken } from "./multisetToken";

const MAPS_BASE = "https://api.multiset.ai/v1/vps/map";
const FILE_BASE = "https://api.multiset.ai/v1/file";

export async function multisetFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getMultisetToken();
  return fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers as Record<string, string>),
    },
  });
}

export async function listMaps(): Promise<unknown> {
  const url = new URL(MAPS_BASE);
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", "100");
  const res = await multisetFetch(url.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`List maps failed: ${res.status} ${t}`);
  }
  return res.json();
}

export async function getMapDetails(mapCode: string): Promise<unknown> {
  const res = await multisetFetch(`${MAPS_BASE}/${encodeURIComponent(mapCode)}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Map details failed: ${res.status} ${t}`);
  }
  return res.json();
}

/** Extract mesh file key from Multiset map details (textured preferred). */
export function extractMeshKey(details: Record<string, unknown>): string | null {
  const mesh = details.mapMesh as
    | {
        texturedMesh?: { meshLink?: string };
        rawMesh?: { meshLink?: string };
      }
    | undefined;
  const textured = mesh?.texturedMesh?.meshLink;
  const raw = mesh?.rawMesh?.meshLink;
  return textured || raw || null;
}

export async function getFileDownloadUrl(key: string): Promise<string> {
  const res = await multisetFetch(`${FILE_BASE}?key=${encodeURIComponent(key)}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`File URL failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) {
    throw new Error("File response missing url");
  }
  return data.url;
}
