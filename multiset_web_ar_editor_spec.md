# Multiset Web-Based AR Editor — Detailed Implementation Spec

## 0) Goal

Build a **full end-to-end web-based AR authoring tool** on top of Multiset.

The tool should let a user:

1. create or upload a Multiset map
2. browse maps on a website
3. open a selected map in a Three.js-based editor
4. import one or more GLB assets
5. position, rotate, and scale those assets relative to the map
6. save the authored scene
7. open an AR viewer in WebXR
8. localize against the same Multiset map
9. render the authored content in the correct real-world pose

This is a **headless architecture**:
- Multiset provides map storage, processing, and localization
- we build the editor, asset pipeline, scene save/load, and runtime rendering

---

## 1) Prototype assumptions

To keep this simple:

- **Login is hardcoded**
- do **not** build a user auth system yet
- do **not** build a multi-user database yet
- use a single hardcoded “editor session”
- use a tiny backend only for:
  - holding Multiset credentials securely
  - proxying Multiset APIs
  - storing placements and project data

### Important note

Even with hardcoded login, we still need **some storage** for:
- projects
- map-to-project links
- imported asset metadata
- saved placements

The recommended prototype choice is **Supabase** because it is the easiest hosted setup that still feels production-like.

Use Supabase for:
- Postgres tables for project and placement data
- Storage buckets for uploaded GLBs

Keep a tiny backend only for:
- storing Multiset credentials securely
- generating and refreshing Multiset tokens
- proxying Multiset API calls

---

## 2) What we are building

## 2.1 Main product surfaces

### A. Map management flow
A browser flow where we can:
- list all Multiset maps
- inspect their status
- open a map in the editor
- later launch AR for that map

### B. Editor flow
A Three.js scene where we can:
- load the map mesh
- navigate around the map
- import GLB/GLTF assets
- transform those assets
- save the placements relative to the map coordinate system

### C. AR runtime flow
A WebXR runtime where we can:
- localize using Multiset
- get the device pose in the map coordinate system
- load the saved placements
- render the imported models aligned to the real world

### D. Capture / map creation flow
This can be one of two modes:

#### Mode 1 — simplest first version
Do **not** scan inside your own website.
Instead:
- create maps using the Multiset app or Multiset portal
- let the website only browse and edit existing maps

This is the recommended MVP.

#### Mode 2 — later
Build a website/mobile flow that initiates map creation uploads through your backend to Multiset.
This is possible, but only if you have the scan/source file workflow ready.

---

## 3) Recommended MVP boundary

## Build this first

1. hardcoded login screen
2. map list page
3. map details page
4. “Open in Editor” button
5. load map mesh into Three.js
6. import GLB
7. transform GLB
8. save placement JSON
9. “Open in AR” button
10. localize in WebXR
11. load and display placed content

## Do not build yet

- live collaborative editing
- user accounts
- publishing workflows
- revision history
- comments
- permissions
- mapset support
- capture inside browser
- multi-image localization
- analytics dashboard
- asset compression pipeline
- anchor editing helpers
- navmesh authoring

---

## 4) Tech stack

## Frontend
- Next.js
- TypeScript
- React
- Three.js
- optional: react-three-fiber
- Tailwind CSS
- Zustand for editor state

## Backend
- Node.js
- Express or Next.js API routes
- TypeScript

## Storage for prototype
- Supabase Postgres for app data
- Supabase Storage for uploaded GLBs

## AR runtime
Use:
- `@multisetai/vps`
- native WebXR
- Three.js scene for rendering

---

## 5) Verified Multiset APIs and capabilities

These are the relevant public pieces verified from current docs:

### Authentication
`POST https://api.multiset.ai/v1/m2m/token`

Used to generate a JWT token from:
- clientId
- clientSecret

The token expires in **30 minutes**.

### Map upload
`POST https://api.multiset.ai/v2/vps/map`

Starts multipart upload for a map file and returns:
- mapId
- mapCode
- uploadId
- signedUrls
- key

Then:
- upload each file chunk to the signed URLs
- call:

`POST https://api.multiset.ai/v2/vps/map/complete-upload/{id}`

with:
- uploadId
- key
- uploaded parts with ETags and PartNumber

### Map details
`GET https://api.multiset.ai/v1/vps/map/{mapCode}`

Returns map metadata including:
- status
- coordinates
- spatial metrics
- offline bundle information

### Map list
The docs reference account-level map retrieval. Use:
`GET https://api.multiset.ai/v1/vps/map`

### Localization
Single image JSON query:
`POST https://api.multiset.ai/v1/vps/map/query`

Single image form-data query:
`POST https://api.multiset.ai/v1/vps/map/query-form`

Multi-image query:
`POST https://api.multiset.ai/v1/vps/map/multi-image-query`

### File download
`GET https://api.multiset.ai/v1/file?key=...`

This returns a temporary presigned URL that can be used to download files such as map mesh assets.

### WebXR SDK
NPM package:
`@multisetai/vps`

The docs state that the WebXR SDK provides:
- authorization
- localization
- map detail retrieval
- WebXR session integration
- frame capture

---

## 6) Critical architectural decision

## Use a backend proxy

Even though the docs show browser-based auth for demos, the production guidance is to use a backend proxy because browser auth would expose Multiset credentials.

So for this project:

- frontend **never** stores `clientSecret`
- backend stores:
  - `MULTISET_CLIENT_ID`
  - `MULTISET_CLIENT_SECRET`
- backend fetches and refreshes Multiset token
- frontend talks to backend
- backend talks to Multiset

---

## 7) Hardcoded login design

Because you want something simple, implement:

### Frontend hardcoded gate
A single page with:
- password input
- compare against `NEXT_PUBLIC_EDITOR_PASSWORD`
- if correct, set `localStorage.editorUnlocked = "true"`

This is only for prototype convenience.

### Backend protection
Also protect backend routes with a shared header:

- frontend sends:
  - `x-editor-key: <hardcoded value>`
- backend checks against:
  - `EDITOR_SHARED_KEY`

This is still simple but prevents totally open public access.

---

## 8) Required environment variables

## Frontend
```env
NEXT_PUBLIC_EDITOR_PASSWORD=multiset-demo
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```

## Backend
```env
PORT=3000
EDITOR_SHARED_KEY=super-simple-shared-key
MULTISET_CLIENT_ID=your_multiset_client_id
MULTISET_CLIENT_SECRET=your_multiset_client_secret
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_GLBS_BUCKET=glb-assets
```

---

## 9) Backend responsibilities

The backend should own all Multiset communication and local app persistence.

## 9.1 Multiset token manager

Implement a token service:

### Behavior
- if cached token exists and is valid for at least 2 more minutes, reuse it
- otherwise request a new one from `/v1/m2m/token`
- store:
  - `token`
  - `expiresOn`

### Pseudocode
```ts
let cachedToken: string | null = null;
let expiresOn: number | null = null;

async function getMultisetToken() {
  const now = Date.now();

  if (cachedToken && expiresOn && now < expiresOn - 120000) {
    return cachedToken;
  }

  const basic = Buffer
    .from(`${process.env.MULTISET_CLIENT_ID}:${process.env.MULTISET_CLIENT_SECRET}`)
    .toString("base64");

  const res = await fetch("https://api.multiset.ai/v1/m2m/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientId: process.env.MULTISET_CLIENT_ID,
      clientSecret: process.env.MULTISET_CLIENT_SECRET,
    }),
  });

  if (!res.ok) throw new Error("Failed to get Multiset token");

  const data = await res.json();
  cachedToken = data.token;
  expiresOn = new Date(data.expiresOn).getTime();
  return cachedToken;
}
```

---

## 9.2 Backend routes to implement

### Health
- `GET /api/health`

### Maps
- `GET /api/maps`
- `GET /api/maps/:mapCode`
- `POST /api/maps/upload/start`
- `POST /api/maps/upload/complete`

### Files
- `GET /api/maps/:mapCode/download-mesh-url`

### Projects
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PUT /api/projects/:projectId`

### Placements
- `GET /api/projects/:projectId/placements`
- `POST /api/projects/:projectId/placements`
- `PUT /api/projects/:projectId/placements/:placementId`
- `DELETE /api/projects/:projectId/placements/:placementId`

### Assets
- `POST /api/assets`
- `GET /api/assets`
- `GET /api/assets/:assetId`

### Localization proxy
Choose one of these designs:

#### Option A — frontend localizes directly with `@multisetai/vps`
Fastest to ship, but may require exposing credentials in browser for SDK auth flow.

#### Option B — frontend captures frame and posts to backend
Backend forwards to:
- `/v1/vps/map/query`
or
- `/v1/vps/map/query-form`

For security and control, **Option B is preferred**.

Implement:
- `POST /api/localize`

---

## 10) Supabase data model

Use Supabase as the app database and storage layer. The frontend can still be hardcoded and simple; Supabase is just replacing the local JSON files and local asset folder.

## 10.1 Tables

### `projects`
```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  map_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### `assets`
```sql
create table assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  filename text not null,
  storage_path text not null,
  public_url text not null,
  created_at timestamptz not null default now()
);
```

### `placements`
```sql
create table placements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete restrict,
  name text not null,
  pos_x double precision not null,
  pos_y double precision not null,
  pos_z double precision not null,
  rot_x double precision not null,
  rot_y double precision not null,
  rot_z double precision not null,
  rot_w double precision not null,
  scale_x double precision not null,
  scale_y double precision not null,
  scale_z double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 10.2 Storage bucket

Create a Supabase Storage bucket called:
- `glb-assets`

Store imported `.glb` files there.

## 10.3 Minimal prototype policy

For the first prototype, keep it simple:
- private project
- no public uploads
- service role key only on backend
- frontend talks only to your backend for create/update flows

## 10.4 Example records

### Project
```json
{
  "id": "0d8c2d56-0a6c-4c69-a6d2-49dd9c4a1111",
  "name": "Lobby Demo",
  "map_code": "MAP_XXXXXXXX",
  "created_at": "2026-04-07T10:00:00.000Z",
  "updated_at": "2026-04-07T10:00:00.000Z"
}
```

### Asset
```json
{
  "id": "cb8fe5a0-90fa-4b63-9caa-02d13ce42222",
  "name": "Chair.glb",
  "filename": "chair.glb",
  "storage_path": "chairs/chair.glb",
  "public_url": "https://<project>.supabase.co/storage/v1/object/public/glb-assets/chairs/chair.glb",
  "created_at": "2026-04-07T10:00:00.000Z"
}
```

### Placement
```json
{
  "id": "7f8e86aa-2fc2-4d5b-85f2-4058a18b3333",
  "project_id": "0d8c2d56-0a6c-4c69-a6d2-49dd9c4a1111",
  "asset_id": "cb8fe5a0-90fa-4b63-9caa-02d13ce42222",
  "name": "Chair 01",
  "pos_x": 1.2,
  "pos_y": 0.0,
  "pos_z": -3.4,
  "rot_x": 0.0,
  "rot_y": 0.707,
  "rot_z": 0.0,
  "rot_w": 0.707,
  "scale_x": 1.0,
  "scale_y": 1.0,
  "scale_z": 1.0,
  "created_at": "2026-04-07T10:00:00.000Z",
  "updated_at": "2026-04-07T10:00:00.000Z"
}
```

---

## 11) Coordinate system model

This is the most important conceptual rule.

### Rule
All authored placements must be saved in the **map coordinate system**.

That means:
- the map is the source of truth
- imported GLBs are placed relative to the map origin
- localization returns the device pose in that same map coordinate space
- AR rendering uses the localized device pose to place virtual content correctly

### Therefore
The editor and runtime must agree on:
- axis orientation
- handedness
- units
- transform order

### Practical implementation
In the editor:
- load the map mesh at identity transform
- all placed assets are children of a root `mapRoot`
- save each object transform relative to `mapRoot`

In runtime:
- after localization succeeds, create a `mapRoot`
- solve the world transform of `mapRoot` from the returned device pose
- load the saved placements under that root

---

## 12) Map loading in the editor

## Goal
When a user opens a map, they should see the scanned environment mesh in the editor.

### Verified capability
The docs expose:
- `GET /v1/vps/map/{mapCode}` for map details
- `GET /v1/file?key=...` for presigned file download

### Implementation plan
1. fetch map details from backend
2. inspect the returned payload for offline bundle / file keys
3. identify the mesh `.glb` key
4. call `/v1/file?key=...` through backend
5. get presigned URL
6. load mesh into Three.js using `GLTFLoader`

### Important note
The docs confirm that map details include offline bundle information, but your agent should inspect the exact response payload and map the correct property names before hardcoding them.

### Backend route
`GET /api/maps/:mapCode/download-mesh-url`

### Expected server logic
1. get map details from Multiset
2. extract mesh key
3. call `GET /v1/file?key=...`
4. return `{ url }`

---

## 13) Asset import flow

Users should be able to import their own GLBs into the scene.

## Backend
Implement:
- `POST /api/assets`

### Behavior
- accept multipart upload
- upload file to Supabase Storage bucket `glb-assets`
- create an `assets` row in Supabase
- return:
  - asset id
  - public URL
  - filename
  - original name
  - storage path

### Frontend
- show “Import GLB” button
- upload file to backend
- immediately load returned URL into Three.js
- add it as a new editable placement

### Validation
Only allow:
- `.glb`
- optionally `.gltf` + associated files later

For MVP, support **only `.glb`**.

---

## 14) Editor scene design

## Scene graph
```text
scene
 └── worldRoot
      └── mapRoot
           ├── mapMesh
           └── placedObjectsRoot
                ├── placement_001
                ├── placement_002
                └── ...
```

## Camera controls
Use:
- orbit controls
- pan
- zoom
- frame selected object
- reset camera

## Object tools
Use:
- transform gizmo
- translation
- rotation
- scale
- duplicate object
- delete object

## Selection UX
- click selects object
- selected object gets outline/highlight
- inspector panel shows transform numbers
- transform numbers editable manually

---

## 15) Placement save format

Save each placement with:
- id
- projectId
- assetId
- human-readable name
- local transform relative to mapRoot

### Recommended transform representation
Use:
- position vector
- quaternion rotation
- scale vector

Do not store Euler angles as the source of truth.

---

## 16) Frontend pages

## `/login`
Hardcoded password gate.

## `/maps`
Shows list of Multiset maps:
- name
- map code
- status
- updated time
- open editor button
- open AR button

## `/maps/[mapCode]`
Map details page:
- name
- status
- map code
- processing state
- buttons:
  - create project
  - open latest project
  - open in AR

## `/editor/[projectId]`
Full editor UI:
- map viewport
- asset library sidebar
- inspector panel
- toolbar
- save button

## `/ar/[projectId]`
AR runtime page:
- start AR button
- localizing state
- confidence indicator
- render placed content after successful localization

---

## 17) Multiset map list integration

## Backend route
`GET /api/maps`

### Server logic
1. get valid Multiset token
2. call:
   - `GET https://api.multiset.ai/v1/vps/map`
3. return data to frontend

### Frontend UX
Display:
- mapName
- mapCode
- status
- maybe preview later
- create/open project button

---

## 18) Map details integration

## Backend route
`GET /api/maps/:mapCode`

### Server logic
1. get valid Multiset token
2. call:
   - `GET https://api.multiset.ai/v1/vps/map/{mapCode}`
3. return response to frontend

### Use this data for:
- verifying map is `active`
- reading map metadata
- locating downloadable asset keys
- project association

### Rule
Only allow opening editor / AR for maps whose status is `active`.

---

## 19) Optional map creation flow

This is only if you really want the website to initiate map creation.

### Flow
1. user chooses source scan file
2. frontend uploads file metadata to backend
3. backend calls:
   - `POST /v2/vps/map`
4. backend receives:
   - mapId
   - mapCode
   - uploadId
   - signedUrls
   - key
5. frontend or backend uploads each part to S3 signed URLs
6. backend completes:
   - `POST /v2/vps/map/complete-upload/{mapId}`

### Recommendation
For MVP, skip website scanning and skip browser map upload UI.
Use pre-created maps from:
- Multiset app
- Multiset portal
- existing scans

That gets you to the editor/AR loop much faster.

---

## 20) Localization design for AR runtime

There are two ways to implement runtime localization.

## Option A — use `@multisetai/vps`
This is the fastest path for WebXR.

Pros:
- easier setup
- handles WebXR-specific capture pieces
- already designed for WebXR
- likely less fragile than building raw camera extraction yourself

Cons:
- browser-side auth may be awkward if you want to keep secrets hidden

## Option B — your own WebXR capture + backend `/api/localize`
This is the most controlled path.

Pros:
- secrets stay on backend
- same backend route can later support mobile/web/robotics
- easier to swap localization strategy later

Cons:
- more engineering work

### Recommendation
For the prototype:
- first try **Option A** if it works cleanly with your environment
- if you want a more production-like path, move to **Option B**

---

## 21) Runtime localization with backend proxy

If using your own backend localization route:

### Frontend runtime flow
1. start WebXR session
2. capture frame
3. get camera intrinsics
4. encode image
5. send to backend:
   - mapCode
   - queryImage
   - fx, fy, px, py
   - width, height
   - isRightHanded if needed
6. backend forwards to Multiset
7. backend returns:
   - poseFound
   - position
   - rotation
   - confidence
8. frontend places AR world accordingly

### Backend route
`POST /api/localize`

### Request body
Use one of two shapes:

#### JSON version
```json
{
  "mapCode": "MAP_XXXXXXXX",
  "cameraIntrinsics": {
    "fx": 664.38,
    "fy": 664.38,
    "px": 478.97,
    "py": 364.99
  },
  "resolution": {
    "width": 960,
    "height": 720
  },
  "isRightHanded": false,
  "queryImage": "data:image/png;base64,..."
}
```

#### Form-data version
Use:
- mapCode
- fx
- fy
- px
- py
- width
- height
- queryImage

### Recommendation
Use **query-form** first for simplicity if you already have a Blob/File.

---

## 22) Localization response handling

The docs show a response shape like:

```json
{
  "poseFound": true,
  "position": {
    "x": -2.87,
    "y": 1.40,
    "z": 7.67
  },
  "rotation": {
    "x": -0.003,
    "y": 0.675,
    "z": -0.003,
    "w": 0.737
  },
  "confidence": 0.91,
  "mapIds": ["..."],
  "mapCodes": ["MAP_..."],
  "responseTime": 2669
}
```

### Frontend behavior
- if `poseFound === false`:
  - show “Still localizing”
  - do not place content
- if `poseFound === true` but `confidence < 0.7`:
  - either reject
  - or show low-confidence warning
- if `poseFound === true` and confidence is good:
  - apply localization
  - load content

### Recommended threshold
Start with:
- accept pose only if `confidence >= 0.7`

---

## 23) Solving world alignment at runtime

This is the key transform problem.

You have:
- authored objects in map space
- runtime device pose returned in map space
- WebXR camera pose in session/world space

You need:
- `mapRoot` transform in XR world space

## Formula conceptually
If:
- `T_world_camera` = current camera transform from WebXR
- `T_map_camera` = camera transform returned by Multiset

Then:
- `T_world_map = T_world_camera * inverse(T_map_camera)`

After that:
- place `mapRoot` at `T_world_map`
- all authored placements under `mapRoot` now align correctly

### Important
Your agent must verify:
- handedness
- forward axis
- quaternion conventions
- whether the returned pose means map->camera or camera->map

Do not assume this blindly.
Implement a debug test scene with:
- axis gizmo
- known placed cube
- printed matrices

---

## 24) Runtime content loading

After localization succeeds:

1. fetch project placements
2. for each placement:
   - fetch asset URL
   - load GLB
   - set local transform from saved JSON
   - add under `placedObjectsRoot`

### Optimization
Cache assets by `assetId` so repeated placements do not re-download unnecessarily.

---

## 25) Supabase setup

## Create project
1. Create a Supabase project
2. Copy:
   - project URL
   - service role key
3. Create the tables from section 10
4. Create Storage bucket:
   - `glb-assets`
5. Keep the service role key **only on backend**

## Why this is easier
- no local DB setup
- no manual file hosting for GLBs
- easy dashboard to inspect rows and files
- can grow into real auth later without redoing your backend

## Recommended prototype policy setup
For the prototype, backend-only access is enough. Do not overbuild RLS policies yet if you are the only user. Start with service-role-only server access and add user auth later.

## 26) Suggested folder structure

```text
app/
  frontend/
    pages/
      login.tsx
      maps.tsx
      editor/[projectId].tsx
      ar/[projectId].tsx
    components/
      EditorCanvas.tsx
      MapList.tsx
      InspectorPanel.tsx
      AssetLibrary.tsx
      Toolbar.tsx
    lib/
      api.ts
      editorStore.ts
      loaders.ts
      transforms.ts

  backend/
    src/
      index.ts
      middleware/
        auth.ts
      services/
        multisetTokenService.ts
        multisetMapService.ts
        multisetLocalizationService.ts
        projectService.ts
        assetService.ts
      routes/
        maps.ts
        projects.ts
        placements.ts
        assets.ts
        localize.ts

```

---

## 27) Precise backend-to-Multiset integrations

## 26.1 Generate token
### Endpoint
`POST https://api.multiset.ai/v1/m2m/token`

### Needed from Multiset dashboard
- client ID
- client secret

### What your backend must send
- `Authorization: Basic base64(clientId:clientSecret)`

### What your backend receives
- token
- expiresOn

---

## 26.2 List maps
### Endpoint
`GET https://api.multiset.ai/v1/vps/map`

### Needed
- bearer token from M2M auth

### Use for
- maps page
- map selection

---

## 26.3 Get map details
### Endpoint
`GET https://api.multiset.ai/v1/vps/map/{mapCode}`

### Needed
- bearer token
- mapCode

### Use for
- status validation
- map metadata
- mesh/offline bundle lookup

---

## 26.4 Download map mesh
### Endpoint
`GET https://api.multiset.ai/v1/file?key=<fileKey>`

### Needed
- bearer token
- file key extracted from map details

### Use for
- loading the map mesh into editor

---

## 26.5 Localize
### Endpoint
Choose one:
- `POST https://api.multiset.ai/v1/vps/map/query`
- `POST https://api.multiset.ai/v1/vps/map/query-form`

### Needed
- bearer token
- mapCode
- query image
- camera intrinsics
- resolution
- handedness if required

### Use for
- AR runtime

---

## 28) What keys / credentials you need

From **Multiset dashboard** you need:

1. **Client ID**
2. **Client Secret**
3. **Map Code(s)** for maps you want to use

Potentially also:
4. allowed domains / CORS configuration if using browser/WebXR directly

### You do NOT need
- a Multiset “login API” for your app users for this prototype
- a user database for hardcoded login
- separate per-user Multiset accounts

---

## 29) What code your backend must expose to frontend

Your frontend should never call Multiset directly for the core prototype.
It should call only your backend.

### Frontend needs these app endpoints

#### Maps
- `GET /api/maps`
- `GET /api/maps/:mapCode`

#### Projects
- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/:projectId`

#### Placements
- `GET /api/projects/:projectId/placements`
- `POST /api/projects/:projectId/placements`
- `PUT /api/projects/:projectId/placements/:placementId`
- `DELETE /api/projects/:projectId/placements/:placementId`

#### Assets
- `POST /api/assets`
- `GET /api/assets`

#### Localization
- `POST /api/localize`

#### Map mesh helper
- `GET /api/maps/:mapCode/download-mesh-url`

---

## 30) Editor save/load flow

## Create project
When user clicks “Create Project” on a map:
- create a `projects` row in Supabase with `map_code`
- route to `/editor/:projectId`

## Open editor
On page load:
1. fetch project
2. fetch map details
3. fetch mesh URL
4. load map mesh
5. fetch placements
6. fetch asset metadata
7. spawn all placed objects

## Save placement
On move/rotate/scale:
- debounce save to backend
- store local transform only

### Recommended save triggers
- manual save button
- autosave after 1 second idle
- before page unload

---

## 31) Simplest implementation order

## Phase 1 — backend shell
- token service
- Supabase client setup
- maps list
- map details
- mesh download helper
- project/placement/asset CRUD using Supabase

## Phase 2 — frontend map browser
- hardcoded login
- maps page
- project creation

## Phase 3 — editor
- Three.js viewport
- load map mesh
- orbit controls
- GLB import
- transform gizmo
- placement save/load

## Phase 4 — AR runtime
- WebXR page
- localization call
- solve mapRoot
- load placements
- render assets

## Phase 5 — polish
- asset list
- duplicate/delete
- confidence UI
- relocalization button
- error states

---

## 32) Important unknowns your agent must verify during implementation

These are not blockers, but they must be checked in code:

1. the exact property path in map details for downloadable mesh/offline bundle file keys
2. the exact pose convention from localization:
   - map->camera or camera->map
3. handedness conversion between Multiset result and Three.js/WebXR
4. whether `@multisetai/vps` can be used cleanly without exposing sensitive credentials in your desired deployment
5. whether browser-direct CORS/domain allowlisting is needed for your chosen runtime path

---

## 33) Recommended MVP shortcut

To get this running fast:

### Do this
- hardcoded login
- backend proxy
- pre-existing Multiset maps
- editor using downloaded map mesh
- one GLB import type
- one project per map
- single-image localization only

### Avoid this for now
- capture in website
- full scanning flow
- browser-side secret handling
- multi-image query
- mapset logic

This will give you a working end-to-end prototype much faster.

---

## 34) Final build summary for the agent

Build a prototype web app with:
- hardcoded login
- a backend that securely authenticates to Multiset using M2M credentials
- a map browser that lists maps from Multiset
- a Three.js editor that loads a selected map mesh and lets the user import and place GLBs
- Supabase persistence for projects, assets, and placements
- a WebXR runtime page that localizes against the selected map using Multiset and renders the saved placements in AR

### Required Multiset inputs
- `MULTISET_CLIENT_ID`
- `MULTISET_CLIENT_SECRET`
- one or more `MAP_CODE`s
- map assets accessible through map details + file download endpoint

### Required output of the prototype
A user can:
1. open map
2. place asset
3. save scene
4. open AR
5. localize
6. see asset in the real world

---

## 35) Optional next step after prototype

After the first version works, the next upgrade should be:

- replace hardcoded login with Clerk or Supabase Auth
- add Row Level Security and proper user ownership in Supabase
- add map thumbnails and project list
- add publish/draft status
- support multiple users

