"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { apiFetch } from "@/lib/api";
import type { AssetRow, LocalizeResponse, PlacementRow, ProjectRow } from "@/lib/types";
import { captureFrameForLocalization } from "@/lib/ar/xrCapture";

const CONFIDENCE_MIN = 0.7;

function multisetLhsPoseToThreeRhsMatrix(position: THREE.Vector3, rotation: THREE.Quaternion): THREE.Matrix4 {
  const lhs = new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(1, 1, 1));
  // Reflection matrix to convert LHS<->RHS by flipping Z.
  const s = new THREE.Matrix4().makeScale(1, 1, -1);
  return new THREE.Matrix4().multiplyMatrices(s, lhs).multiply(s);
}

export default function ArPage() {
  const params = useParams();
  const projectId = String(params.projectId ?? "");
  const pageRootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>("Initializing…");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [mapCode, setMapCode] = useState<string>("");
  const [sessionActive, setSessionActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [localized, setLocalized] = useState(false);
  const [localizeCount, setLocalizeCount] = useState(0);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const mapRootRef = useRef<THREE.Group | null>(null);
  const sessionRef = useRef<XRSession | null>(null);
  const refSpaceRef = useRef<XRReferenceSpace | null>(null);
  const assetCache = useRef<Map<string, THREE.Object3D>>(new Map());
  const arButtonRef = useRef<HTMLButtonElement | null>(null);
  const localizeByTapRef = useRef<(() => void) | null>(null);

  const pushDebug = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString();
    setDebugLines((prev) => [`[${stamp}] ${line}`, ...prev].slice(0, 12));
  }, []);

  const loadScene = useCallback(
    async (proj: ProjectRow, placements: PlacementRow[], assets: Map<string, AssetRow>) => {
      setMapCode(proj.map_code);
      pushDebug(`Project loaded. mapCode=${proj.map_code}`);
      const scene = sceneRef.current;
      const mapRoot = mapRootRef.current;
      if (!scene || !mapRoot) return;

      while (mapRoot.children.length) {
        mapRoot.remove(mapRoot.children[0]);
      }

      const placedRoot = new THREE.Group();
      placedRoot.name = "placedObjectsRoot";
      mapRoot.add(placedRoot);

      // Visual helpers so successful localization is obvious in-camera.
      const axis = new THREE.AxesHelper(0.6);
      axis.name = "debugAxis";
      mapRoot.add(axis);
      const originMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0a6b82, emissiveIntensity: 0.7 })
      );
      originMarker.name = "debugOriginMarker";
      mapRoot.add(originMarker);

      const loader = new GLTFLoader();
      for (const pl of placements) {
        const asset = assets.get(pl.asset_id);
        if (!asset) continue;
        let root = assetCache.current.get(asset.id);
        if (!root) {
          const gltf = await loader.loadAsync(asset.public_url);
          root = gltf.scene;
          assetCache.current.set(asset.id, root);
        }
        const inst = root.clone(true);
        inst.position.set(pl.pos_x, pl.pos_y, pl.pos_z);
        inst.quaternion.set(pl.rot_x, pl.rot_y, pl.rot_z, pl.rot_w);
        inst.scale.set(pl.scale_x, pl.scale_y, pl.scale_z);
        placedRoot.add(inst);
      }
      setStatus("Ready — start AR, then localize.");
      pushDebug("Scene loaded. Waiting for AR session.");
    },
    [pushDebug]
  );

  useEffect(() => {
    if (!projectId || !containerRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.xr.enabled = true;
    renderer.setAnimationLoop(() => {
      renderer.render(scene, camera);
    });
    rendererRef.current = renderer;

    const mapRoot = new THREE.Group();
    mapRoot.name = "mapRoot";
    mapRoot.visible = false;
    scene.add(mapRoot);
    mapRootRef.current = mapRoot;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));

    const container = containerRef.current;
    container.appendChild(renderer.domElement);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    onResize();
    window.addEventListener("resize", onResize);

    const overlayRoot = pageRootRef.current ?? document.body;
    const arBtn = ARButton.createButton(renderer, {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["local-floor", "dom-overlay", "camera-access"],
      domOverlay: { root: overlayRoot },
    });
    arBtn.style.position = "fixed";
    arBtn.style.bottom = "24px";
    arBtn.style.left = "50%";
    arBtn.style.transform = "translateX(-50%)";
    arBtn.style.zIndex = "40";
    arBtn.style.display = "none";
    document.body.appendChild(arBtn);
    arButtonRef.current = arBtn as HTMLButtonElement;
    pushDebug("AR launcher initialized.");

    renderer.xr.addEventListener("sessionstart", async () => {
      const session = renderer.xr.getSession();
      sessionRef.current = session;
      setSessionActive(true);
      if (session) {
        refSpaceRef.current = await session.requestReferenceSpace("local");
        const onSelect = () => {
          pushDebug("XR select event: tap detected, attempting localization.");
          localizeByTapRef.current?.();
        };
        session.addEventListener("select", onSelect);
        (session as XRSession & { __onSelectLocalize?: () => void }).__onSelectLocalize = onSelect;
      }
      setStatus("Session active — tap Localize button (or tap screen if controls are hidden).");
      pushDebug("AR session started. If controls disappear, tap screen to localize.");
    });
    renderer.xr.addEventListener("sessionend", () => {
      const s = sessionRef.current as (XRSession & { __onSelectLocalize?: () => void }) | null;
      if (s?.__onSelectLocalize) {
        s.removeEventListener("select", s.__onSelectLocalize);
      }
      sessionRef.current = null;
      refSpaceRef.current = null;
      setSessionActive(false);
      setLocalized(false);
      setStatus("Session ended.");
      pushDebug("AR session ended.");
    });

    (async () => {
      if (!("xr" in navigator)) {
        setStatus("WebXR unavailable on this device/browser.");
        pushDebug("navigator.xr missing.");
        return;
      }
      try {
        const supported = await (navigator as Navigator & {
          xr?: { isSessionSupported: (mode: XRSessionMode) => Promise<boolean> };
        }).xr?.isSessionSupported("immersive-ar");
        if (!supported) {
          setStatus("Immersive AR not supported. Use Chrome on an AR-capable mobile device over HTTPS.");
          pushDebug("immersive-ar not supported.");
        } else {
          pushDebug("immersive-ar supported.");
        }
      } catch {
        setStatus("Could not verify AR support in this browser.");
        pushDebug("isSessionSupported threw an error.");
      }
    })();

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
        const assetMap = new Map(assetRows.map((a) => [a.id, a]));

        await loadScene(proj, plRows, assetMap);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Load failed");
        pushDebug(`Initial load failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
    })();

    return () => {
      window.removeEventListener("resize", onResize);
      renderer.setAnimationLoop(null);
      renderer.dispose();
      if (arBtn.parentElement) arBtn.parentElement.removeChild(arBtn);
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, [projectId, loadScene]);

  function startArSession() {
    const launcher = arButtonRef.current;
    if (!launcher) {
      setStatus("AR launcher not ready yet.");
      pushDebug("AR launcher button missing.");
      return;
    }
    pushDebug("Requesting AR session (permission prompt may appear).");
    launcher.click();
  }

  const localize = useCallback(async () => {
    const renderer = rendererRef.current;
    const session = sessionRef.current ?? renderer?.xr.getSession() ?? null;
    const refSpace = refSpaceRef.current;
    const mapRoot = mapRootRef.current;
    if (busy) {
      pushDebug("Localize ignored: previous localization still running.");
      return;
    }
    if (!renderer || !session) {
      setStatus("Start an AR session first.");
      pushDebug("Localize blocked: XR session is not active.");
      return;
    }
    if (!refSpace) {
      setStatus("AR session not fully ready. Try again in a second.");
      pushDebug("Localize blocked: XR reference space missing.");
      return;
    }
    if (!mapRoot) {
      setStatus("AR scene not ready yet.");
      pushDebug("Localize blocked: mapRoot missing.");
      return;
    }

    setBusy(true);
    try {
      setStatus("Localizing…");
      setConfidence(null);
      setLocalizeCount((n) => n + 1);
      pushDebug("Capturing camera frame...");

      const cap = await captureFrameForLocalization(renderer, session, refSpace);
      if (!cap) {
        setStatus("Could not capture camera frame. Ensure browser/device supports WebXR camera-access.");
        pushDebug("Frame capture failed. Likely missing camera-access support, camera image texture, or WebGL readback.");
        return;
      }

      const fd = new FormData();
      fd.append("mapCode", mapCode);
      fd.append("fx", String(cap.intrinsics.fx));
      fd.append("fy", String(cap.intrinsics.fy));
      fd.append("px", String(cap.intrinsics.px));
      fd.append("py", String(cap.intrinsics.py));
      fd.append("width", String(cap.intrinsics.width));
      fd.append("height", String(cap.intrinsics.height));
      fd.append("isRightHanded", "false");
      fd.append("queryImage", cap.blob, "frame.jpg");

      const res = await apiFetch("/api/localize", { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.text();
        setStatus(body);
        pushDebug(`Localization API failed: ${body}`);
        return;
      }
      const loc = (await res.json()) as LocalizeResponse;
      const conf = loc.confidence ?? 0;
      setConfidence(conf);
      pushDebug(`Localization response: poseFound=${String(loc.poseFound)}, conf=${conf.toFixed(2)}`);

      if (!loc.poseFound) {
        setLocalized(false);
        setStatus("Still localizing — no pose.");
        return;
      }
      if (conf < CONFIDENCE_MIN) {
        setLocalized(false);
        setStatus(`Low confidence (${conf.toFixed(2)}). Move device or retry.`);
        return;
      }

      const T_world_camera = cap.viewerMatrix;
      const T_map_camera_rhs = multisetLhsPoseToThreeRhsMatrix(
        new THREE.Vector3(loc.position!.x, loc.position!.y, loc.position!.z),
        new THREE.Quaternion(loc.rotation!.x, loc.rotation!.y, loc.rotation!.z, loc.rotation!.w)
      );
      // Multiset returns camera pose in map space. Solve map pose in world.
      const T_world_map = new THREE.Matrix4().multiplyMatrices(T_world_camera, T_map_camera_rhs.clone().invert());
      mapRoot.matrix.copy(T_world_map);
      mapRoot.matrixAutoUpdate = false;
      mapRoot.visible = true;
      setLocalized(true);
      setStatus("Localized — content aligned.");
      pushDebug("Localization accepted. mapRoot updated.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Localization failed.";
      setStatus(msg);
      pushDebug(`Localization exception: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [busy, mapCode, pushDebug]);

  useEffect(() => {
    localizeByTapRef.current = () => {
      void localize();
    };
  }, [localize]);

  async function handlePrimaryAction() {
    if (busy) return;
    if (!sessionActive) {
      startArSession();
      return;
    }
    await localize();
  }

  return (
    <div ref={pageRootRef} className="relative flex min-h-screen flex-col bg-zinc-950">
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col p-4">
        <div className="pointer-events-auto flex flex-wrap items-center gap-3">
          <Link href={`/editor/${projectId}`} className="text-sm text-violet-400 hover:underline">
            ← Editor
          </Link>
          <span className="text-sm text-zinc-400">{status}</span>
          {confidence !== null ? (
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
              conf {confidence.toFixed(2)}
            </span>
          ) : null}
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              localized ? "bg-emerald-900/70 text-emerald-200" : "bg-amber-900/70 text-amber-200"
            }`}
          >
            {localized ? "Localized" : "Not localized"}
          </span>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">tries {localizeCount}</span>
          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
          >
            {showDebug ? "Hide log" : "Show log"}
          </button>
        </div>
        {showDebug ? (
          <div className="pointer-events-auto mt-3 w-full max-w-xl rounded-lg border border-zinc-700/80 bg-black/70 p-3 text-xs text-zinc-200">
            <p className="mb-2 font-medium text-zinc-100">AR session log</p>
            <div className="max-h-44 overflow-auto space-y-1">
              {debugLines.length === 0 ? <p className="text-zinc-400">No events yet.</p> : null}
              {debugLines.map((line, idx) => (
                <p key={`${idx}-${line}`} className="font-mono text-[11px] leading-4 text-zinc-300">
                  {line}
                </p>
              ))}
            </div>
          </div>
        ) : null}
        <div className="pointer-events-auto mt-auto flex justify-center gap-3 pb-24">
          <button
            type="button"
            onClick={() => void handlePrimaryAction()}
            className="rounded-lg bg-violet-600 px-6 py-3 text-sm font-medium text-white shadow-lg hover:bg-violet-500 disabled:opacity-60"
            disabled={busy}
          >
            {sessionActive ? (localized ? "Relocalize" : "Localize") : "Start AR"}
          </button>
        </div>
      </div>
      <div ref={containerRef} className="h-[70vh] w-full flex-1 lg:h-screen" />
    </div>
  );
}
