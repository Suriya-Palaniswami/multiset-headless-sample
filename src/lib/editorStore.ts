import { create } from "zustand";

export type TransformMode = "translate" | "rotate" | "scale";

type EditorState = {
  transformMode: TransformMode;
  setTransformMode: (m: TransformMode) => void;
  selectedPlacementId: string | null;
  setSelectedPlacementId: (id: string | null) => void;
};

export const useEditorStore = create<EditorState>((set) => ({
  transformMode: "translate",
  setTransformMode: (m) => set({ transformMode: m }),
  selectedPlacementId: null,
  setSelectedPlacementId: (id) => set({ selectedPlacementId: id }),
}));
