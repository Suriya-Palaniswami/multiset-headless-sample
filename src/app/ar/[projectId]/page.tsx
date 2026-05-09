"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { PlacementWithAsset } from "@/components/EditorCanvas";
import { apiFetch } from "@/lib/api";
import { captureFrameForLocalization } from "@/lib/ar/xrCapture";
import { solveWorldMapMatrix, type ArAlignMode } from "@/lib/ar/mapPose";
import type { AssetRow, LocalizeResponse, PlacementRow, ProjectRow } from "@/lib/types";

function placementToView(p: PlacementRow, assets: Map<string, AssetRow>): PlacementWithAsset | null {
  const a = assets.get(p.asset_id);
  if (!a) return null;
  return { ...p, public_url: a.public_url };
}

function queryIsRightHanded(): boolean {
  return process.env.NEXT_PUBLIC_VPS_IS_RIGHT_HANDED !== "false";
}

function localizePoseAlignment(): ArAlignMode {
  const raw = process.env.NEXT_PUBLIC_AR_LOCALIZE_POSE_MODE?.trim();
  if (raw === "direct" || raw === "unity" || raw === "lhsReflection" || raw === "invMapCam") return raw;
  return "direct";
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
    else mat?.dispose?.();
  });
}

const assetCache = new Map<string, THREE.Object3D>();

export default function ArPage() {
  const params = useParams();
  const projectId = String(params.projectId ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<string>("Loading project…");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [mapCode, setMapCode] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LocalizeResponse | null>(null);
  const [placements, setPlacements] = useState<PlacementWithAsset[]>([]);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const mapRootRef = useRef<THREE.Group | null>(null);
  const placedRootRef = useRef<THREE.Group | null>(null);
  const xrSessionRef = useRef<XRSession | null>(null);
  const currentMapCodeRef = useRef<string | null>(null);
  const placementsRef = useRef<PlacementWithAsset[]>([]);

  const pushDebug = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString();
    setDebugLines((prev) => [`[${stamp}] ${line}`, ...prev].slice(0, 24));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const pr = await apiFetch(`/api/projects/${projectId}`);
        if (!pr.ok) throw new Error(await pr.text());
        const proj = (await pr.json()) as ProjectRow;
        if (cancelled) return;
        setMapCode(proj.map_code);
        currentMapCodeRef.current = proj.map_code;

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
        if (!cancelled) {
          setPlacements(view);
          placementsRef.current = view;
        }

        setStatus(proj.map_code ? "Start AR, then tap Localize." : "Project has no map code.");
      } catch (e) {
        if (!cancelled) {
          setStatus(e instanceof Error ? e.message : "Failed to load project");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host || rendererRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.appendChild(canvas);

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 8000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
      stencil: false,
    });
    renderer.xr.enabled = true;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    rendererRef.current = renderer;

    const mapRoot = new THREE.Group();
    mapRoot.name = "mapRoot";
    mapRoot.visible = false;
    mapRootRef.current = mapRoot;
    scene.add(mapRoot);

    const placedRoot = new THREE.Group();
    placedRoot.name = "placedObjectsRoot";
    placedRootRef.current = placedRoot;
    mapRoot.add(placedRoot);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 8, 4);
    scene.add(dir);

    const resize = () => {
      const w = Math.max(1, host.clientWidth || window.innerWidth);
      const h = Math.max(1, host.clientHeight || window.innerHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    renderer.setAnimationLoop(() => {
      renderer.render(scene, camera);
    });

    return () => {
      ro.disconnect();
      renderer.setAnimationLoop(null);
      xrSessionRef.current?.end().catch(() => {});
      xrSessionRef.current = null;
      disposeObject(mapRoot);
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      mapRootRef.current = null;
      placedRootRef.current = null;
      if (canvas.parentElement === host) host.removeChild(canvas);
    };
  }, []);

  const loadPlacementsIntoMapRoot = useCallback(async () => {
    const root = placedRootRef.current;
    if (!root) return;
    while (root.children.length) {
      const child = root.children[0];
      root.remove(child);
      disposeObject(child);
    }

    const loader = new GLTFLoader();
    for (const p of placementsRef.current) {
      let proto = assetCache.get(p.public_url);
      if (!proto) {
        const gltf = await loader.loadAsync(p.public_url);
        proto = gltf.scene;
        assetCache.set(p.public_url, proto);
      }
      const obj = proto.clone(true);
      const g = new THREE.Group();
      g.name = p.name;
      g.position.set(p.pos_x, p.pos_y, p.pos_z);
      g.quaternion.set(p.rot_x, p.rot_y, p.rot_z, p.rot_w);
      g.scale.set(p.scale_x, p.scale_y, p.scale_z);
      g.add(obj);
      root.add(g);
    }
    pushDebug(`Loaded ${root.children.length} placement(s) under mapRoot.`);
  }, [pushDebug]);

  const startAr = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const xr = navigator.xr;
    if (!xr) {
      setStatus("WebXR is not available in this browser.");
      return;
    }
    if (xrSessionRef.current) return;

    try {
      const supported = await xr.isSessionSupported("immersive-ar");
      if (!supported) {
        setStatus("Immersive AR is not supported on this device/browser.");
        return;
      }

      renderer.xr.setReferenceSpaceType("local");
      const sessionInit: XRSessionInit & { domOverlay?: { root: Element } } = {
        requiredFeatures: ["camera-access"],
        optionalFeatures: ["local-floor"],
      };
      if (rootRef.current) {
        sessionInit.optionalFeatures = [...(sessionInit.optionalFeatures ?? []), "dom-overlay"];
        sessionInit.domOverlay = { root: rootRef.current };
      }
      const session = await xr.requestSession("immersive-ar", sessionInit);

      session.addEventListener("end", () => {
        xrSessionRef.current = null;
        setSessionActive(false);
        setStatus("AR session ended.");
        if (mapRootRef.current) mapRootRef.current.visible = false;
      });
      session.addEventListener("select", () => {
        void localize();
      });

      await renderer.xr.setSession(session);
      xrSessionRef.current = session;
      setSessionActive(true);
      setStatus("AR active — tap Localize. Screen tap also localizes.");
      pushDebug("WebXR session started (REST localization is still server/API based).");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Camera permission failed";
      setStatus(msg);
      pushDebug(msg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushDebug]);

  const localize = useCallback(async () => {
    const renderer = rendererRef.current;
    const session = xrSessionRef.current;
    const mapCode = currentMapCodeRef.current;
    if (!mapCode || busy) return;
    if (!renderer || !session) {
      setStatus("Start AR first.");
      return;
    }

    const refSpace = renderer.xr.getReferenceSpace();
    if (!refSpace) {
      setStatus("WebXR reference space not ready.");
      return;
    }

    setBusy(true);
    setConfidence(null);
    setLastResult(null);
    try {
      const capture = await captureFrameForLocalization(renderer, session, refSpace, 1280);
      if (!capture) {
        setStatus("Could not capture XR camera frame. Check camera-access support.");
        pushDebug("XR capture failed: no camera texture or viewer pose.");
        return;
      }

      pushDebug(
        `REST query image ${capture.intrinsics.width}x${capture.intrinsics.height} ` +
          `~${Math.round(capture.blob.size / 1024)}KB; ` +
          `fx=${capture.intrinsics.fx.toFixed(1)} fy=${capture.intrinsics.fy.toFixed(1)}`
      );

      const fd = new FormData();
      fd.append("mapCode", mapCode);
      fd.append("fx", String(capture.intrinsics.fx));
      fd.append("fy", String(capture.intrinsics.fy));
      fd.append("px", String(capture.intrinsics.px));
      fd.append("py", String(capture.intrinsics.py));
      fd.append("width", String(capture.intrinsics.width));
      fd.append("height", String(capture.intrinsics.height));
      fd.append("isRightHanded", String(queryIsRightHanded()));
      fd.append("queryImage", capture.blob, "xr-query.jpg");

      const res = await apiFetch("/api/localize", { method: "POST", body: fd });
      const text = await res.text();
      if (!res.ok) {
        setStatus(`Localize failed (${res.status})`);
        pushDebug(text.slice(0, 400));
        return;
      }
      let parsed: LocalizeResponse;
      try {
        parsed = JSON.parse(text) as LocalizeResponse;
      } catch {
        setStatus("Invalid JSON from server");
        return;
      }
      setLastResult(parsed);
      const c = parsed.confidence ?? null;
      setConfidence(c);
      if (parsed.poseFound) {
        await loadPlacementsIntoMapRoot();
        const align = localizePoseAlignment();
        const worldMap = solveWorldMapMatrix(capture.viewerMatrix, parsed, align);
        const mapRoot = mapRootRef.current;
        if (mapRoot) {
          worldMap.decompose(mapRoot.position, mapRoot.quaternion, mapRoot.scale);
          mapRoot.visible = true;
          mapRoot.updateMatrixWorld(true);
        }
        setStatus(`Localized — conf ${(c ?? 0).toFixed(3)} (mapRoot aligned)`);
        pushDebug(`poseFound=${parsed.poseFound} align=${align} mapCodes=${JSON.stringify(parsed.mapCodes)}`);
      } else {
        setStatus("No pose for this frame — try aim, lighting, or another angle.");
        pushDebug("poseFound=false");
      }
    } finally {
      setBusy(false);
    }
  }, [busy, loadPlacementsIntoMapRoot, pushDebug]);

  return (
    <div ref={rootRef} className="relative min-h-screen bg-zinc-950">
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
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">Vanilla WebXR + REST map query</span>
        </div>
        {showDebug ? (
          <div className="pointer-events-auto mt-2 w-full max-w-2xl rounded-lg border border-zinc-700/80 bg-black/70 p-3 text-xs text-zinc-200">
            <p className="mb-2 font-medium text-zinc-100">Log</p>
            <div className="max-h-40 space-y-1 overflow-auto font-mono text-[11px] leading-4">
              {debugLines.length === 0 ? <p className="text-zinc-400">No events yet.</p> : null}
              {debugLines.map((line, idx) => (
                <p key={`${idx}-${line}`} className="text-zinc-300">
                  {line}
                </p>
              ))}
            </div>
            {lastResult ? (
              <pre className="mt-2 max-h-48 overflow-auto rounded border border-zinc-600/50 bg-zinc-900/80 p-2 text-[10px] text-zinc-300">
                {JSON.stringify(lastResult, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="relative min-h-[calc(100vh-56px)]">
        <div ref={canvasHostRef} className="absolute inset-0 bg-black" />
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col p-3">
          <div className="pointer-events-auto max-w-xl rounded-lg bg-black/65 p-3 text-sm text-zinc-200 backdrop-blur">
            <p>
              Multiset localization is still <strong>REST</strong>: WebXR only supplies the local tracking pose
              needed to place <code>mapRoot</code> into browser world space.
            </p>
            {placements.length === 0 ? (
              <p className="mt-2 text-amber-200/90">No placements in this project — add objects in the editor first.</p>
            ) : null}
          </div>
          <div className="pointer-events-auto mt-auto flex flex-wrap items-center justify-center gap-2 pb-8">
            <button
              type="button"
              onClick={() => void startAr()}
              disabled={busy || sessionActive || !mapCode}
              className="rounded-lg border border-zinc-600 bg-black/70 px-4 py-2 text-sm text-zinc-100 shadow hover:bg-zinc-800 disabled:opacity-50"
            >
              {sessionActive ? "AR active" : "Start AR"}
            </button>
            <button
              type="button"
              onClick={() => void localize()}
              disabled={busy || !sessionActive || !mapCode}
              className="rounded-lg bg-violet-600 px-6 py-2 text-sm font-medium text-white shadow hover:bg-violet-500 disabled:opacity-50"
            >
              {busy ? "Querying REST…" : "Localize + Align Map"}
            </button>
          </div>
        </div>
        <div className="absolute bottom-3 left-3 right-3 z-30 flex flex-wrap items-center gap-2 rounded-lg bg-black/65 p-2 backdrop-blur">
          <span className="text-sm text-zinc-300">{status}</span>
          {confidence !== null ? (
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
              conf {confidence.toFixed(3)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
