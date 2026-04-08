export type MapSummary = {
  mapName?: string;
  mapCode?: string;
  status?: string;
  updatedAt?: string;
  createdAt?: string;
  [key: string]: unknown;
};

export type ProjectRow = {
  id: string;
  name: string;
  map_code: string;
  created_at: string;
  updated_at: string;
};

export type AssetRow = {
  id: string;
  name: string;
  filename: string;
  storage_path: string;
  public_url: string;
  created_at: string;
};

export type PlacementRow = {
  id: string;
  project_id: string;
  asset_id: string;
  name: string;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  rot_x: number;
  rot_y: number;
  rot_z: number;
  rot_w: number;
  scale_x: number;
  scale_y: number;
  scale_z: number;
  created_at: string;
  updated_at: string;
};

export type LocalizeResponse = {
  poseFound: boolean;
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number; w: number };
  confidence?: number;
  mapIds?: string[];
  mapCodes?: string[];
  responseTime?: number;
};
