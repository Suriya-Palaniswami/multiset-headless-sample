"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Suspense, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import type { LocalizeResponse } from "@/lib/types";
import type { PlacementWithAsset } from "@/components/EditorCanvas";

export function verticalFovFromFy(height: number, fy: number): number {
  return (2 * Math.atan(height / (2 * fy)) * 180) / Math.PI;
}

function SyncCamera({ result, fovDeg }: { result: LocalizeResponse; fovDeg: number }) {
  const { camera } = useThree();
  useLayoutEffect(() => {
    const pos = result.position;
    const rot = result.rotation;
    if (!pos || !rot) return;
    const c = camera as THREE.PerspectiveCamera;
    c.position.set(pos.x, pos.y, pos.z);
    c.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    c.near = 0.05;
    c.far = 8000;
    c.fov = fovDeg;
    c.updateProjectionMatrix();
  }, [camera, result, fovDeg]);
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
        camera={{ fov: fovDeg, near: 0.05, far: 8000, position: [0, 1.5, 0] }}
        onCreated={({ gl, scene }) => {
          scene.background = null;
          gl.setClearColor(0x000000, 0);
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
