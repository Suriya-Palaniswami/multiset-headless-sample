import { clearMultisetTokenCache, getMultisetToken } from "./multisetToken";

const MAPS_BASE = "https://api.multiset.ai/v1/vps/map";
const FILE_BASE = "https://api.multiset.ai/v1/file";

export async function multisetFetch(path: string, init?: RequestInit): Promise<Response> {
  let token = await getMultisetToken();
  let res = await fetch(path, {
    ...init,
    // /v1/file returns short-lived presigned URLs; never cache upstream responses.
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers as Record<string, string>),
    },
  });
  if (res.status !== 401) return res;

  // One retry with a forced token refresh handles stale cached tokens.
  clearMultisetTokenCache();
  token = await getMultisetToken(true);
  res = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers as Record<string, string>),
    },
  });
  return res;
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

function extractObjectKeyFromMaybeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    // Mesh links can be full presigned URLs. The stable object key is the URL path.
    return decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  } catch {
    return trimmed;
  }
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
  const candidate = textured || raw || null;
  if (!candidate) return null;
  return extractObjectKeyFromMaybeUrl(candidate);
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
