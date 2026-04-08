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

export default function ArPage() {
  const params = useParams();
  const projectId = String(params.projectId ?? "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>("Initializing…");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [mapCode, setMapCode] = useState<string>("");

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const mapRootRef = useRef<THREE.Group | null>(null);
  const sessionRef = useRef<XRSession | null>(null);
  const refSpaceRef = useRef<XRReferenceSpace | null>(null);
  const assetCache = useRef<Map<string, THREE.Object3D>>(new Map());

  const loadScene = useCallback(
    async (proj: ProjectRow, placements: PlacementRow[], assets: Map<string, AssetRow>) => {
      setMapCode(proj.map_code);
      const scene = sceneRef.current;
      const mapRoot = mapRootRef.current;
      if (!scene || !mapRoot) return;

      while (mapRoot.children.length) {
        mapRoot.remove(mapRoot.children[0]);
      }

      const placedRoot = new THREE.Group();
      placedRoot.name = "placedObjectsRoot";
      mapRoot.add(placedRoot);

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
    },
    []
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

    const arBtn = ARButton.createButton(renderer, {
      requiredFeatures: ["camera-access"],
    });
    arBtn.style.position = "fixed";
    arBtn.style.bottom = "24px";
    arBtn.style.left = "50%";
    arBtn.style.transform = "translateX(-50%)";
    arBtn.style.zIndex = "20";
    document.body.appendChild(arBtn);

    renderer.xr.addEventListener("sessionstart", async () => {
      const session = renderer.xr.getSession();
      sessionRef.current = session;
      if (session) {
        refSpaceRef.current = await session.requestReferenceSpace("local");
      }
      setStatus("Session active — tap Localize.");
    });
    renderer.xr.addEventListener("sessionend", () => {
      sessionRef.current = null;
      refSpaceRef.current = null;
      setStatus("Session ended.");
    });

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

  async function localize() {
    const renderer = rendererRef.current;
    const session = sessionRef.current ?? renderer?.xr.getSession() ?? null;
    const refSpace = refSpaceRef.current;
    const mapRoot = mapRootRef.current;
    if (!renderer || !session || !refSpace || !mapRoot) {
      setStatus("Start an AR session first.");
      return;
    }

    setStatus("Localizing…");
    setConfidence(null);

    const cap = await captureFrameForLocalization(renderer, session, refSpace);
    if (!cap) {
      setStatus("Could not capture camera frame (camera-access / WebGL).");
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
      setStatus(await res.text());
      return;
    }
    const loc = (await res.json()) as LocalizeResponse;
    const conf = loc.confidence ?? 0;
    setConfidence(conf);

    if (!loc.poseFound) {
      setStatus("Still localizing — no pose.");
      return;
    }
    if (conf < CONFIDENCE_MIN) {
      setStatus(`Low confidence (${conf.toFixed(2)}). Move device or retry.`);
      return;
    }

    const T_world_camera = cap.viewerMatrix;
    const T_map_camera = new THREE.Matrix4().compose(
      new THREE.Vector3(loc.position!.x, loc.position!.y, loc.position!.z),
      new THREE.Quaternion(loc.rotation!.x, loc.rotation!.y, loc.rotation!.z, loc.rotation!.w),
      new THREE.Vector3(1, 1, 1)
    );
    const T_world_map = new THREE.Matrix4().multiplyMatrices(
      T_world_camera,
      T_map_camera.clone().invert()
    );
    mapRoot.matrix.copy(T_world_map);
    mapRoot.matrixAutoUpdate = false;
    mapRoot.visible = true;

    setStatus("Localized — content aligned.");
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-zinc-950">
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
        </div>
        <div className="pointer-events-auto mt-auto flex justify-center pb-24">
          <button
            type="button"
            onClick={() => void localize()}
            className="rounded-lg bg-violet-600 px-6 py-3 text-sm font-medium text-white shadow-lg hover:bg-violet-500"
          >
            Localize
          </button>
        </div>
      </div>
      <div ref={containerRef} className="h-[70vh] w-full flex-1 lg:h-screen" />
    </div>
  );
}
