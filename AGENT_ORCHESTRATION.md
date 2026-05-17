# Agent orchestration guide

This document is the **primary onboarding reference** for AI agents and developers working in this repository. It covers **setup**, **security boundaries**, **Next.js API routes**, **server libraries**, **shared client libraries**, and **reusable components** that implement the Multiset VPS REST integration.

**Out of scope here:** editor pages, AR page UI, login/maps UI flows, and demo sandbox pages. See `MAP_QUERY_REST_ARCHITECTURE.md` for localization deep-dives and `/api-flow` for an interactive API flow diagram.

**Official Multiset docs:** [Map query (REST)](https://docs.multiset.ai/basics/rest-api-docs/map-query)

---

## What this repo does

A **Next.js 14** app that:

1. Keeps **Multiset M2M credentials server-side** and proxies VPS calls (maps, localization, mesh download).
2. Stores **projects**, **GLB assets**, and **placements** in **Supabase** (app data, not Multiset).
3. Provides **capture utilities** (WebXR + webcam) that build correct `multipart/form-data` for map query.
4. Solves **coordinate frames** (`T_world_map`) from Multiset REST + WebXR tracking.

```mermaid
flowchart TB
  subgraph browser [Browser / scripts]
    CAP[xrCapture / webcamCapture]
    UP[mapUploadParts]
    API_CLIENT[apiFetch + apiUrl]
    CAP --> API_CLIENT
    UP --> API_CLIENT
  end

  subgraph next [Next.js server]
    MW[middleware: x-editor-key]
    ROUTES[/api/* routes]
  subgraph libs [src/lib/server]
      TOK[multisetToken]
      MAP[multisetMap]
      UPL[multisetMapUpload]
      SB[supabaseAdmin]
    end
    MW --> ROUTES
    ROUTES --> libs
  end

  subgraph external [External]
    MS[(api.multiset.ai)]
    SU[(Supabase)]
  end

  API_CLIENT --> MW
  TOK --> MS
  MAP --> MS
  UPL --> MS
  SB --> SU
```

---

## Setup (do this first)

### 1. Install and run

```bash
npm install
cp .env.example .env.local
# Fill in .env.local (see Environment variables below)
npm run dev
```

Default dev URL: `http://localhost:3000`. Health check (no auth): `GET /api/health`.

### 2. Environment variables

Copy from `.env.example` into `.env.local` (local) or your host’s env UI (production).

| Variable | Scope | Required for | Notes |
|----------|-------|--------------|-------|
| `MULTISET_CLIENT_ID` | Server | Multiset APIs | Never expose to the browser |
| `MULTISET_CLIENT_SECRET` | Server | Multiset APIs | Pair with client ID for M2M token |
| `EDITOR_SHARED_KEY` | Server | All `/api/*` except health | Must match client header |
| `NEXT_PUBLIC_EDITOR_SHARED_KEY` | Browser build | `apiFetch` | Sent as `x-editor-key` |
| `NEXT_PUBLIC_API_BASE_URL` | Browser build | Optional | Empty = same origin |
| `SUPABASE_URL` | Server | Projects, assets, placements, AR logs | |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Same | Service role only on server |
| `SUPABASE_GLBS_BUCKET` | Server | Asset uploads | Default `glb-assets` |
| `SUPABASE_AR_LOGS_BUCKET` | Server | AR log files | Default `ar-logs` |
| `NEXT_PUBLIC_CAMERA_VERTICAL_FOV` | Browser | Webcam intrinsics estimate | Default ~60° in code |
| `NEXT_PUBLIC_VPS_IS_RIGHT_HANDED` | Browser | `isRightHanded` on localize | Unset = `true` |
| `NEXT_PUBLIC_AR_LOCALIZE_POSE_MODE` | Browser | Pose interpretation | `direct` \| `unity` \| `lhsReflection` \| `invMapCam` |

**Netlify / serverless:** `MULTISET_*` and `EDITOR_SHARED_KEY` must be scoped to **Functions** (not Builds-only). Redeploy after changing server env vars.

### 3. Supabase schema

Run `supabase/schema.sql` in the Supabase SQL editor. Create a **public** storage bucket `glb-assets` (or the name in `SUPABASE_GLBS_BUCKET`) for uploaded GLBs. For AR diagnostics, ensure bucket `ar-logs` exists (the API can try to create it).

Tables: `projects`, `assets`, `placements`, `ar_logs`.

### 4. Verify Multiset connectivity

With env vars set:

```bash
curl -s http://localhost:3000/api/health
curl -s -H "x-editor-key: YOUR_EDITOR_SHARED_KEY" http://localhost:3000/api/maps
```

---

## Security model (agents must respect this)

| Rule | Implementation |
|------|----------------|
| Multiset secret never in the browser | `MULTISET_CLIENT_ID` / `MULTISET_CLIENT_SECRET` only in `src/lib/server/*` |
| Browser calls only same-origin `/api/*` | `src/lib/api.ts` → `apiFetch` |
| API routes gated | `middleware.ts` requires `x-editor-key` === `EDITOR_SHARED_KEY` for `/api/*` except `/api/health` |
| M2M token cached server-side | `multisetToken.ts` — refresh ~2 min before `expiresOn`; one retry on 401 via `multisetMap.multisetFetch` |
| Presigned S3 mesh URLs | Short-lived; prefer `GET /api/maps/{mapCode}/mesh` for browser loaders (CORS-safe proxy) |

**Client header pattern:**

```ts
import { apiFetch } from "@/lib/api";

const res = await apiFetch("/api/localize", { method: "POST", body: formData });
```

Do not set `Content-Type` on `FormData` bodies — the runtime sets the multipart boundary.

---

## Upstream Multiset APIs (called from server code)

| Purpose | URL | Auth | Used by |
|---------|-----|------|---------|
| M2M token | `POST https://api.multiset.ai/v1/m2m/token` | Basic `base64(clientId:clientSecret)`, body `{}` | `multisetToken.ts` |
| List maps | `GET https://api.multiset.ai/v1/vps/map?page=1&limit=100` | Bearer | `multisetMap.listMaps` |
| Map details | `GET https://api.multiset.ai/v1/vps/map/{mapCode}` | Bearer | `multisetMap.getMapDetails` |
| File download URL | `GET https://api.multiset.ai/v1/file?key=...` | Bearer | `multisetMap.getFileDownloadUrl` |
| Create map | `POST https://api.multiset.ai/v2/vps/map` | Bearer JSON | `multisetMapUpload.createVpsMap` |
| Complete upload | `POST https://api.multiset.ai/v2/vps/map/complete-upload/{mapId}` | Bearer JSON | `multisetMapUpload.completeVpsMapUpload` |
| Map query | `POST https://api.multiset.ai/v1/vps/map/query-form` | Bearer multipart | `/api/localize` |

**Map upload (client + server):** After create, the browser uploads file parts with **direct PUT** to `signedUrls[].signedUrl` (not Multiset JSON API). ETags + part numbers go to complete-upload. See `mapUploadParts.ts`.

---

## Next.js API routes

All routes below require `x-editor-key` unless noted. Base path: `/api`.

### Health

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/health` | — | `{ ok: true, ts }` — **no auth** |

### Authentication (debug)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/api-flow/token` | — | Redacted token metadata for demos; forces token refresh |

Implementation: `src/app/api/api-flow/token/route.ts`.

### Localization

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/localize` | **multipart** or **JSON** | `LocalizeResponse` |

**Multipart fields** (forwarded to Multiset): `mapCode`, `fx`, `fy`, `px`, `py`, `width`, `height`, `isRightHanded`, `queryImage` (file).

**JSON body** (repacked to FormData server-side):

```json
{
  "mapCode": "MAP_XXXXX",
  "cameraIntrinsics": { "fx": 1000, "fy": 1000, "px": 640, "py": 360 },
  "resolution": { "width": 1280, "height": 720 },
  "isRightHanded": true,
  "queryImage": "data:image/jpeg;base64,..."
}
```

**Response type** (`src/lib/types.ts`):

```ts
type LocalizeResponse = {
  poseFound: boolean;
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number; w: number };
  confidence?: number;
  mapIds?: string[];
  mapCodes?: string[];
  responseTime?: number;
};
```

Implementation: `src/app/api/localize/route.ts`.

### Maps (Multiset proxy)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/maps` | — | Multiset list payload (normalized client-side via `normalizeMapList`) |
| `GET` | `/maps/{mapCode}` | — | Map details JSON |
| `GET` | `/maps/{mapCode}/download-mesh-url` | — | `{ url, meshKey }` presigned URL |
| `GET` | `/maps/{mapCode}/mesh` | — | **Binary** `model/gltf-binary` (same-origin GLB stream) |
| `POST` | `/maps/upload/start` | See below | `CreateVpsMapResult` |
| `POST` | `/maps/upload/complete` | See below | Complete-upload result |

**`POST /maps/upload/start` body:**

```json
{
  "mapName": "My map",
  "fileSize": 12345678,
  "coordinates": { "latitude": 0, "longitude": 0, "altitude": 0 },
  "heading": 0,
  "source": {
    "provider": "unity",
    "fileType": "zip",
    "coordinateSystem": "RHS"
  }
}
```

**`POST /maps/upload/complete` body:**

```json
{
  "mapId": "...",
  "uploadId": "...",
  "key": "vps-maps/...",
  "parts": [{ "ETag": "\"...\"", "PartNumber": 1 }]
}
```

### Projects, assets, placements (Supabase)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/projects` | — | `ProjectRow[]` |
| `POST` | `/projects` | `{ name, map_code }` | `ProjectRow` |
| `GET` | `/projects/{projectId}` | — | `ProjectRow` |
| `PUT` | `/projects/{projectId}` | `{ name }` | `ProjectRow` |
| `GET` | `/projects/{projectId}/placements` | — | `PlacementRow[]` |
| `POST` | `/projects/{projectId}/placements` | placement fields | `PlacementRow` |
| `PUT` | `/projects/{projectId}/placements/{placementId}` | partial transform | `PlacementRow` |
| `DELETE` | `/projects/{projectId}/placements/{placementId}` | — | `{ ok: true }` |
| `GET` | `/assets` | — | `AssetRow[]` |
| `POST` | `/assets` | `multipart`: `file` (.glb), optional `name` | asset metadata |
| `GET` | `/assets/{assetId}` | — | `AssetRow` |

Row shapes: `src/lib/types.ts`.

### AR diagnostics

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/ar-logs` | `{ event, ... }` or `{ logs: [...] }` | `{ ok, count, storagePath? }` |
| `GET` | `/ar-logs?projectId=&sessionId=&limit=&format=jsonl` | — | JSON array or downloadable `.jsonl` |

Max 25 log events per POST. Storage path pattern: `ar-logs/{project}/{date}/{session}/{seq}-{timestamp}-{event}.jsonl`.

---

## Server libraries (`src/lib/server`)

| Module | Responsibility |
|--------|----------------|
| `multisetToken.ts` | `getMultisetToken()`, in-memory cache, `clearMultisetTokenCache()` |
| `multisetMap.ts` | `multisetFetch`, `listMaps`, `getMapDetails`, `extractMeshKey`, `getFileDownloadUrl` |
| `multisetMapUpload.ts` | `createVpsMap`, `completeVpsMapUpload`, types `CreateVpsMapBody`, `CreateVpsMapResult` |
| `supabaseAdmin.ts` | Singleton admin client, `getGlbBucket()`, `getArLogsBucket()` |

**Token retry:** `multisetFetch` clears cache and retries once on HTTP 401.

---

## Shared client libraries (`src/lib`)

| Module | Responsibility |
|--------|----------------|
| `api.ts` | `apiUrl`, `apiFetch` (adds `x-editor-key`), `normalizeMapList` |
| `types.ts` | `MapSummary`, `ProjectRow`, `AssetRow`, `PlacementRow`, `LocalizeResponse` |
| `mapUploadParts.ts` | `uploadFilePartsToS3(file, signedUrls)` — PUT chunks, collect ETags |
| `ar/webcamCapture.ts` | Video frame → JPEG ≤1280px + FOV-based intrinsics |
| `ar/xrCapture.ts` | WebXR camera texture → JPEG; intrinsics from projection matrix; `captureFrameForLocalization` |
| `ar/mapPose.ts` | `buildMapCameraMatrix`, `solveWorldMapMatrix` — `T_world_map = T_world_camera * inv(T_map_camera)` |

### Localization constraints (agents implementing capture)

| Requirement | Detail |
|-------------|--------|
| Image format | JPEG |
| Max size | `max(width, height) ≤ 1280` after downscale |
| Intrinsics | `fx`, `fy`, `px`, `py` for **encoded** image dimensions |
| Handedness | `isRightHanded` string `"true"` / `"false"` on form |
| Map targeting | `mapCode` required; `mapSetCode` / `hintMapCode` per Multiset docs when using MapSets |
| Confidence | Treat as acceptance signal (~0.7 floor for high-accuracy UX) |

**WebXR capture:** Image pixels and `viewerMatrix` must come from the **same** `XRFrame`. Intrinsics scaled when downscaling (`xrCapture.ts`).

**Webcam capture:** Intrinsics are **estimated** from vertical FOV (`NEXT_PUBLIC_CAMERA_VERTICAL_FOV`); calibrate for production accuracy.

---

## Components (API-related only)

These are reusable UI pieces tied to backend flows. They do **not** include the 3D editor canvas.

| Component | Path | Role |
|-----------|------|------|
| `AuthGate` | `src/components/AuthGate.tsx` | Client-side gate (`localStorage` unlock); unrelated to `x-editor-key` but affects who reaches API-calling pages |
| `ScanCapture` | `src/components/ScanCapture.tsx` | Camera preview + WebM recording; produces `File` for map upload UX (expects zip/e57 from scan tools for real processing) |

For GLB loading against CORS, consumers should use **`apiUrl(\`/api/maps/${mapCode}/mesh\`)`** rather than raw S3 presigned URLs.

---

## End-to-end orchestration flows

### Flow A — Authenticate (server)

```
1. Server reads MULTISET_CLIENT_ID + MULTISET_CLIENT_SECRET
2. POST api.multiset.ai/v1/m2m/token (Basic auth)
3. Cache token until expiresOn - 2 minutes
4. Attach Authorization: Bearer <token> on upstream calls
```

No browser involvement.

### Flow B — Upload a VPS map

```
1. POST /api/maps/upload/start  → mapCode, mapId, uploadId, key, signedUrls[]
2. Client: uploadFilePartsToS3(file, signedUrls)  → parts[{ ETag, PartNumber }]
3. POST /api/maps/upload/complete  → { mapId, uploadId, key, parts }
4. Poll GET /api/maps/{mapCode} until status is active
```

Step 2 is **browser → S3**, not through Next.js.

### Flow C — Localize (single-image REST)

```
1. Capture frame (xrCapture or webcamCapture) → blob + intrinsics
2. Build FormData: mapCode, fx, fy, px, py, width, height, isRightHanded, queryImage
3. POST /api/localize (apiFetch)
4. Server: getMultisetToken → POST query-form to Multiset
5. Client: parse LocalizeResponse; if poseFound, solveWorldMapMatrix(viewerMatrix, response, mode)
```

### Flow D — App content (Supabase)

```
1. POST /api/assets (GLB upload)
2. POST /api/projects { name, map_code }
3. POST /api/projects/{id}/placements { asset_id, name, pos_*, rot_*, scale_* }
4. AR/runtime loads GET project + placements + mesh proxy
```

### Flow E — AR diagnostics

```
1. Client batches events → POST /api/ar-logs
2. Server writes ar_logs table + optional Storage .jsonl
3. Debug: GET /api/ar-logs?projectId=...&format=jsonl
```

---

## Agent task recipes

Use these as checklists when asked to implement or debug features.

| Task | Read first | Touch | Verify |
|------|------------|-------|--------|
| Fix localize 401/502 | `multisetToken.ts`, `.env` | env vars, token cache | `POST /api/localize` with test image |
| Add hint fields to localize | `localize/route.ts`, Multiset docs | append FormData fields | upstream accepts |
| Map upload failure | `mapUploadParts.ts`, upload routes | ETag quoting, part order | complete-upload 2xx |
| Mesh won’t load | `maps/[mapCode]/mesh/route.ts` | use mesh proxy URL | GLB bytes in browser |
| New CRUD field on placements | `schema.sql`, placements route, `types.ts` | migration + API | GET placements |
| Script-based localize | `localize/route.ts` JSON path | curl with data URL | `poseFound` in response |

**Do not** put `MULTISET_CLIENT_SECRET` in `NEXT_PUBLIC_*` or commit `.env.local`.

---

## File map (APIs and shared code)

```
middleware.ts                          # x-editor-key on /api/*
.env.example                           # env template

src/lib/
  api.ts                               # browser → /api client
  types.ts                             # shared DTOs
  mapUploadParts.ts                    # S3 multipart PUT helper
  server/
    multisetToken.ts
    multisetMap.ts
    multisetMapUpload.ts
    supabaseAdmin.ts
  ar/
    webcamCapture.ts
    xrCapture.ts
    mapPose.ts

src/app/api/
  health/route.ts
  localize/route.ts
  maps/route.ts
  maps/[mapCode]/route.ts
  maps/[mapCode]/mesh/route.ts
  maps/[mapCode]/download-mesh-url/route.ts
  maps/upload/start/route.ts
  maps/upload/complete/route.ts
  projects/route.ts
  projects/[projectId]/route.ts
  projects/[projectId]/placements/route.ts
  projects/[projectId]/placements/[placementId]/route.ts
  assets/route.ts
  assets/[assetId]/route.ts
  ar-logs/route.ts
  api-flow/token/route.ts              # debug token (redacted)

src/components/
  AuthGate.tsx                         # client unlock gate
  ScanCapture.tsx                      # camera / recording for uploads

supabase/schema.sql                    # DB schema
```

---

## Related documentation

| Document | Use when |
|----------|----------|
| `MAP_QUERY_REST_ARCHITECTURE.md` | Localization internals, intrinsics math, pose modes, AR runtime notes |
| `/api-flow` | Interactive API flow diagram for demos (not production architecture) |
| `.env.example` | Exact env var names for deployment |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-16 | Initial agent orchestration guide (APIs, server/client libs, setup, flows) |
