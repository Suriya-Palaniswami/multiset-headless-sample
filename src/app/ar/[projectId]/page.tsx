"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MultisetClient, WebxrController } from "@multisetai/vps";
import { apiFetch } from "@/lib/api";
import type { AssetRow, PlacementRow, ProjectRow } from "@/lib/types";

const PLACED_ROOT_NAME = "placedObjectsRoot";

/** SDK does not expose map root; it lives on the controller instance at runtime. */
function getSdkMeshGroup(controller: WebxrController): THREE.Group | null {
  const w = (controller as unknown as { world?: { meshVisualizer?: { meshGroup?: THREE.Group } } }).world;
  return w?.meshVisualizer?.meshGroup ?? null;
}

function getPublicMultisetCreds(): { clientId: string; clientSecret: string } | null {
  const clientId =
    process.env.NEXT_PUBLIC_MULTISET_CLIENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_MultisetClientId?.trim();
  const clientSecret =
    process.env.NEXT_PUBLIC_MULTISET_CLIENT_SECRET?.trim() ||
    process.env.NEXT_PUBLICMultisetClientSecret?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Loading the full map mesh + Multiset shader on mobile often triggers GPU process OOM ("Aw, Snap").
 * Default: placements-only (showMesh false). SDK still applies transform when showGizmo is true.
 * Set NEXT_PUBLIC_AR_SHOW_MESH=true only on capable desktop / for debugging alignment.
 */
function sdkMeshVisibility(): { showMesh: boolean; showGizmo: boolean } {
  const showMesh = process.env.NEXT_PUBLIC_AR_SHOW_MESH === "true";
  return {
    showMesh,
    /** Required for applyMeshTransform when showMesh is false (see SDK localizeFrame). */
    showGizmo: !showMesh,
  };
}

/**
 * The VPS SDK ties GL buffer cost to window size × pixelRatio. Mobile often hits GPU OOM ("Aw, Snap").
 * Optional: NEXT_PUBLIC_AR_PIXEL_RATIO=0.75 or 1
 */
function arPixelRatioCap(): number {
  const raw = process.env.NEXT_PUBLIC_AR_PIXEL_RATIO?.trim();
  if (raw !== undefined && raw !== "" && !Number.isNaN(Number(raw))) {
    return Math.max(0.5, Math.min(3, Number(raw)));
  }
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const mobileish = coarse || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);
  const cap = mobileish ? 1 : 1.25;
  return Math.min(cap, dpr);
}

function applyRendererPixelRatio(controller: WebxrController, label: string, pushDebug: (s: string) => void) {
  try {
    const pr = arPixelRatioCap();
    controller.getRenderer().setPixelRatio(pr);
    pushDebug(`SDK: ${label} pixelRatio=${pr}`);
  } catch {
    pushDebug(`SDK: ${label} pixelRatio tweak failed`);
  }
}

export default function ArPage() {
  const params = useParams();
  const projectId = String(params.projectId ?? "");
  /** WebXR dom-overlay root — keep subtree small for mobile compositor/GPU. */
  const xrDomOverlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<string>("Initializing…");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);

  const controllerRef = useRef<WebxrController | null>(null);
  const clientRef = useRef<MultisetClient | null>(null);
  const assetCache = useRef<Map<string, THREE.Object3D>>(new Map());
  const placementsLoadedRef = useRef(false);

  const pushDebug = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString();
    setDebugLines((prev) => [`[${stamp}] ${line}`, ...prev].slice(0, 14));
  }, []);

  const loadPlacementsIntoMeshGroup = useCallback(
    async (meshGroup: THREE.Group, placements: PlacementRow[], assets: Map<string, AssetRow>) => {
      let root = meshGroup.getObjectByName(PLACED_ROOT_NAME) as THREE.Group | null;
      if (!root) {
        root = new THREE.Group();
        root.name = PLACED_ROOT_NAME;
        meshGroup.add(root);
      }
      while (root.children.length) root.remove(root.children[0]);

      const loader = new GLTFLoader();
      for (const pl of placements) {
        const asset = assets.get(pl.asset_id);
        if (!asset) continue;
        let proto = assetCache.current.get(asset.id);
        if (!proto) {
          const gltf = await loader.loadAsync(asset.public_url);
          proto = gltf.scene;
          assetCache.current.set(asset.id, proto);
        }
        const inst = proto.clone(true);
        inst.position.set(pl.pos_x, pl.pos_y, pl.pos_z);
        inst.quaternion.set(pl.rot_x, pl.rot_y, pl.rot_z, pl.rot_w);
        inst.scale.set(pl.scale_x, pl.scale_y, pl.scale_z);
        root.add(inst);
      }
      pushDebug(`Loaded ${root.children.length} placement(s) into map root.`);
    },
    [pushDebug]
  );

  useEffect(() => {
    if (!projectId || !containerRef.current || !xrDomOverlayRef.current) return;

    const creds = getPublicMultisetCreds();
    if (!creds) {
      setCredentialError(
        "AR requires Multiset browser credentials. Set NEXT_PUBLIC_MULTISET_CLIENT_ID and " +
          "NEXT_PUBLIC_MULTISET_CLIENT_SECRET (same values as server MULTISET_*). This exposes secrets to the bundle — use a demo key or separate Multiset app for Web-only AR."
      );
      setStatus("Missing public Multiset credentials.");
      pushDebug("No NEXT_PUBLIC_MULTISET_CLIENT_ID / NEXT_PUBLIC_MULTISET_CLIENT_SECRET.");
      return;
    }
    setCredentialError(null);

    const container = containerRef.current;
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    let cancelled = false;

    (async () => {
      try {
        const pr = await apiFetch(`/api/projects/${projectId}`);
        if (!pr.ok) throw new Error(await pr.text());
        const proj = (await pr.json()) as ProjectRow;

        const plRes = await apiFetch(`/api/projects/${projectId}/placements`);
        if (!plRes.ok) throw new Error(await plRes.text());
        const plRows = (await plRes.json()) as PlacementRow[];

        const assetsRes = await apiFetch("/api/assets");
        if (!assetsRes.ok) throw new Error(await assetsRes.text());
        const assetRows = (await assetsRes.json()) as AssetRow[];
        const placementAssetIds = new Set(plRows.map((p) => p.asset_id));
        const scopedAssets = new Map(
          assetRows.filter((a) => placementAssetIds.has(a.id)).map((a) => [a.id, a])
        );

        if (cancelled) return;

        const { showMesh, showGizmo } = sdkMeshVisibility();

        const client = new MultisetClient({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          code: proj.map_code,
          mapType: "map",
          /** Matches @multisetai/vps default FormData (isRightHanded true). */
          isRightHanded: true,
          confidenceCheck: true,
          confidenceThreshold: 0.7,
          showMesh,
          showGizmo,
          autoLocalize: false,
          relocalization: false,
          onLocalizationInit: () => {
            pushDebug("SDK: localization started.");
            setStatus("Localizing…");
          },
          onLocalizationSuccess: (res) => {
            const c = res.localizeData.confidence ?? 0;
            setConfidence(c);
            setStatus(`Localized (SDK) — conf ${c.toFixed(2)}`);
            pushDebug(`SDK: success poseFound=${res.localizeData.poseFound} conf=${c.toFixed(2)}`);
          },
          onLocalizationFailure: (reason) => {
            setConfidence(null);
            setStatus(reason ?? "Localization failed.");
            pushDebug(`SDK: failure — ${reason ?? "unknown"}`);
          },
          onError: (err) => {
            const msg = err instanceof Error ? err.message : String(err);
            pushDebug(`SDK error: ${msg}`);
          },
        });
        clientRef.current = client;

        await client.authorize();
        pushDebug("SDK: authorized.");

        const controller = new WebxrController({
          client,
          canvas,
          overlayRoot: xrDomOverlayRef.current ?? document.body,
          onSessionStart: () => {
            setSessionActive(true);
            pushDebug("SDK: AR session started.");
            setStatus("AR active — tap Localize.");
            applyRendererPixelRatio(controller, "sessionstart", pushDebug);
            const meshGroup = getSdkMeshGroup(controller);
            if (!meshGroup || placementsLoadedRef.current || cancelled) return;
            /** Defer GLTF decode/upload so it does not compete with WebXR session + camera bind (reduces Aw, Snap). */
            window.setTimeout(() => {
              if (cancelled || placementsLoadedRef.current) return;
              void (async () => {
                try {
                  await loadPlacementsIntoMeshGroup(meshGroup, plRows, scopedAssets);
                  placementsLoadedRef.current = true;
                } catch (e) {
                  const msg = e instanceof Error ? e.message : "placement load failed";
                  pushDebug(msg);
                }
              })();
            }, 250);
          },
          onSessionEnd: () => {
            setSessionActive(false);
            setConfidence(null);
            placementsLoadedRef.current = false;
            pushDebug("SDK: AR session ended.");
            setStatus("Session ended.");
          },
        });
        controllerRef.current = controller;

        await controller.initialize(xrDomOverlayRef.current ?? undefined);
        pushDebug("SDK: WebxrController initialized.");
        applyRendererPixelRatio(controller, "post-init", pushDebug);
        pushDebug(`SDK: mesh=${showMesh} gizmo=${showGizmo}`);

        const meshGroup = getSdkMeshGroup(controller);
        if (!meshGroup) {
          pushDebug("Could not find SDK meshGroup — placements not attached.");
        }

        setStatus("Ready — use Start AR in page, then Localize.");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "AR init failed";
        setStatus(msg);
        pushDebug(msg);
      }
    })();

    return () => {
      cancelled = true;
      placementsLoadedRef.current = false;
      controllerRef.current?.dispose();
      controllerRef.current = null;
      clientRef.current = null;
      if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
    };
  }, [projectId, loadPlacementsIntoMeshGroup, pushDebug]);

  async function localize() {
    const ctrl = controllerRef.current;
    if (!ctrl) {
      setStatus("AR not ready.");
      return;
    }
    if (!ctrl.hasActiveSession()) {
      setStatus("Start AR first (browser AR button).");
      pushDebug("Localize blocked: no active WebXR session.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await ctrl.localizeFrame();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "localizeFrame failed";
      setStatus(msg);
      pushDebug(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-zinc-950">
      <div className="relative z-30 border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-2 backdrop-blur-sm">
        <div className="pointer-events-auto flex flex-wrap items-center gap-3">
          <Link href={`/editor/${projectId}`} className="text-sm text-violet-400 hover:underline">
            ← Editor
          </Link>
          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
          >
            {showDebug ? "Hide log" : "Show log"}
          </button>
        </div>
        {credentialError ? (
          <div className="pointer-events-auto mt-2 max-w-2xl rounded-lg border border-amber-800/60 bg-amber-950/40 p-3 text-sm text-amber-100">
            {credentialError}
          </div>
        ) : null}
        {showDebug ? (
          <div className="pointer-events-auto mt-2 w-full max-w-xl rounded-lg border border-zinc-700/80 bg-black/70 p-3 text-xs text-zinc-200">
            <p className="mb-2 font-medium text-zinc-100">AR log</p>
            <div className="max-h-36 space-y-1 overflow-auto">
              {debugLines.length === 0 ? <p className="text-zinc-400">No events yet.</p> : null}
              {debugLines.map((line, idx) => (
                <p key={`${idx}-${line}`} className="font-mono text-[11px] leading-4 text-zinc-300">
                  {line}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div ref={xrDomOverlayRef} className="relative flex min-h-[calc(100vh-4rem)] flex-col">
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col p-3">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg bg-black/55 px-2 py-2 backdrop-blur-sm">
            <span className="max-w-[60vw] truncate text-sm text-zinc-100">{status}</span>
            {confidence !== null ? (
              <span className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                conf {confidence.toFixed(2)}
              </span>
            ) : null}
          </div>
          <div className="pointer-events-auto mt-auto flex justify-center pb-20">
            <button
              type="button"
              onClick={() => void localize()}
              disabled={busy || !sessionActive || !!credentialError}
              className="rounded-lg bg-violet-600 px-6 py-3 text-sm font-medium text-white shadow-lg hover:bg-violet-500 disabled:opacity-50"
            >
              {busy ? "Localizing…" : "Localize"}
            </button>
          </div>
        </div>
        <div ref={containerRef} className="h-[70vh] w-full flex-1 lg:min-h-[480px]" />
      </div>
    </div>
  );
}
