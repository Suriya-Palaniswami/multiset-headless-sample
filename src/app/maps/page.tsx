"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, normalizeMapList } from "@/lib/api";

export default function MapsPage() {
  const [maps, setMaps] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/maps");
        if (!res.ok) {
          const text = await res.text();
          try {
            const j = JSON.parse(text) as { error?: string; hint?: string };
            throw new Error([j.error, j.hint].filter(Boolean).join("\n\n") || text);
          } catch (err) {
            if (err instanceof SyntaxError) throw new Error(text);
            throw err;
          }
        }
        const raw = await res.json();
        setMaps(normalizeMapList(raw));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load maps");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Maps</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/maps/upload"
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium hover:bg-violet-500"
          >
            Upload scan
          </Link>
          <p className="text-sm text-zinc-500">From your Multiset account</p>
        </div>
      </div>
      {loading ? <p className="text-zinc-400">Loading maps…</p> : null}
      {error ? (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-4 text-amber-200">
          <p className="font-medium">Could not load maps</p>
          <p className="mt-1 text-sm opacity-90">{error}</p>
          <p className="mt-2 whitespace-pre-wrap text-xs text-amber-200/70">
            If the message mentions the token or missing env vars, check `.env.local` and restart the dev server. A 500 from
            Multiset with credentials set is usually an account/API issue on their side—verify your M2M client in the
            Multiset dashboard.
          </p>
        </div>
      ) : null}
      {!loading && !error && maps.length === 0 ? (
        <p className="text-zinc-400">
          No maps yet.{" "}
          <Link href="/maps/upload" className="text-violet-400 hover:underline">
            Upload a scan
          </Link>{" "}
          or use the Multiset mobile app.
        </p>
      ) : null}
      <ul className="mt-6 space-y-3">
        {maps.map((m, i) => {
          const code = String(m.mapCode ?? m.map_code ?? "");
          const name = String(m.mapName ?? m.map_name ?? m.name ?? (code || "Untitled"));
          const status = String(m.status ?? "—");
          const updated = String(m.updatedAt ?? m.updated_at ?? "—");
          const key = code || `map-${i}`;
          return (
            <li
              key={key}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3"
            >
              <div>
                <p className="font-medium">{name}</p>
                <p className="text-xs text-zinc-500">
                  {code} · {status} · {updated}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/maps/${encodeURIComponent(code)}`}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"
                >
                  Details
                </Link>
                {code ? (
                  <Link
                    href={`/maps/${encodeURIComponent(code)}?open=editor`}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm hover:bg-violet-500"
                  >
                    Open in Editor
                  </Link>
                ) : null}
                {code ? (
                  <Link
                    href={`/maps/${encodeURIComponent(code)}?open=ar`}
                    className="rounded-lg border border-violet-500/50 px-3 py-1.5 text-sm text-violet-300 hover:bg-violet-950/50"
                  >
                    Open AR
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
