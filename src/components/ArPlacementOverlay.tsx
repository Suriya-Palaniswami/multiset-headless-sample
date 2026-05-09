"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildMapCameraMatrix, type ArAlignMode } from "@/lib/ar/mapPose";
import type { LocalizeResponse } from "@/lib/types";
import type { PlacementWithAsset } from "@/components/EditorCanvas";

export function verticalFovFromFy(height: number, fy: number): number {
  return (2 * Math.atan(height / (2 * fy)) * 180) / Math.PI;
}

function localizePoseAlignment(): ArAlignMode {
  const raw = process.env.NEXT_PUBLIC_AR_LOCALIZE_POSE_MODE?.trim();
  if (raw === "direct" || raw === "unity" || raw === "lhsReflection" || raw === "invMapCam") return raw;
  return "direct";
}

const gltfProtoCache = new Map<string, THREE.Object3D>();

async function cloneGltfFromUrl(url: string): Promise<THREE.Object3D> {
  let proto = gltfProtoCache.get(url);
  if (!proto) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    proto = gltf.scene;
    gltfProtoCache.set(url, proto);
  }
  return proto.clone(true);
}

function disposeSceneGraph(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
      else mat?.dispose?.();
    }
  });
}

type Props = {
  localizeResult: LocalizeResponse;
  placements: PlacementWithAsset[];
  queryHeight: number;
  fy: number;
};

/**
 * Transparent WebGL layer using **plain Three.js** (no React Three Fiber).
 * Multiset's own "vanilla" examples (see multiset-vps-webxr `examples/vanilla`) still use **Three.js**
 * for GLB rendering; avoiding R3F here removes React-specific camera quirks. Raw WebGL would not fix pose math by itself.
 *eliminates framework camera/overrides that kept the localized pose from sticking.
 */
export function ArPlacementOverlay({ localizeResult, placements, queryHeight, fy }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !localizeResult.poseFound || !localizeResult.position || !localizeResult.rotation) {
      return;
    }

    const fovDeg = verticalFovFromFy(queryHeight, fy);
    const align = localizePoseAlignment();
    let rafId = 0;
    let destroyed = false;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(fovDeg, 1, 0.05, 8000);
    camera.matrixAutoUpdate = true;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;outline:none;";
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.88);
    dir.position.set(4, 12, 8);
    scene.add(dir);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.38));

    const placementGroups: THREE.Group[] = [];

    const syncCamera = () => {
      const T = buildMapCameraMatrix(localizeResult, align);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      T.decompose(pos, quat, scl);
      camera.position.copy(pos);
      camera.quaternion.copy(quat);
      camera.scale.set(1, 1, 1);
      camera.fov = fovDeg;
      camera.updateProjectionMatrix();
    };

    const resize = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
      renderer.setSize(w, h, false);
    };

    const ro = new ResizeObserver(() => {
      resize();
      syncCamera();
    });
    ro.observe(el);
    resize();
    syncCamera();

    let modelsReady = placements.length === 0;

    const loadModels = async () => {
      for (const p of placements) {
        if (destroyed) return;
        try {
          const obj = await cloneGltfFromUrl(p.public_url);
          const g = new THREE.Group();
          g.add(obj);
          g.position.set(p.pos_x, p.pos_y, p.pos_z);
          g.quaternion.set(p.rot_x, p.rot_y, p.rot_z, p.rot_w);
          g.scale.set(p.scale_x, p.scale_y, p.scale_z);
          scene.add(g);
          placementGroups.push(g);
        } catch {
          /* skip broken asset URL */
        }
      }
      modelsReady = true;
    };

    void loadModels();

    const tick = () => {
      if (destroyed) return;
      rafId = requestAnimationFrame(tick);
      syncCamera();
      if (modelsReady) renderer.render(scene, camera);
    };
    tick();

    return () => {
      destroyed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      for (const g of placementGroups) {
        scene.remove(g);
        disposeSceneGraph(g);
      }
      renderer.dispose();
      if (renderer.domElement.parentElement === el) {
        el.removeChild(renderer.domElement);
      }
    };
  }, [localizeResult, placements, queryHeight, fy]);

  if (!localizeResult.poseFound || !localizeResult.position || !localizeResult.rotation) {
    return null;
  }

  return <div ref={containerRef} className="pointer-events-none absolute inset-0 z-20" />;
}
