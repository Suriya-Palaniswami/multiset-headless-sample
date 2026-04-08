"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, TransformControls, useGLTF, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import type { PlacementRow } from "@/lib/types";
import { useEditorStore } from "@/lib/editorStore";
import { apiFetch } from "@/lib/api";

export type PlacementWithAsset = PlacementRow & { public_url: string };

type Props = {
  meshUrl: string | null;
  projectId: string;
  placements: PlacementWithAsset[];
  onPlacementsChange: (next: PlacementWithAsset[]) => void;
};

function MapMesh({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const clone = useMemo(() => scene.clone(), [scene]);
  return <primitive object={clone} />;
}

function PlacementObject({
  p,
  innerRef,
}: {
  p: PlacementWithAsset;
  innerRef: (el: THREE.Group | null) => void;
}) {
  const { scene } = useGLTF(p.public_url);
  const clone = useMemo(() => scene.clone(), [scene]);
  const setSelectedPlacementId = useEditorStore((s) => s.setSelectedPlacementId);

  return (
    <group
      ref={(el) => {
        innerRef(el);
        if (el) {
          el.position.set(p.pos_x, p.pos_y, p.pos_z);
          el.quaternion.set(p.rot_x, p.rot_y, p.rot_z, p.rot_w);
          el.scale.set(p.scale_x, p.scale_y, p.scale_z);
        }
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        setSelectedPlacementId(p.id);
      }}
    >
      <primitive object={clone} />
    </group>
  );
}

function TransformAttach({
  idToGroup,
  onChange,
}: {
  idToGroup: React.MutableRefObject<Map<string, THREE.Group>>;
  onChange: (id: string, obj: THREE.Object3D) => void;
}) {
  const { camera, gl } = useThree();
  const tcRef = useRef<React.ComponentRef<typeof TransformControls>>(null);
  const orbitRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const mode = useEditorStore((s) => s.transformMode);
  const selectedId = useEditorStore((s) => s.selectedPlacementId);
  const selectedObj = selectedId ? idToGroup.current.get(selectedId) ?? null : null;

  useEffect(() => {
    const tc = tcRef.current;
    if (!tc) return;
    const drag = (e: { value: boolean }) => {
      if (orbitRef.current) orbitRef.current.enabled = !e.value;
    };
    const ctl = tc as unknown as {
      addEventListener: (ev: "dragging-changed", fn: (e: { value: boolean }) => void) => void;
      removeEventListener: (ev: "dragging-changed", fn: (e: { value: boolean }) => void) => void;
    };
    ctl.addEventListener("dragging-changed", drag);
    return () => ctl.removeEventListener("dragging-changed", drag);
  }, [selectedObj]);

  useEffect(() => {
    const tc = tcRef.current;
    if (!tc || !selectedId || !selectedObj) return;
    const fn = () => onChange(selectedId, selectedObj);
    const ctl = tc as unknown as {
      addEventListener: (ev: "objectChange", fn: () => void) => void;
      removeEventListener: (ev: "objectChange", fn: () => void) => void;
    };
    ctl.addEventListener("objectChange", fn);
    return () => ctl.removeEventListener("objectChange", fn);
  }, [selectedId, selectedObj, onChange]);

  return (
    <>
      <OrbitControls ref={orbitRef} makeDefault enableDamping dampingFactor={0.05} />
      {selectedObj ? (
        <TransformControls ref={tcRef} object={selectedObj} mode={mode} camera={camera} domElement={gl.domElement} />
      ) : null}
    </>
  );
}

function EditorScene(props: Props) {
  const { meshUrl, placements, projectId, onPlacementsChange } = props;
  const idToGroup = useRef<Map<string, THREE.Group>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyLocalState = useCallback(
    (id: string, obj: THREE.Object3D) => {
      const pos = obj.position;
      const q = obj.quaternion;
      const sc = obj.scale;
      const next = placements.map((p) =>
        p.id === id
          ? {
              ...p,
              pos_x: pos.x,
              pos_y: pos.y,
              pos_z: pos.z,
              rot_x: q.x,
              rot_y: q.y,
              rot_z: q.z,
              rot_w: q.w,
              scale_x: sc.x,
              scale_y: sc.y,
              scale_z: sc.z,
            }
          : p
      );
      onPlacementsChange(next);

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const pl = next.find((x) => x.id === id);
        if (!pl) return;
        await apiFetch(`/api/projects/${projectId}/placements/${id}`, {
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
      }, 800);
    },
    [placements, onPlacementsChange, projectId]
  );

  useEffect(() => {
    for (const p of placements) {
      const g = idToGroup.current.get(p.id);
      if (g) {
        g.position.set(p.pos_x, p.pos_y, p.pos_z);
        g.quaternion.set(p.rot_x, p.rot_y, p.rot_z, p.rot_w);
        g.scale.set(p.scale_x, p.scale_y, p.scale_z);
      }
    }
  }, [placements]);

  return (
    <>
      <color attach="background" args={["#0c0c10"]} />
      <hemisphereLight intensity={0.65} groundColor="#444" />
      <directionalLight position={[4, 10, 6]} intensity={0.85} />

      <group name="worldRoot">
        <group name="mapRoot">
          {meshUrl ? <MapMesh url={meshUrl} /> : null}
          <group name="placedObjectsRoot">
            {placements.map((p) => (
              <PlacementObject
                key={p.id}
                p={p}
                innerRef={(el) => {
                  if (el) idToGroup.current.set(p.id, el);
                  else idToGroup.current.delete(p.id);
                }}
              />
            ))}
          </group>
        </group>
      </group>

      <TransformAttach idToGroup={idToGroup} onChange={applyLocalState} />

      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={["#f44", "#4f4", "#44f"]} labelColor="white" />
      </GizmoHelper>
    </>
  );
}

export default function EditorCanvas(props: Props) {
  const setSelectedPlacementId = useEditorStore((s) => s.setSelectedPlacementId);

  return (
    <div className="h-full w-full min-h-[480px]">
      <Canvas
        camera={{ position: [8, 6, 8], fov: 50, near: 0.1, far: 5000 }}
        gl={{ preserveDrawingBuffer: true }}
        onPointerMissed={() => setSelectedPlacementId(null)}
      >
        <EditorScene {...props} />
      </Canvas>
    </div>
  );
}
