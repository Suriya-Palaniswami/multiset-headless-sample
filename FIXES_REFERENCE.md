# Multiset AR Fixes Reference

This document summarizes the fixes applied during debugging of map loading and WebXR localization.

## 1) Expired mesh URL (`403 Forbidden`) when opening map/editor

### Symptom
- Map mesh failed to load from a long S3 URL with `403`.
- URL query contained an old `X-Amz-Date` and `X-Amz-Expires=3600`.

### Root cause
- Presigned mesh URLs are short-lived and were being reused after expiry.

### Fix
- Updated server mesh-key extraction to normalize `meshLink` values and convert full URLs to stable object keys.
- Forced upstream Multiset fetches to `cache: "no-store"` so `/v1/file` always returns fresh presigned URLs.

### Files
- `src/lib/server/multisetMap.ts`

---

## 2) `{"error":"Map details failed: 401 {\"error\":\"Token expired\"}"}` on live

### Symptom
- Mesh URL endpoint sometimes returned 401 from Multiset due to stale token.

### Root cause
- Cached token became invalid before next use in long-lived runtime.

### Fix
- Added token cache clear helper and forced refresh path.
- Added one automatic retry on `401` in Multiset fetch wrapper:
  1. clear token cache
  2. fetch a new token
  3. retry the original request once

### Files
- `src/lib/server/multisetToken.ts`
- `src/lib/server/multisetMap.ts`

---

## 3) AR controls/logs not visible in immersive AR

### Symptom
- Only camera feed visible; overlay controls/status not showing.

### Root cause
- WebXR `domOverlay.root` pointed to the camera container while UI was rendered outside it.

### Fix
- Set `domOverlay.root` to the page root container that actually contains overlay controls.
- Kept tap fallback for environments where DOM overlay is suppressed.

### Files
- `src/app/ar/[projectId]/page.tsx`

---

## 4) Start AR / Localize UX confusion

### Symptom
- Flow was unclear; users saw camera feed but did not know what state app was in.

### Fix
- Added a clear runtime overlay status + debug log panel.
- Primary action button toggles:
  - `Start AR` before session
  - `Localize` (or `Relocalize`) when session is active/localized
- Added tap-to-localize fallback via XR `select` event.
- Added badges: localized state, confidence, and localization attempt count.

### Files
- `src/app/ar/[projectId]/page.tsx`

---

## 5) Localization frame capture support hardening

### Symptom
- Frequent message: localize blocked/no active session while tapping quickly.
- Frame capture failures were not clearly diagnosable.

### Fix
- Added explicit guard diagnostics for:
  - busy (in-progress localization)
  - missing XR session
  - missing XR reference space
  - missing AR scene root
- Added clearer capture-failure message.
- Requested `camera-access` as optional WebXR feature in AR session setup.

### Files
- `src/app/ar/[projectId]/page.tsx`

---

## 6) Localization API rejection: image resolution exceeded `1280x1280`

### Symptom
- Error example: `frame.jpg resolution 886x1920 exceeds maximum allowed resolutions of 1280x1280`.

### Root cause
- Raw camera frames were uploaded at full camera texture resolution.

### Fix
- Downscale captured frame before upload so max dimension is `1280`.
- Scale camera intrinsics (`fx`, `fy`, `px`, `py`) to resized resolution.
- Send resized `width`/`height` values in localization payload.

### Files
- `src/lib/ar/xrCapture.ts`

---

## 7) Editor placements do not line up in WebXR (wrong world alignment)

### Symptom
- Localization confidence is good (e.g. 0.85) but placed assets appear offset/rotated versus the real scene (or versus the editor).

### Root cause
- Multiset query with `isRightHanded: false` returns pose data in **LHS / Unity-style** coordinates, while Three.js + the editor use **RHS**.
- A single Z-axis matrix “reflection sandwich” is not always equivalent to the usual **Unity→Three** translation/quaternion swap; the wrong conversion shifts content even when localization is confident.

### Fix
- Default alignment uses common Unity→Three rules:
  - position: `(x, y, -z)`
  - quaternion: `(-qx, qy, -qz, qw)`
- World solve stays: `T_world_map = T_world_camera * inverse(T_map_camera)` (same algebraic identity as before; the change is how `T_map_camera` is built from the API).
- AR session uses **`local-floor`** reference space when available (falls back to `local`).
- Debug override: add query `?arAlign=<mode>` on the AR URL:
  - `unity` — default (Unity-style LHS→RHS; recommended first)
  - `direct` — no conversion (raw API numbers as Three compose)
  - `lhsReflection` — previous Z-reflection sandwich on the raw matrix
  - `invMapCam` — build `T_map_camera` then **invert** before the world solve (try if API convention is opposite)

### Files
- `src/lib/ar/mapPose.ts`
- `src/app/ar/[projectId]/page.tsx`

---

## 8) AR switched to official `@multisetai/vps` WebXR SDK

### Why
- Custom WebXR capture + `/api/localize` duplicated fragile semantics (intrinsics, handedness, viewer vs eye pose, image sizing).
- The SDK’s `WebxrController` + `MultisetClient` implement the same flow Multiset tests internally (`localizeFrame`, `applyMeshTransform`, default `isRightHanded: true` on `query-form`).

### Tradeoff
- `MultisetClient` **requires `clientId` + `clientSecret` in the browser bundle** for `authorize()`. Add `NEXT_PUBLIC_MULTISET_CLIENT_ID` / `NEXT_PUBLIC_MULTISET_CLIENT_SECRET` (see `.env.example`). Prefer a **demo-dedicated** Multiset app or accept the exposure for prototypes.

### Placements
- Editor placements are parented under the SDK’s internal `meshGroup` (same transform Multiset applies after localization), so they stay locked to the map.

### Files
- `src/app/ar/[projectId]/page.tsx`

---

## Verification checklist

1. Open editor/map for a known active map.
   - Mesh loads without old S3 URL `403`.
2. Call `/api/maps/{mapCode}/download-mesh-url`.
   - Returns `200` and a fresh presigned URL.
3. In AR page:
   - Start AR, then localize via button or screen tap.
   - Log panel updates with capture/localization steps.
4. Localization request image dimensions:
   - Max side <= `1280`.
5. If overlay is hidden on a device:
   - Tap screen still triggers localization attempts.

---

## Related recent commits

- `12fdb13` - fix xr localization frame size limit and intrinsics scaling
- `ba56ade` - fix ar dom overlay root for immersive controls
- `40dddab` - overlay logs and buttons
- `19a7a7d` - token/mesh fetch reliability fixes
