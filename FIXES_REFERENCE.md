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
