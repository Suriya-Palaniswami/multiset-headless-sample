"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { PlacementWithAsset } from "@/components/EditorCanvas";
import { apiFetch, apiUrl } from "@/lib/api";
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

function arPixelRatio(): number {
  const raw = Number(process.env.NEXT_PUBLIC_AR_PIXEL_RATIO ?? "");
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, window.devicePixelRatio || 1);
  return Math.min(1, window.devicePixelRatio || 1);
}

function arUseDomOverlay(): boolean {
  return process.env.NEXT_PUBLIC_AR_DOM_OVERLAY === "true";
}

function arFramebufferScale(): number {
  const raw = Number(process.env.NEXT_PUBLIC_AR_FRAMEBUFFER_SCALE ?? "");
  if (Number.isFinite(raw) && raw > 0) return Math.min(1, Math.max(0.25, raw));
  return 0.5;
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

type HudState = "idle" | "starting" | "ready" | "localizing" | "localized" | "error";

function hudColor(state: HudState): number {
  switch (state) {
    case "starting":
      return 0xf59e0b;
    case "ready":
      return 0x60a5fa;
    case "localizing":
      return 0xfacc15;
    case "localized":
      return 0x22c55e;
    case "error":
      return 0xef4444;
    default:
      return 0x71717a;
  }
}

function createHud() {
  const group = new THREE.Group();
  group.name = "cameraHud";
  group.visible = false;
  group.position.set(0, -0.22, -1.15);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.028, 0.041, 48),
    new THREE.MeshBasicMaterial({ color: hudColor("idle"), transparent: true, opacity: 0.95, side: THREE.DoubleSide })
  );
  ring.name = "statusRing";
  group.add(ring);

  const bar = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.012),
    new THREE.MeshBasicMaterial({ color: hudColor("idle"), transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  );
  bar.name = "statusBar";
  bar.position.set(0, -0.065, 0);
  group.add(bar);

  return group;
}

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
  const [logCount, setLogCount] = useState(0);
  const [logSessionId] = useState(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  });

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const hudRef = useRef<THREE.Group | null>(null);
  const mapRootRef = useRef<THREE.Group | null>(null);
  const placedRootRef = useRef<THREE.Group | null>(null);
  const xrSessionRef = useRef<XRSession | null>(null);
  const xrReferenceSpaceRef = useRef<XRReferenceSpace | null>(null);
  const xrFrameIdRef = useRef<number | null>(null);
  const xrFirstFrameLoggedRef = useRef(false);
  const currentMapCodeRef = useRef<string | null>(null);
  const placementsRef = useRef<PlacementWithAsset[]>([]);
  const logSeqRef = useRef(0);

  const pushDebug = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString();
    setDebugLines((prev) => [`[${stamp}] ${line}`, ...prev].slice(0, 24));
  }, []);

  const setStatusState = useCallback((message: string, hudState: HudState = "idle") => {
    setStatus(message);
    const hud = hudRef.current;
    if (!hud) return;
    hud.visible = hudState !== "idle";
    hud.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial | undefined;
      if (!mesh.isMesh || !material?.color) return;
      material.color.setHex(hudColor(hudState));
    });
  }, []);

  const arLog = useCallback(
    (
      event: string,
      data?: Record<string, unknown>,
      level: "debug" | "info" | "warn" | "error" = "info",
      message?: string
    ) => {
      try {
        const payload = {
          projectId,
          mapCode: currentMapCodeRef.current,
          sessionId: logSessionId,
          seq: ++logSeqRef.current,
          clientTs: new Date().toISOString(),
          level,
          event,
          message,
          data,
          url: window.location.href,
          userAgent: navigator.userAgent,
        };
        const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
        if (navigator.sendBeacon?.(apiUrl("/api/ar-logs"), blob)) return;
        void fetch(apiUrl("/api/ar-logs"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        });
      } catch {
        // Logging must never affect AR behavior.
      } finally {
        setLogCount((n) => n + 1);
      }
    },
    [logSessionId, projectId]
  );

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      arLog("window_error", {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
      }, "error");
    };
    const onUnhandled = (e: PromiseRejectionEvent) => {
      arLog("unhandled_rejection", { reason: String(e.reason) }, "error");
    };
    const onPageHide = () => {
      arLog("pagehide", { sessionActive: Boolean(xrSessionRef.current) }, "debug");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [arLog]);

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

        setStatusState(proj.map_code ? "Start AR, then tap Localize." : "Project has no map code.");
      } catch (e) {
        if (!cancelled) {
          setStatusState(e instanceof Error ? e.message : "Failed to load project", "error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, setStatusState]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host || rendererRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.appendChild(canvas);
    const onContextLost = (e: Event) => {
      e.preventDefault();
      arLog(
        "webgl_context_lost",
        {
          sessionActive: Boolean(xrSessionRef.current),
          rendererInfo: rendererRef.current
            ? {
                memory: rendererRef.current.info.memory,
                render: rendererRef.current.info.render,
              }
            : null,
        },
        "error"
      );
      pushDebug("WebGL context lost.");
    };
    canvas.addEventListener("webglcontextlost", onContextLost, false);

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 8000);
    cameraRef.current = camera;
    scene.add(camera);
    const hud = createHud();
    hudRef.current = hud;
    camera.add(hud);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
      stencil: false,
    });
    renderer.setClearColor(0x000000, 0);
    const pixelRatio = arPixelRatio();
    renderer.setPixelRatio(pixelRatio);
    rendererRef.current = renderer;
    arLog("renderer_initialized", {
      dpr: window.devicePixelRatio || 1,
      pixelRatio,
      width: host.clientWidth,
      height: host.clientHeight,
    });

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

    return () => {
      ro.disconnect();
      const session = xrSessionRef.current;
      const frameId = xrFrameIdRef.current;
      if (session && frameId !== null) session.cancelAnimationFrame(frameId);
      xrSessionRef.current?.end().catch(() => {});
      xrSessionRef.current = null;
      xrReferenceSpaceRef.current = null;
      xrFrameIdRef.current = null;
      disposeObject(mapRoot);
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      hudRef.current = null;
      mapRootRef.current = null;
      placedRootRef.current = null;
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      if (canvas.parentElement === host) host.removeChild(canvas);
    };
  }, [arLog, pushDebug]);

  const loadPlacementsIntoMapRoot = useCallback(async () => {
    const root = placedRootRef.current;
    if (!root) return;
    while (root.children.length) {
      const child = root.children[0];
      root.remove(child);
      disposeObject(child);
    }

    const loader = new GLTFLoader();
    arLog("placements_load_start", { count: placementsRef.current.length });
    for (const p of placementsRef.current) {
      try {
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
      } catch (e) {
        arLog(
          "placement_load_error",
          { placementId: p.id, assetUrl: p.public_url, error: e instanceof Error ? e.message : String(e) },
          "error"
        );
      }
    }
    pushDebug(`Loaded ${root.children.length} placement(s) under mapRoot.`);
    arLog("placements_load_success", { loaded: root.children.length, requested: placementsRef.current.length });
  }, [arLog, pushDebug]);

  const startXrRenderLoop = useCallback(
    (session: XRSession, refSpace: XRReferenceSpace, baseLayer: XRWebGLLayer) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!renderer || !scene || !camera) return;

      const gl = renderer.getContext();
      camera.matrixAutoUpdate = false;
      renderer.setPixelRatio(1);
      renderer.setSize(baseLayer.framebufferWidth, baseLayer.framebufferHeight, false);

      const onFrame: XRFrameRequestCallback = (_time, frame) => {
        xrFrameIdRef.current = session.requestAnimationFrame(onFrame);
        const pose = frame.getViewerPose(refSpace);
        if (!pose) return;

        gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
        renderer.setScissorTest(true);

        for (const view of pose.views) {
          const viewport = baseLayer.getViewport(view);
          if (!viewport) continue;

          renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
          renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
          camera.projectionMatrix.fromArray(view.projectionMatrix);
          camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
          camera.matrix.fromArray(view.transform.matrix);
          camera.matrixWorld.copy(camera.matrix);
          camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
          renderer.render(scene, camera);
        }

        renderer.setScissorTest(false);
        if (!xrFirstFrameLoggedRef.current) {
          xrFirstFrameLoggedRef.current = true;
          setStatusState("AR camera ready — tap screen to localize.", "ready");
          const viewports = pose.views.flatMap((view) => {
            const viewport = baseLayer.getViewport(view);
            return viewport
              ? [{ x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height }]
              : [];
          });
          arLog(
            "xr_first_frame",
            {
              views: pose.views.length,
              framebuffer: { width: baseLayer.framebufferWidth, height: baseLayer.framebufferHeight },
              viewports,
            },
            "debug"
          );
        }
      };

      xrFirstFrameLoggedRef.current = false;
      xrFrameIdRef.current = session.requestAnimationFrame(onFrame);
    },
    [arLog, setStatusState]
  );

  const startAr = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    arLog("start_ar_clicked", {
      hasNavigatorXr: Boolean(navigator.xr),
      dpr: window.devicePixelRatio || 1,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    setStatusState("Starting AR camera…", "starting");
    const xr = navigator.xr;
    if (!xr) {
      setStatusState("WebXR is not available in this browser.", "error");
      arLog("webxr_unavailable", undefined, "warn");
      return;
    }
    if (xrSessionRef.current) return;

    try {
      const supported = await xr.isSessionSupported("immersive-ar");
      arLog("immersive_ar_support_checked", { supported });
      if (!supported) {
        setStatusState("Immersive AR is not supported on this device/browser.", "error");
        return;
      }

      const framebufferScale = arFramebufferScale();
      const sessionInit: XRSessionInit & { domOverlay?: { root: Element } } = {
        requiredFeatures: ["camera-access"],
        optionalFeatures: ["local-floor"],
      };
      if (arUseDomOverlay() && rootRef.current) {
        sessionInit.optionalFeatures = [...(sessionInit.optionalFeatures ?? []), "dom-overlay"];
        sessionInit.domOverlay = { root: rootRef.current };
      }
      arLog("request_session_start", {
        requiredFeatures: sessionInit.requiredFeatures,
        optionalFeatures: sessionInit.optionalFeatures,
        framebufferScale,
      });
      const session = await xr.requestSession("immersive-ar", sessionInit);
      const gl = renderer.getContext();
      await (gl as WebGLRenderingContext & { makeXRCompatible?: () => Promise<void> }).makeXRCompatible?.();
      const baseLayer = new XRWebGLLayer(session, gl, {
        antialias: false,
        framebufferScaleFactor: framebufferScale,
        ignoreDepthValues: true,
      });
      session.updateRenderState({ baseLayer, depthNear: 0.01, depthFar: 10000 });
      const refSpace = await session.requestReferenceSpace("local");

      session.addEventListener("end", () => {
        if (xrFrameIdRef.current !== null) {
          session.cancelAnimationFrame(xrFrameIdRef.current);
          xrFrameIdRef.current = null;
        }
        const host = canvasHostRef.current;
        renderer.setPixelRatio(arPixelRatio());
        renderer.setSize(Math.max(1, host?.clientWidth || window.innerWidth), Math.max(1, host?.clientHeight || window.innerHeight), false);
        xrSessionRef.current = null;
        xrReferenceSpaceRef.current = null;
        setSessionActive(false);
        setStatusState("AR session ended.");
        if (mapRootRef.current) mapRootRef.current.visible = false;
      });
      session.addEventListener("select", () => {
        void localize();
      });

      xrSessionRef.current = session;
      xrReferenceSpaceRef.current = refSpace;
      startXrRenderLoop(session, refSpace, baseLayer);
      setSessionActive(true);
      const overlay = arUseDomOverlay();
      setStatusState(overlay ? "AR active — tap Localize." : "AR active — tap screen to localize.", "ready");
      pushDebug("WebXR session started (REST localization is still server/API based).");
      arLog("webxr_session_started", {
        baseLayer: Boolean(session.renderState.baseLayer),
        domOverlay: overlay,
        framebufferScale,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Camera permission failed";
      setStatusState(msg, "error");
      pushDebug(msg);
      arLog("start_ar_error", { error: msg }, "error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arLog, pushDebug, setStatusState, startXrRenderLoop]);

  const localize = useCallback(async () => {
    const renderer = rendererRef.current;
    const session = xrSessionRef.current;
    const mapCode = currentMapCodeRef.current;
    if (!mapCode || busy) return;
    if (!renderer || !session) {
      setStatusState("Start AR first.");
      return;
    }

    const refSpace = xrReferenceSpaceRef.current;
    if (!refSpace) {
      setStatusState("WebXR reference space not ready.", "error");
      return;
    }

    setBusy(true);
    setConfidence(null);
    setLastResult(null);
    try {
      setStatusState("Capturing XR camera frame…", "localizing");
      arLog("localize_start", { poseMode: localizePoseAlignment() });
      const capture = await captureFrameForLocalization(renderer, session, refSpace, 1280);
      if (!capture) {
        setStatusState("Could not capture XR camera frame. Check camera-access support.", "error");
        pushDebug("XR capture failed: no camera texture or viewer pose.");
        arLog("xr_capture_failed", undefined, "warn");
        return;
      }
      setStatusState("Sending frame to Multiset REST…", "localizing");

      pushDebug(
        `REST query image ${capture.intrinsics.width}x${capture.intrinsics.height} ` +
          `~${Math.round(capture.blob.size / 1024)}KB; ` +
          `fx=${capture.intrinsics.fx.toFixed(1)} fy=${capture.intrinsics.fy.toFixed(1)}`
      );
      arLog("xr_capture_success", {
        width: capture.intrinsics.width,
        height: capture.intrinsics.height,
        blobKb: Math.round(capture.blob.size / 1024),
        fx: capture.intrinsics.fx,
        fy: capture.intrinsics.fy,
      });

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
        setStatusState(`Localize failed (${res.status})`, "error");
        pushDebug(text.slice(0, 400));
        arLog("rest_localize_error", { status: res.status, body: text.slice(0, 1000) }, "error");
        return;
      }
      let parsed: LocalizeResponse;
      try {
        parsed = JSON.parse(text) as LocalizeResponse;
      } catch {
        setStatusState("Invalid JSON from server", "error");
        arLog("rest_localize_invalid_json", { body: text.slice(0, 1000) }, "error");
        return;
      }
      setLastResult(parsed);
      const c = parsed.confidence ?? null;
      setConfidence(c);
      arLog("rest_localize_success", {
        poseFound: parsed.poseFound,
        confidence: c,
        mapCodes: parsed.mapCodes,
        responseTime: parsed.responseTime,
        position: parsed.position,
        rotation: parsed.rotation,
      });
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
        setStatusState(`Localized — conf ${(c ?? 0).toFixed(3)} (mapRoot aligned)`, "localized");
        pushDebug(`poseFound=${parsed.poseFound} align=${align} mapCodes=${JSON.stringify(parsed.mapCodes)}`);
        arLog("maproot_aligned", {
          align,
          worldMapPosition: mapRoot
            ? { x: mapRoot.position.x, y: mapRoot.position.y, z: mapRoot.position.z }
            : null,
          worldMapQuaternion: mapRoot
            ? { x: mapRoot.quaternion.x, y: mapRoot.quaternion.y, z: mapRoot.quaternion.z, w: mapRoot.quaternion.w }
            : null,
          rendererInfo: renderer.info,
        });
      } else {
        setStatusState("No pose for this frame — try aim, lighting, or another angle.", "error");
        pushDebug("poseFound=false");
      }
    } finally {
      setBusy(false);
    }
  }, [arLog, busy, loadPlacementsIntoMapRoot, pushDebug, setStatusState]);

  return (
    <div ref={rootRef} className="fixed inset-0 overflow-hidden bg-zinc-950">
      <div className="absolute left-0 right-0 top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-2 backdrop-blur-sm">
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
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            Vanilla WebXR + Three render + REST map query
          </span>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">logs {logCount}</span>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
            session {logSessionId.slice(0, 8)}
          </span>
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

      <div className="absolute inset-0">
        <div ref={canvasHostRef} className="absolute inset-0 bg-black" />
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col p-3 pt-16">
          <div className="pointer-events-auto max-w-xl rounded-lg bg-black/65 p-3 text-sm text-zinc-200 backdrop-blur">
            <p>
              Multiset localization is still <strong>REST</strong>: WebXR only supplies the local tracking pose
              needed to place <code>mapRoot</code> into browser world space.
            </p>
            {placements.length === 0 ? (
              <p className="mt-2 text-amber-200/90">No placements in this project — add objects in the editor first.</p>
            ) : null}
          </div>
          <div className="pointer-events-auto mt-auto flex flex-wrap items-center justify-center gap-2 pb-16">
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
