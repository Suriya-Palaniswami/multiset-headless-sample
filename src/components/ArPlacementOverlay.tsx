"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { buildMapCameraMatrix, type ArAlignMode } from "@/lib/ar/mapPose";
import type { LocalizeResponse } from "@/lib/types";
import type { PlacementWithAsset } from "@/components/EditorCanvas";

export function verticalFovFromFy(height: number, fy: number): number {
  return (2 * Math.atan(height / (2 * fy)) * 180) / Math.PI;
}

/** R3F can re-apply the Canvas `camera` prop each render — that reset our pose. Sync every frame. */
function localizePoseAlignment(): ArAlignMode {
  const raw = process.env.NEXT_PUBLIC_AR_LOCALIZE_POSE_MODE?.trim();
  if (raw === "direct" || raw === "unity" || raw === "lhsReflection" || raw === "invMapCam") return raw;
  /**
   * Default `direct`: same numeric frame as multiset map mesh + editor placements (raw API → Three).
   * If objects sit wrong vs the room while the camera pose is stable, try `NEXT_PUBLIC_AR_LOCALIZE_POSE_MODE=unity`.
   */
  return "direct";
}

function SyncCamera({ result, fovDeg }: { result: LocalizeResponse; fovDeg: number }) {
  const { camera } = useThree();
  const align = localizePoseAlignment();
  useFrame(() => {
    const c = camera as THREE.PerspectiveCamera;
    const T = buildMapCameraMatrix(result, align);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    T.decompose(pos, quat, scl);
    c.position.copy(pos);
    c.quaternion.copy(quat);
    c.near = 0.05;
    c.far = 8000;
    if (Math.abs(c.fov - fovDeg) > 1e-6) {
      c.fov = fovDeg;
      c.updateProjectionMatrix();
    }
    c.matrixWorldNeedsUpdate = true;
  });
  return null;
}

function PlacedModel({ p }: { p: PlacementWithAsset }) {
  const { scene } = useGLTF(p.public_url);
  const clone = useMemo(() => scene.clone(), [scene]);
  return (
    <group
      position={[p.pos_x, p.pos_y, p.pos_z]}
      quaternion={[p.rot_x, p.rot_y, p.rot_z, p.rot_w]}
      scale={[p.scale_x, p.scale_y, p.scale_z]}
    >
      <primitive object={clone} />
    </group>
  );
}

type Props = {
  localizeResult: LocalizeResponse;
  placements: PlacementWithAsset[];
  /** Query image height in pixels (same as intrinsics / JPEG). */
  queryHeight: number;
  fy: number;
};

/**
 * Transparent WebGL layer: map-space placements viewed from the localized camera pose.
 * This is a **single-frame snapshot** (pose from last query). Moving the phone does not update AR until you localize again — there is no ongoing SLAM in the REST-only path.
 */
export function ArPlacementOverlay({ localizeResult, placements, queryHeight, fy }: Props) {
  if (!localizeResult.poseFound || !localizeResult.position || !localizeResult.rotation) {
    return null;
  }
  const fovDeg = verticalFovFromFy(queryHeight, fy);

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <Canvas
        className="h-full w-full"
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        /** Do not pass `camera` props here — React Three Fiber reapplies them and clears localized pose each render. */
        onCreated={({ gl, scene, camera }) => {
          scene.background = null;
          gl.setClearColor(0x000000, 0);
          const c = camera as THREE.PerspectiveCamera;
          c.near = 0.05;
          c.far = 8000;
          c.fov = fovDeg;
          c.updateProjectionMatrix();
        }}
      >
        <SyncCamera result={localizeResult} fovDeg={fovDeg} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 12, 8]} intensity={0.9} />
        <hemisphereLight intensity={0.35} groundColor="#222" />
        <Suspense fallback={null}>
          {placements.map((p) => (
            <PlacedModel key={p.id} p={p} />
          ))}
        </Suspense>
      </Canvas>
    </div>
  );
}
