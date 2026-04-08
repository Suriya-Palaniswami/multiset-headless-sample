const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
const EDITOR_KEY = process.env.NEXT_PUBLIC_EDITOR_SHARED_KEY ?? "";

export function apiUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const base = API_BASE || (typeof window !== "undefined" ? "" : "http://localhost:3000");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "x-editor-key": EDITOR_KEY,
      ...(init?.headers as Record<string, string>),
    },
  });
}

export function normalizeMapList(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data as Record<string, unknown>[];
    if (Array.isArray(o.maps)) return o.maps as Record<string, unknown>[];
    if (Array.isArray(o.items)) return o.items as Record<string, unknown>[];
  }
  return [];
}
