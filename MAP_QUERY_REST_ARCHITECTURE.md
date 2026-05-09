# Multiset map query (REST) — architecture & reference

**Last updated:** 2026-05-09  

This document describes how this sample uses **Multiset’s VPS REST APIs** for localization (map query) with **camera frames** or **offline video frames**, without the WebXR NPM SDK. It is meant to stay in sync with implementation details you need for scripts (resolution, intrinsics, endpoints, coordinates).

**Official docs:** [Map query (REST)](https://docs.multiset.ai/basics/rest-api-docs/map-query)

---

## Goals and scope

| In scope | Out of scope (see Multiset docs) |
|----------|-----------------------------------|
| Single-image **form-data** query (`query-form`) via our **server proxy** | Raw browser → `api.multiset.ai` with client secret (never ship secrets to the client) |
| Max **1280 px** long edge, JPEG encoding, intrinsics matching the encoded image | Multi-image query API (4–6 images + SLAM poses) — summarized below for reference only |
| **Auth:** M2M bearer token on the server | Geo / floor hints (`hintPosition`, `hintFloorHeight`) — supported by API; wire when needed |

---

## High-level architecture

```mermaid
flowchart LR
  subgraph client [Browser]
    V[Video element / file frame]
    C[Canvas downscale + JPEG]
    FD[FormData fields]
    V --> C --> FD
  end
  subgraph next [Next.js server]
    L["POST /api/localize"]
    T[getMultisetToken]
    Q[POST .../vps/map/query-form]
    L --> T --> Q
  end
  FD -->|HTTPS + editor key| L
  Q -->|Bearer token| API[(api.multiset.ai)]
```

1. **Browser** captures a **single frame** (live `getUserMedia` or, in your script, a decoded video frame) as **JPEG**.
2. Browser builds **multipart FormData** with **map code**, **pinhole intrinsics**, **width/height** of the **encoded** image, **`isRightHanded`**, and the **image file** (field name `queryImage` in our proxy).
3. **`POST /api/localize`** (this repo) attaches the **Multiset M2M token** and forwards the body to **`https://api.multiset.ai/v1/vps/map/query-form`**.
4. Response JSON is the **localization result** (`poseFound`, `position`, `rotation`, `confidence`, etc.).

**Why a server route?**  
`MULTISET_CLIENT_ID` / `MULTISET_CLIENT_SECRET` must stay **server-only**. The browser never holds the Multiset secret.

**Editor protection:**  
`apiFetch` sends `x-editor-key` when `NEXT_PUBLIC_EDITOR_SHARED_KEY` is set. **`/api/localize` currently does not verify that header** (unlike some other routes)—add a guard if you expose this app on the public internet.

---

## Endpoints used in this repo

| Role | URL | Method |
|------|-----|--------|
| M2M token | `https://api.multiset.ai/v1/m2m/token` | `POST`, body `{}`, `Authorization: Basic base64(clientId:clientSecret)` |
| Map query (form) | `https://api.multiset.ai/v1/vps/map/query-form` | `POST`, `Authorization: Bearer <token>`, body `multipart/form-data` |

Implementation: `src/lib/server/multisetToken.ts`, `src/app/api/localize/route.ts`.

---

## Query image: format, resolution, color

| Requirement | Detail |
|-------------|--------|
| **Encoding** | **JPEG** (this sample: `image/jpeg` from canvas `toBlob`). |
| **Max resolution** | **Neither width nor height may exceed 1280 px** per Multiset documentation. |
| **Downscaling** | If the source is larger, scale uniformly so `max(width,height) ≤ 1280` **before** upload. |
| **Aspect** | Preserve aspect ratio; intrinsics must match the **final** pixel width/height. |
| **Color** | Standard 8-bit color; avoid extreme compression that wipes texture detail. |
| **Quality (this app)** | `QUERY_JPEG_QUALITY ≈ 0.82` in `src/lib/ar/webcamCapture.ts` (tunable). |

**Video / script workflow:** extract frames (e.g. ffmpeg), resize so long edge ≤ 1280, export JPEG, then either:

- call **`/api/localize`** with **multipart** the same as the browser, or  
- call **`/api/localize`** with **JSON** + **base64 data URL** (see route handler) from a trusted server-side script.

---

## Camera intrinsics (fx, fy, px, py) and `width` / `height`

Multiset expects **pinhole camera parameters in pixel units** for the **same** `width` × `height` as the query image.

### Field meanings (typical)

- **`fx`, `fy`**: focal lengths in **pixels** (two values allow non-square pixels; we often derive both from one vertical FOV assumption).
- **`px`, `py`**: principal point (usually near **width/2**, **height/2** for centered cameras).
- **`width`, `height`**: dimensions of the **encoded** query image (after downscale).

### What this sample does (webcam)

In **`src/lib/ar/webcamCapture.ts`**:

- Downscale the frame so **max dimension ≤ 1280**.
- Assume a **configurable vertical FOV** (default **60°**), set via `NEXT_PUBLIC_CAMERA_VERTICAL_FOV` if needed.
- Compute:

  \[
  f_y = \frac{h}{2 \tan(\mathrm{vFOV}/2)}, \quad
  f_x = f_y \cdot \frac{w}{h}, \quad
  p_x = w/2, \quad p_y = h/2
  \]

This is an **engineering estimate**, not a physical calibration. For production or tight alignment with a 3D map, **calibrate** the camera or read intrinsics from **ARCore / ARKit** if available.

### If you resize an image after capture

Multiply **`fx`, `fy`, `px`, `py`** by the **uniform scale factor** \(s\) from original → resized (same as we did for WebXR in `xrCapture.ts`). **Always** tie intrinsics to the **JPEG you send**.

### WebXR / `camera-access` (current AR path)

`src/lib/ar/xrCapture.ts` derives intrinsics from **WebXR projection matrix** and uses **`readPixels`** from the XR camera texture. This is how the current AR page captures the localization frame while keeping localization on Multiset REST.

---

## Handedness: `isRightHanded`

Sent as **`isRightHanded`** on the form (string `"true"` / `"false"`).

- This sample defaults to **`true`**, aligned with Multiset’s Web/SDK convention for **form** queries (see historical use of `@multisetai/vps` andMultiset samples).
- Set **`NEXT_PUBLIC_VPS_IS_RIGHT_HANDED=false`** in the browser build if your pipeline assumes **LHS (Unity)** for incoming/outgoing poses ([Multiset hint docs](https://docs.multiset.ai/basics/rest-api-docs/map-query) → `hintPosition`).

**Multiset documentation note:** `hintPosition` is described in **LHS** under the documented conventions; always cross-check your **Three.js / glTF** vs **Unity** conversion when placing content.

Reference: [Map query](https://docs.multiset.ai/basics/rest-api-docs/map-query) and related hint pages linked there.

---

## Our Next.js proxy: `POST /api/localize`

**File:** `src/app/api/localize/route.ts`

### Multipart (browser)

Same fields the upstream form API expects; **do not** set `Content-Type` manually—`fetch` sets the boundary.

Typical fields appended in the client:

- `mapCode`
- `fx`, `fy`, `px`, `py`
- `width`, `height`
- `isRightHanded`
- `queryImage` — **File** / `Blob` (filename e.g. `query.jpg`)

### JSON (scripts / tools)

Supported for convenience:

```json
{
  "mapCode": "MAP_XXXXX",
  "cameraIntrinsics": { "fx": 1000, "fy": 1000, "px": 640, "py": 360 },
  "resolution": { "width": 1280, "height": 720 },
  "isRightHanded": true,
  "queryImage": "data:image/jpeg;base64,..."
}
```

The route **repacks** this into **`FormData`** for `query-form`. **Do not** hand-set `multipart` Content-Type on the client.

---

## AR page behavior (browser)

**File:** `src/app/ar/[projectId]/page.tsx`

- Loads **project** → **`map_code`**, placements, asset URLs from this app’s APIs.
- Starts a minimal **vanilla WebXR** `immersive-ar` session through `navigator.xr`; WebXR owns session lifecycle, `XRWebGLLayer`, reference space, frame loop, local tracking, select events, and camera texture access.
- Uses **Three.js only as the renderer/scene graph** for authored placements. The AR runtime does not use React Three Fiber, `@react-three/xr`, the Multiset WebXR SDK, Three's `XRButton`, or Three's `WebXRManager` session loop.
- Safe mode defaults: **no `dom-overlay`** in `requestSession`, renderer pixel ratio capped to **≤ 1**, and WebXR framebuffer scale capped by `NEXT_PUBLIC_AR_FRAMEBUFFER_SCALE` (default `0.5`). Set `NEXT_PUBLIC_AR_DOM_OVERLAY=true` only when debugging overlay UI inside XR.
- Because DOM overlays are disabled by default, the immersive AR view includes a small Three-rendered HUD indicator: blue = ready, yellow = localizing, green = localized, red = error.
- The page canvas uses the full viewport, and XR render state uses a wider depth range (`0.01` → `10000`) to reduce placement clipping.
- On **Localize**, `src/lib/ar/xrCapture.ts` reads the WebXR camera texture, derives intrinsics from `XRView.projectionMatrix`, downscales the JPEG so max side ≤ **1280**, and sends it to **`/api/localize`**.
- Multiset REST returns **`T_map_camera`** (`position` + `rotation` in map space). WebXR provides **`T_world_camera`** for the exact captured frame. We solve:

  ```text
  T_world_map = T_world_camera * inverse(T_map_camera)
  ```

- The Three.js scene has a persistent **`mapRoot`**. Editor placements are loaded under `mapRoot/placedObjectsRoot`, so after localization they are in the same authored map coordinate frame as the editor.
- **Alignment:** `NEXT_PUBLIC_AR_LOCALIZE_POSE_MODE` selects `direct` (default, same frame as raw API + editor mesh) vs `unity` / `invMapCam` / etc. if your map uses different handedness.
- Relocalizing recomputes `T_world_map` and corrects drift. This is the browser equivalent of what Unity/ARCore/ARKit would do: the host runtime supplies local tracking; Multiset REST supplies the global/map correction.

---

## Editor: Multiset map mesh and CORS

**Symptom:** Opening the editor failed to load `TexturedMesh.glb` / `THREE.WebGLRenderer: Context Lost` after the browser logged **CORS** errors for `prod-multiset.s3-accelerate.amazonaws.com`.

**Cause:** The editor receives a **short-lived presigned S3 URL** from Multiset (`/api/maps/.../download-mesh-url`). The bucket does not send **`Access-Control-Allow-Origin`** for arbitrary web origins (e.g. Netlify), so **`useGLTF` / `fetch` from the browser is blocked**.

**Fix:** Load the mesh via a **same-origin proxy** instead of the naked S3 URL:

- **`GET /api/maps/[mapCode]/mesh`** — Next.js downloads the blob using the fresh presigned URL **on the server** and returns **`model/gltf-binary`** to the browser.
- The editor passes `apiUrl(\`/api/maps/${mapCode}/mesh\`)` into `EditorCanvas`.

**Files:** `src/app/api/maps/[mapCode]/mesh/route.ts`, `src/app/editor/[projectId]/page.tsx`

---

## AR Diagnostics in Supabase

**Files:** `src/app/api/ar-logs/route.ts`, `src/app/ar/[projectId]/page.tsx`, `supabase/schema.sql`

The AR page sends crash-adjacent breadcrumbs to **`POST /api/ar-logs`**, which stores:

- rows in the Supabase **`ar_logs`** table
- downloadable `.jsonl` text files in Supabase Storage bucket **`ar-logs`** (or `SUPABASE_AR_LOGS_BUCKET`)

Each browser page load gets a `sessionId`; each event gets a monotonic `seq` and `clientTs`. This keeps repeated test runs from looking like duplicate logs.

Important events include:

- `renderer_initialized`
- `start_ar_clicked`
- `immersive_ar_support_checked`
- `request_session_start`
- `webxr_session_started`
- `webgl_context_lost`
- `localize_start`
- `xr_capture_success` / `xr_capture_failed`
- `rest_localize_success` / `rest_localize_error`
- `placements_load_start` / `placements_load_success`
- `maproot_aligned`

Read recent logs from Supabase directly or through:

```text
GET /api/ar-logs?projectId=<uuid>&limit=100
GET /api/ar-logs?projectId=<uuid>&limit=100&format=jsonl
GET /api/ar-logs?projectId=<uuid>&sessionId=<session-id>&limit=100&format=jsonl
```

In Supabase Storage, download files from:

```text
ar-logs/<project-id>/<yyyy-mm-dd>/<session-id>/<seq>-<timestamp>-<event>.jsonl
```

Download one `<session-id>` folder when you want to analyze a single AR test attempt.

If `/api/ar-logs` returns `relation "ar_logs" does not exist`, run the latest `supabase/schema.sql` in the Supabase SQL editor. If Storage upload fails, create a private bucket named `ar-logs` in Supabase Storage (the API also tries to create it automatically with the service role key).

---

## Multi-image query API (reference only)

Multiset also exposes **`/vps/map/multi-image-query`**: **4–6** images per request with **per-image SLAM pose** (`imageN_data`). This sample **does not** implement it end-to-end; use the official OpenAPI YAML from the [map query docs](https://docs.multiset.ai/basics/rest-api-docs/map-query) when you need temporal robustness from a moving camera.

---

## Environment variables (relevant)

| Variable | Role |
|----------|------|
| `MULTISET_CLIENT_ID`, `MULTISET_CLIENT_SECRET` | Server M2M auth (required for `/api/localize`) |
| `NEXT_PUBLIC_EDITOR_SHARED_KEY` | Sent as `x-editor-key` from the browser |
| `NEXT_PUBLIC_CAMERA_VERTICAL_FOV` | Override default **60** (degrees) for estimated intrinsics |
| `NEXT_PUBLIC_VPS_IS_RIGHT_HANDED` | Set `false` to send `isRightHanded=false` from the AR page |
| `NEXT_PUBLIC_AR_LOCALIZE_POSE_MODE` | Pose interpretation for `T_map_camera`: `direct` (default), `unity`, `lhsReflection`, `invMapCam` |
| `NEXT_PUBLIC_AR_PIXEL_RATIO` | Optional WebXR renderer pixel ratio cap; default ≤ **1** for mobile stability |
| `NEXT_PUBLIC_AR_DOM_OVERLAY` | Set `true` to request WebXR `dom-overlay`; default disabled to avoid Android compositor crashes |

---

## Operational checklist for your video script

1. **Decode** frames at native or high resolution; **resize** so max side **≤ 1280**.
2. **Encode JPEG** (reasonable quality, not tiny).
3. Compute **intrinsics for the resized image** (calibrated preferred; else FOV model as above).
4. **POST** to your deployment’s **`/api/localize`** with the same multipart field names as the browser (or JSON + data URL).
5. Parse **`poseFound`**; if false, log `confidence` if present and try adjacent frames / exposure.
6. Optional: add **`hintPosition`** / **`hintRadius`** / **`hintFloorHeight`** when you have a pose prior (form fields as JSON strings per Multiset docs).

---

## Changelog (keep appending)

| Date | Change |
|------|--------|
| 2026-05-07 | AR page switched from `@multisetai/vps` WebXR to **REST** + webcam; added `webcamCapture.ts` and this document. |
| 2026-05-07 | JSON body path for `/api/localize`: `isRightHanded` default changed to **`true`** (omit field to match browser defaults). |
| 2026-05-09 | **`GET .../mesh`**: proxy Multiset map GLB for editor (**CORS**). Earlier interim AR overlay showed placements after REST localize as a snapshot. |
| 2026-05-09 | **AR overlay pose bugfix:** avoid R3F `camera` prop reset; apply localized camera in **`useFrame`**; optional `NEXT_PUBLIC_AR_LOCALIZE_POSE_MODE`. |
| 2026-05-09 | **AR overlay:** rewritten as **plain Three.js** (no R3F) for Multiset-style “vanilla” rendering stack. |
| 2026-05-09 | **AR runtime:** replaced webcam/snapshot overlay with **vanilla WebXR + REST**. WebXR supplies `T_world_camera`; Multiset REST supplies `T_map_camera`; app solves `T_world_map` and parents editor placements under `mapRoot`. |
| 2026-05-09 | **AR diagnostics:** added Supabase-backed `ar_logs` table and `/api/ar-logs` route; AR page sends WebXR/capture/localize/GL context breadcrumbs. |
| 2026-05-09 | **AR diagnostics:** `/api/ar-logs` also writes downloadable `.jsonl` text files to Supabase Storage bucket `ar-logs`; `GET ...&format=jsonl` returns a downloadable log file. |
| 2026-05-09 | **AR stability:** safe mode disables `dom-overlay` by default and caps renderer pixel ratio to ≤ 1; screen tap (`select`) still triggers localization in AR. |
| 2026-05-09 | **AR log management:** added `sessionId`, `seq`, and `clientTs`; Storage logs are grouped by browser session to make repeated test runs easier to download and compare. |
| 2026-05-09 | **AR stability:** capped WebXR framebuffer scale with `NEXT_PUBLIC_AR_FRAMEBUFFER_SCALE` (default `0.5`) because logs show crashes after WebXR session start but before REST localization. |
| 2026-05-09 | **AR runtime scope:** documented the CEO-approved split: vanilla WebXR for XR/session/tracking and Three.js only for rendering/editor-authored placements. |
| 2026-05-09 | **AR runtime:** replaced Three's `WebXRManager` session/render loop with a raw WebXR `XRWebGLLayer` + `session.requestAnimationFrame` loop; Three now only renders each XR view. |
| 2026-05-09 | **AR UX:** added a Three-rendered in-XR status HUD, clearer loading/localizing messages, full-viewport canvas layout, and wider XR depth range to reduce clipping. |
