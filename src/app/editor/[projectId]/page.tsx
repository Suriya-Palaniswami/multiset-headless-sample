"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { AssetRow, PlacementRow, ProjectRow } from "@/lib/types";
import { useEditorStore } from "@/lib/editorStore";
import type { PlacementWithAsset } from "@/components/EditorCanvas";

const EditorCanvas = dynamic(() => import("@/components/EditorCanvas"), { ssr: false });

function placementToView(p: PlacementRow, assets: Map<string, AssetRow>): PlacementWithAsset | null {
  const a = assets.get(p.asset_id);
  if (!a) return null;
  return {
    ...p,
    public_url: a.public_url,
  };
}

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params.projectId ?? "");
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  const [placements, setPlacements] = useState<PlacementWithAsset[]>([]);
  const [mapActive, setMapActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const transformMode = useEditorStore((s) => s.transformMode);
  const setSelectedPlacementId = useEditorStore((s) => s.setSelectedPlacementId);
  const setMode = useEditorStore((s) => s.setTransformMode);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const pr = await apiFetch(`/api/projects/${projectId}`);
      if (!pr.ok) throw new Error(await pr.text());
      const p = (await pr.json()) as ProjectRow;
      setProject(p);

      const md = await apiFetch(`/api/maps/${encodeURIComponent(p.map_code)}`);
      if (!md.ok) throw new Error(await md.text());
      const mapDetails = (await md.json()) as Record<string, unknown>;
      const status = String(mapDetails.status ?? "").toLowerCase();
      setMapActive(status === "active");
      if (status !== "active") {
        setMeshUrl(null);
      } else {
        const urlRes = await apiFetch(`/api/maps/${encodeURIComponent(p.map_code)}/download-mesh-url`);
        if (urlRes.ok) {
          const { url } = (await urlRes.json()) as { url: string };
          setMeshUrl(url);
        } else {
          setMeshUrl(null);
        }
      }

      const plRes = await apiFetch(`/api/projects/${projectId}/placements`);
      if (!plRes.ok) throw new Error(await plRes.text());
      const plRows = (await plRes.json()) as PlacementRow[];

      const assetsRes = await apiFetch("/api/assets");
      if (!assetsRes.ok) throw new Error(await assetsRes.text());
      const assetRows = (await assetsRes.json()) as AssetRow[];
      const assetMap = new Map(assetRows.map((a) => [a.id, a]));

      const view: PlacementWithAsset[] = [];
      for (const row of plRows) {
        const v = placementToView(row, assetMap);
        if (v) view.push(v);
      }
      setPlacements(view);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function importGlb(file: File) {
    if (!projectId || !project) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", file.name);
    const res = await apiFetch("/api/assets", { method: "POST", body: fd });
    if (!res.ok) {
      alert(await res.text());
      return;
    }
    const asset = (await res.json()) as { id: string; public_url: string; filename: string; name: string };
    const name = `Object ${placements.length + 1}`;
    const plRes = await apiFetch(`/api/projects/${projectId}/placements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset_id: asset.id,
        name,
        pos_x: 0,
        pos_y: 0,
        pos_z: 0,
        rot_x: 0,
        rot_y: 0,
        rot_z: 0,
        rot_w: 1,
        scale_x: 1,
        scale_y: 1,
        scale_z: 1,
      }),
    });
    if (!plRes.ok) {
      alert(await plRes.text());
      return;
    }
    const row = (await plRes.json()) as PlacementRow;
    setPlacements((prev) => [
      ...prev,
      { ...row, public_url: asset.public_url },
    ]);
  }

  async function onSave() {
    setSaving(true);
    try {
      for (const pl of placements) {
        await apiFetch(`/api/projects/${projectId}/placements/${pl.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pos_x: pl.pos_x,
            pos_y: pl.pos_y,
            pos_z: pl.pos_z,
            rot_x: pl.rot_x,
            rot_y: pl.rot_y,
            rot_z: pl.rot_z,
            rot_w: pl.rot_w,
            scale_x: pl.scale_x,
            scale_y: pl.scale_y,
            scale_z: pl.scale_z,
          }),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  const selectedId = useEditorStore((s) => s.selectedPlacementId);
  const selected = placements.find((x) => x.id === selectedId);

  async function deleteSelected() {
    if (!selectedId || !projectId) return;
    await apiFetch(`/api/projects/${projectId}/placements/${selectedId}`, { method: "DELETE" });
    setPlacements((p) => p.filter((x) => x.id !== selectedId));
    setSelectedPlacementId(null);
  }

  function updateSelectedFromInspector(field: keyof PlacementRow, value: number) {
    if (!selectedId) return;
    setPlacements((prev) =>
      prev.map((p) => (p.id === selectedId ? { ...p, [field]: value } : p))
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/maps" className="text-sm text-zinc-400 hover:text-zinc-200">
            ← Maps
          </Link>
          {project ? (
            <span className="text-sm text-zinc-300">
              {project.name} <span className="text-zinc-500">({project.map_code})</span>
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">
            Import GLB
            <input
              type="file"
              accept=".glb"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importGlb(f);
                e.target.value = "";
              }}
            />
          </label>
          <div className="flex rounded-lg border border-zinc-700 p-0.5">
            {(["translate", "rotate", "scale"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded px-2 py-1 text-xs capitalize ${
                  transformMode === m ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/ar/${projectId}`)}
            className="rounded-lg border border-violet-500/50 px-3 py-1.5 text-sm text-violet-200 disabled:opacity-40"
            disabled={!mapActive}
          >
            Open AR
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="flex-1 min-h-[50vh]">
          {loading ? (
            <div className="flex h-[50vh] items-center justify-center text-zinc-500">Loading editor…</div>
          ) : error ? (
            <div className="p-6 text-red-400">{error}</div>
          ) : (
            <EditorCanvas
              meshUrl={meshUrl}
              projectId={projectId}
              placements={placements}
              onPlacementsChange={setPlacements}
            />
          )}
        </div>
        <aside className="w-full border-t border-zinc-800 bg-zinc-900/50 p-4 lg:w-80 lg:border-l lg:border-t-0">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Inspector</h2>
          {!selected ? (
            <p className="text-sm text-zinc-500">Select a placed object to edit transforms.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="font-mono text-xs text-zinc-500">{selected.name}</p>
              <div className="grid grid-cols-[4rem_1fr] gap-2">
                {(["pos_x", "pos_y", "pos_z"] as const).map((k) => (
                  <label key={k} className="col-span-2 grid grid-cols-subgrid items-center gap-2">
                    <span className="text-zinc-500">{k}</span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1"
                      value={selected[k]}
                      onChange={(e) => updateSelectedFromInspector(k, parseFloat(e.target.value) || 0)}
                    />
                  </label>
                ))}
                {(["rot_x", "rot_y", "rot_z", "rot_w"] as const).map((k) => (
                  <label key={k} className="col-span-2 grid grid-cols-subgrid items-center gap-2">
                    <span className="text-zinc-500">{k}</span>
                    <input
                      type="number"
                      step="0.001"
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1"
                      value={selected[k]}
                      onChange={(e) => updateSelectedFromInspector(k, parseFloat(e.target.value) || 0)}
                    />
                  </label>
                ))}
                {(["scale_x", "scale_y", "scale_z"] as const).map((k) => (
                  <label key={k} className="col-span-2 grid grid-cols-subgrid items-center gap-2">
                    <span className="text-zinc-500">{k}</span>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1"
                      value={selected[k]}
                      onChange={(e) => updateSelectedFromInspector(k, parseFloat(e.target.value) || 0)}
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={deleteSelected}
                className="mt-4 rounded-lg border border-red-900/50 px-3 py-1.5 text-red-300 hover:bg-red-950/40"
              >
                Delete
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
