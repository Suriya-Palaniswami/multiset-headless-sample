import * as THREE from "three";
import type { LocalizeResponse } from "@/lib/types";

/**
 * How to interpret Multiset localization pose (position + quaternion) for Three.js.
 * Multiset docs use LHS / Unity-style coordinates when isRightHanded=false on query.
 */
export type ArAlignMode = "unity" | "direct" | "lhsReflection" | "invMapCam";

/** Unity LH Y-up position → Three.js RHS Y-up (common conversion). */
export function multisetPositionToThree(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, -v.z);
}

/** Unity LH quaternion → Three.js RHS (pairs with position flip on Z). */
export function multisetQuaternionToThree(q: { x: number; y: number; z: number; w: number }): THREE.Quaternion {
  return new THREE.Quaternion(-q.x, q.y, -q.z, q.w);
}

function lhsReflectionMatrix(position: THREE.Vector3, rotation: THREE.Quaternion): THREE.Matrix4 {
  const lhs = new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(1, 1, 1));
  const s = new THREE.Matrix4().makeScale(1, 1, -1);
  return new THREE.Matrix4().multiplyMatrices(s, lhs).multiply(s);
}

/**
 * Build T_map_camera: transforms camera-local points into map coordinates
 * (same convention as prior code: compose from API position/rotation).
 */
export function buildMapCameraMatrix(loc: LocalizeResponse, mode: ArAlignMode): THREE.Matrix4 {
  if (!loc.position || !loc.rotation) {
    return new THREE.Matrix4();
  }
  const rawP = loc.position;
  const rawQ = loc.rotation;

  let m: THREE.Matrix4;
  switch (mode) {
    case "direct": {
      const p = new THREE.Vector3(rawP.x, rawP.y, rawP.z);
      const q = new THREE.Quaternion(rawQ.x, rawQ.y, rawQ.z, rawQ.w);
      m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
      break;
    }
    case "lhsReflection": {
      const p = new THREE.Vector3(rawP.x, rawP.y, rawP.z);
      const q = new THREE.Quaternion(rawQ.x, rawQ.y, rawQ.z, rawQ.w);
      m = lhsReflectionMatrix(p, q);
      break;
    }
    case "invMapCam": {
      const p = multisetPositionToThree(rawP);
      const q = multisetQuaternionToThree(rawQ);
      m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)).invert();
      break;
    }
    case "unity":
    default: {
      const p = multisetPositionToThree(rawP);
      const q = multisetQuaternionToThree(rawQ);
      m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
      break;
    }
  }

  return m;
}

/**
 * Solve the transform that places authored map-space content into the active
 * runtime tracking world.
 *
 * T_world_camera comes from WebXR at the exact captured frame.
 * T_map_camera comes from Multiset REST localization for that same frame.
 */
export function solveWorldMapMatrix(
  worldCameraMatrix: THREE.Matrix4,
  localization: LocalizeResponse,
  mode: ArAlignMode
): THREE.Matrix4 {
  const mapCameraMatrix = buildMapCameraMatrix(localization, mode);
  return new THREE.Matrix4().multiplyMatrices(worldCameraMatrix, mapCameraMatrix.clone().invert());
}
