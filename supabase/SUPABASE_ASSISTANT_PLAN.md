# Supabase setup plan — Multiset AR Editor (headless prototype)

**Paste this whole document into Supabase Assistant** (or any AI) and ask it to help you apply the steps, generate SQL, or validate your project.

---

## 1. Project context

- **App:** Next.js app with a **Node backend only** talking to Supabase.
- **Auth model:** No Supabase Auth for end users in v1. The backend uses the **service role key** (server-side only) for Postgres and Storage.
- **Frontend:** Never uses the Supabase anon key for writes in this prototype; it calls the Next.js API, which uses the service role.
- **Goal:** Store **projects** (linked to Multiset `map_code`), **assets** (GLB metadata + public URL), and **placements** (transforms in map space per project).

---

## 2. Environment variables to copy from Supabase (for the Next.js server)

After the project exists, the developer needs from **Project Settings → API**:

| Variable | Where |
|----------|--------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` secret (never expose to the browser or commit to git) |

Optional:

| Variable | Default |
|----------|---------|
| `SUPABASE_GLBS_BUCKET` | `glb-assets` |

---

## 3. Postgres tables (required)

Create these tables in the **SQL Editor** (or via migrations). Names and types must match what the app expects.

### `projects`

- `id` — `uuid`, primary key, default `gen_random_uuid()`
- `name` — `text`, not null
- `map_code` — `text`, not null (Multiset map identifier)
- `created_at` — `timestamptz`, not null, default `now()`
- `updated_at` — `timestamptz`, not null, default `now()`

### `assets`

- `id` — `uuid`, primary key, default `gen_random_uuid()`
- `name` — `text`, not null (display name)
- `filename` — `text`, not null (original file name)
- `storage_path` — `text`, not null (path inside the bucket, e.g. `{uuid}/{filename}.glb`)
- `public_url` — `text`, not null (full public URL to the object)
- `created_at` — `timestamptz`, not null, default `now()`

### `placements`

- `id` — `uuid`, primary key, default `gen_random_uuid()`
- `project_id` — `uuid`, not null, **foreign key** → `projects(id)` **ON DELETE CASCADE**
- `asset_id` — `uuid`, not null, **foreign key** → `assets(id)` **ON DELETE RESTRICT**
- `name` — `text`, not null
- `pos_x`, `pos_y`, `pos_z` — `double precision`, not null
- `rot_x`, `rot_y`, `rot_z`, `rot_w` — `double precision`, not null (quaternion, not Euler)
- `scale_x`, `scale_y`, `scale_z` — `double precision`, not null
- `created_at` — `timestamptz`, not null, default `now()`
- `updated_at` — `timestamptz`, not null, default `now()`

### Index

- Index on `placements(project_id)` for listing placements per project.

**Canonical SQL:** see `supabase/schema.sql` in the same repo.

---

## 4. Row Level Security (RLS)

**Prototype choice:** Backend uses **service role**, which **bypasses RLS** in Supabase.

- **Option A (minimal):** Enable RLS on all three tables with **no policies** for `anon` / `authenticated` — only the service role can access (via API). Suitable for a private single-user prototype.
- **Option B (stricter):** Explicitly **deny** default access for `anon`/`authenticated` and rely on service role for all operations (assistant can generate example policies).

**Do not** put the service role key in the browser.

---

## 5. Storage

### Bucket

- **Name:** `glb-assets` (or set `SUPABASE_GLBS_BUCKET` in env to match).
- **Purpose:** Store uploaded `.glb` files; paths look like `{uuid}/{sanitizedFileName}.glb`.
- **Public bucket:** Recommended for this prototype so `getPublicUrl()` URLs work for Three.js loaders without signed URLs. If the bucket is private, the app must be changed to use signed URLs instead of storing `public_url` as today.

### Upload characteristics

- Content type used on upload: `model/gltf-binary`
- Max file size: set in bucket settings if needed (large GLBs are expected).

### Policies (if using Storage RLS)

- For a **public** read bucket: allow **public read** on objects in `glb-assets`.
- **Writes** should be **service-role-only** (or no public insert); the Next.js server uploads with the service role key.

---

## 6. Optional quality-of-life

- **Trigger:** `updated_at` on `projects` and `placements` auto-update on row change (app already sends `updated_at` on some routes; trigger is optional).
- **Backup:** Enable point-in-time recovery if this becomes more than a throwaway project.

---

## 7. Verification checklist

Use this checklist after setup:

1. [ ] Tables `projects`, `assets`, `placements` exist with columns as above.
2. [ ] Foreign keys: `placements.project_id` → `projects`, `placements.asset_id` → `assets`.
3. [ ] Index on `placements(project_id)`.
4. [ ] Bucket `glb-assets` exists; public read OK if using public URLs in `assets.public_url`.
5. [ ] `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in `.env.local` on the server only.
6. [ ] Test: insert a row into `projects` via SQL or API; list via `GET /api/projects` from the app (with `x-editor-key` header).

---

## 8. One-line ask for Supabase Assistant

You can also paste only this:

> “Help me configure a Supabase project for a Next.js backend-only app: create tables `projects`, `assets`, `placements` as specified, a public storage bucket `glb-assets` for GLB files, safe RLS so only server-side service role writes while I prototype, and confirm my `service_role` key is never used in the browser.”

---

*This plan matches the `multiset-headless-sample` repository’s Supabase usage.*
