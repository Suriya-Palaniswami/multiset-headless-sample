Below is a self-contained Markdown brief you can hand to another agent.

---

## Unity-based Multiset mapping + integration brief

### Goal

Deliver a **Unity mobile** app that lets a user **scan a physical space**, **upload the capture to Multiset** as a **new VPS map**, wait forMultiset **processing**, then use **that map code** elsewhere (e.g. web AR with `@multisetai/vps`, or REST localization) — without requiring the user to supply a third-party Matterport/NavVis export file.

Companion context: repository `multiset-headless-sample` is a **Next.js** prototype that proxies Multiset **token**, **map list/detail**, **map upload (REST multipart)**, and **localization** for a **browser editor/AR demo**. Unity can either **talk to Multiset directly** (per Multiset’s Unity/SDK patterns) or **share map codes** with the web stack after maps appear in theMultiset account.

### Critical distinction (do not confuse)


| Concern                          | What it is                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Map creation (mapping)**       | Producing and uploading a **new map** artifact.Multiset documents a **Unity `MappingManager` flow** (`StartMapping`, `StopMapping`, `UploadMapData`) — see Unity docs: [https://docs.multiset.ai/unity-sdk/api-reference/mappingmanager](https://docs.multiset.ai/unity-sdk/api-reference/mappingmanager)                                                                                                                          |
| **Map ingestion via REST alone** | `POST https://api.multiset.ai/v2/vps/map` creates an upload session; client uploads chunks to **presigned S3 URLs**; `POST …/complete-upload/{mapId}` finishes. `**source`** is `**zip**` or `**e57**` plus `**provider**` (e.g. unity, matterport, leica, navvis) and `**coordinateSystem**` (LHS/RHS). See: [https://docs.multiset.ai/basics/rest-api-docs/map-upload](https://docs.multiset.ai/basics/rest-api-docs/map-upload) |
| **Localization (runtime)**       | **Image/query** endpoints: `/v1/vps/map/query`, `/v1/vps/map/query-form`, multi-image `/v1/vps/map/multi-image-query`. WebXR SDK uses `**captureFrame()`** for localization against an **existing** map — see WebXR docs: [https://docs.multiset.ai/basics/integrations](https://docs.multiset.ai/basics/integrations)                                                                                                             |


**Important:** Recording `**.webm` from `getUserMedia` + MediaRecorder** in the browser is **not** documented as equivalent to Multiset mapping capture.

### Credential model (production)

- **M2M** auth:Multiset issues tokens from `**POST https://api.multiset.ai/v1/m2m/token`** using Basic auth + client id/secret (exact body shape MUST matchMultiset’s latest docs/samples).
- **Do not bake `client_secret` into a shipped Unity consumer app.** Preferred patterns:
  - **Minimal:** Multiset Unity SDK/dashboard flow intended for prototypes (verify with Multiset/discord).
  - **Recommended for production demo:** Backend issues **short-lived tokens** or proxies sensitive calls (same idea as Next.js routes in sample).
- **CORS/domain allowlisting** matters for web: [https://docs.multiset.ai/basics/credentials/configuring-allowed-domains-cors](https://docs.multiset.ai/basics/credentials/configuring-allowed-domains-cors)

### Unity pipeline (conceptual steps)

Implement using Multiset Unity SDK **Mapping sample** + `**MappingManager`** (behavior names below are documented):

1. `**StartMapping()**` — Begins scanning: session directories, session id, AR session capture starts.
2. User moves through space ( Multiset handles capture internals).
3. `**StopMapping()**` — Stops scanning, triggers **compression/packaging to zip**.
4. `**MakeMapDraft()`** (optional) — Save locally for later upload.
5. `**UploadMapData()**` — Validates map name, saves draft if applicable, uploads toMultiset cloud (**creates map + upload** inside their stack — confirm exact API usage in Unity package version).
6. Obtain `**mapCode`** (and `mapId` if surfaced) after processing; poll map status via REST orMultiset portal.

Reference: [https://docs.multiset.ai/unity-sdk/api-reference/mappingmanager](https://docs.multiset.ai/unity-sdk/api-reference/mappingmanager)  

**Agent checklist for Unity:**

- Identify exact Multiset Unity package version & sample scene shipped with docs.
- Target **Android (ARCore)** and/or **iOS (ARKit)** per UnityMultiset requirements.
- Handle **HTTPS / permissions**, **battery**, **thermal throttling**, **storage**, **crash recovery**, **offline draft + retry upload**.
- Expose `**mapCode` to user** + deep link/copy for web editor demo.

### REST map upload pipeline (secondary path / hybrid demo)

Only needed if implementing **manual zip upload from Unity-built zip** outside `UploadMapData()`:

1. Obtain bearer token (`/v1/m2m/token`).
2. `**POST https://api.multiset.ai/v2/vps/map`** with JSON:
  - `mapName`
  - `fileSize` (bytes)
  - `coordinates`: `{ latitude, longitude, altitude }`
  - optional `heading`
  - `source`: `{ provider, fileType, coordinateSystem }`
3. For each `**signedUrl**`, `**PUT**` chunk (`application/octet-stream`), collect `**ETag**` per part (strip quotes/`W/` as needed — match working client).
4. `**POST https://api.multiset.ai/v2/vps/map/complete-upload/{mapId}**` with `uploadId`, `key`, `parts[]` of `{ ETag, PartNumber }`.

Reference: [https://docs.multiset.ai/basics/rest-api-docs/map-upload](https://docs.multiset.ai/basics/rest-api-docs/map-upload)  

**Note:** In the sample repo, client-side multipart S3 uploads can surface errors like `**Load failed`** on some browsers/origins ; production often proxies uploads server-side if CORS/policy blocks PUT from web.

### Next.js prototype (existing) — reuse for dashboards / hybrid flow

Repo path (local): `**multiset-headless-sample**` (Next.js App Router).

**Relevant implementations:**

- `src/lib/server/multisetToken.ts` — M2M token (server-only env).
- `src/lib/server/multisetMapUpload.ts` — `POST /v2/vps/map`, complete upload.
- `src/app/api/maps/upload/start` + `/complete` — proxy map upload from browser.
- `src/lib/mapUploadParts.ts` — browser multipart PUT to presigned URLs.

**Frontend env vars (conceptual placeholders):**


| Variable                        | Role                                        |
| ------------------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`      | API base (`""` = same-origin).              |
| `NEXT_PUBLIC_EDITOR_SHARED_KEY` | Sent as `x-editor-key` by `src/lib/api.ts`. |
| `NEXT_PUBLIC_EDITOR_PASSWORD`   | Demo gate password.                         |


**Server env:**


| Variable                 | Role                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `MULTISET_CLIENT_ID`     | Multiset M2M client id                                                                          |
| `MULTISET_CLIENT_SECRET` | Multiset M2M secret (never expose client-side)                                                  |
| `EDITOR_SHARED_KEY`      | Validates `x-editor-key` from browser (implement in middleware/route handlers as project does). |


Agent must never commit real secrets — useMultiset dashboard values per environment only.

### Post-upload: localization on web / REST

Once map is `**active`** (poll `GET https://api.multiset.ai/v1/vps/map/{mapCode}`):

- **WebXR** sample flow: authorize client, `**WebxrController`**, `**captureFrame()**`.  
[https://docs.multiset.ai/basics/integrations](https://docs.multiset.ai/basics/integrations)  
- Or backend proxy `**/vps/map/query-form**` etc. Sample spec in `multiset_web_ar_editor_spec.md` discusses Option B preference.

Multi-image localization requires **4–6** images — seeMultiset map query docs (multi-image section).

### Other Multiset inputs (Gaussian Splat / advanced)

Multiset documents **Gaussian Splats** as zipped `**.ply` + `poses.json`** with strict root layout and metric scale constraints — typically **third-party toolchain**, not “random phone photos”:  
[https://docs.multiset.ai/basics/third-party-scans/gaussian-splat](https://docs.multiset.ai/basics/third-party-scans/gaussian-splat)  

Agent should treat this as optional unlessMultiset confirms it matches Unity capture zip format.

### Open questions — confirm withMultiset (Discord/support)

Paste or adapt:

> I understand the Unity `**MappingManager`** capture/upload path exists. Can I achieve the **same capture-to-map outcome using only web** (photos/video) **without intermediate reconstruction**, or does REST ingestion only accept **zip/e57 (+ provider/coordinate)**? If web-only capture is unsupported, recommended **minimal reconstruction artifact**?

### Deliverables for the agent (recommended)

**Unity:**
-Multiset Unity SDK wired; mapping scene with **start/stop/upload**; persists **draft**; uploads with retry; surfaces **mapCode** + upload/processing status + errors.

**Documentation inside repo:**

- `README` section: Unity build prerequisites,Multiset dashboard steps, obtaining `MAP_XXX`, pairing with Next.js `/maps`.

**Integration story (demo):**

- Unity creates map → user copies `MAP_XXX` → open web `/maps/{mapCode}` or AR page with same `mapCode`.

**Security:**

- No `client_secret` in Unity prod build; clarify token strategy withMultiset.

---

