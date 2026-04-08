"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { ProjectRow } from "@/lib/types";

export default function MapDetailClient() {
  const params = useParams();
  const mapCode = decodeURIComponent(String(params.mapCode ?? ""));
  const searchParams = useSearchParams();
  const router = useRouter();
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProjects = useCallback(async () => {
    const res = await apiFetch("/api/projects");
    if (!res.ok) return;
    const all = (await res.json()) as ProjectRow[];
    setProjects(all.filter((p) => p.map_code === mapCode));
  }, [mapCode]);

  useEffect(() => {
    if (!mapCode) return;
    (async () => {
      try {
        const res = await apiFetch(`/api/maps/${encodeURIComponent(mapCode)}`);
        if (!res.ok) throw new Error(await res.text());
        setDetails(await res.json());
        await refreshProjects();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load map");
      } finally {
        setLoading(false);
      }
    })();
  }, [mapCode, refreshProjects]);

  useEffect(() => {
    const open = searchParams.get("open");
    if (!open || !details || loading) return;
    const status = String(details.status ?? "").toLowerCase();
    if (status !== "active") return;

    const latest = [...projects].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )[0];

    if (open === "editor") {
      if (latest) router.replace(`/editor/${latest.id}`);
      return;
    }
    if (open === "ar") {
      if (latest) router.replace(`/ar/${latest.id}`);
    }
  }, [searchParams, details, projects, loading, router]);

  const name = details ? String(details.mapName ?? mapCode) : mapCode;
  const status = details ? String(details.status ?? "—") : "—";
  const isActive = String(details?.status ?? "").toLowerCase() === "active";

  async function createProject() {
    const label = prompt("Project name", `${name} project`);
    if (!label?.trim()) return;
    const res = await apiFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: label.trim(), map_code: mapCode }),
    });
    if (!res.ok) {
      alert(await res.text());
      return;
    }
    const p = (await res.json()) as ProjectRow;
    await refreshProjects();
    router.push(`/editor/${p.id}`);
  }

  function openLatestEditor() {
    const latest = [...projects].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )[0];
    if (latest) router.push(`/editor/${latest.id}`);
    else createProject();
  }

  function openLatestAr() {
    const latest = [...projects].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )[0];
    if (latest) router.push(`/ar/${latest.id}`);
    else alert("Create a project first.");
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/maps" className="text-sm text-violet-400 hover:text-violet-300">
        ← Maps
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">{name}</h1>
      <p className="mt-1 font-mono text-sm text-zinc-500">{mapCode}</p>
      {loading ? <p className="mt-6 text-zinc-400">Loading…</p> : null}
      {error ? (
        <p className="mt-6 text-red-400">{error}</p>
      ) : (
        <div className="mt-6 space-y-2 text-sm">
          <p>
            <span className="text-zinc-500">Status:</span> {status}
          </p>
          {!isActive ? (
            <p className="text-amber-200/90">Editor and AR are only available when the map is active.</p>
          ) : null}
        </div>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={createProject}
          disabled={!isActive}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          Create project
        </button>
        <button
          type="button"
          onClick={openLatestEditor}
          disabled={!isActive}
          className="rounded-lg bg-zinc-800 px-4 py-2 text-sm disabled:opacity-40"
        >
          Open latest in editor
        </button>
        <button
          type="button"
          onClick={openLatestAr}
          disabled={!isActive}
          className="rounded-lg border border-violet-500/40 px-4 py-2 text-sm text-violet-200 disabled:opacity-40"
        >
          Open in AR
        </button>
      </div>
      {projects.length > 0 ? (
        <div className="mt-10">
          <h2 className="mb-3 text-lg font-medium">Projects</h2>
          <ul className="space-y-2">
            {projects.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
              >
                <span>{p.name}</span>
                <div className="flex gap-2">
                  <Link href={`/editor/${p.id}`} className="text-sm text-violet-400 hover:underline">
                    Editor
                  </Link>
                  <Link href={`/ar/${p.id}`} className="text-sm text-violet-400 hover:underline">
                    AR
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
