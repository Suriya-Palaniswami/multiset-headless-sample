# multiset-headless-sample

A **Next.js 14** sample that integrates [Multiset](https://multiset.ai) VPS (maps, localization, mesh download) with **server-side M2M credentials**, plus **Supabase** for projects, GLB assets, and placements.

Multiset secrets never ship to the browser. The app proxies map list/detail, upload, and `query-form` localization through Next.js API routes.

## Features

- Server-proxied Multiset M2M token, maps, mesh URLs, and map upload (multipart)
- Webcam + WebXR capture utilities for REST map query (`POST /api/localize`)
- Browser editor and AR viewer with Supabase-backed placements
- Optional interactive API flow diagram at [`/api-flow`](http://localhost:3000/api-flow)

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Multiset](https://multiset.ai) account with M2M `clientId` / `clientSecret`
- [Supabase](https://supabase.com) project (for projects, assets, placements, AR logs)

## Quick start

```bash
npm install
cp .env.example .env.local
# Edit .env.local — see Environment variables below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Health check (no auth): `GET /api/health`.

Run `supabase/schema.sql` in your Supabase SQL editor and create a public storage bucket named `glb-assets` (or the name in `SUPABASE_GLBS_BUCKET`).

## Environment variables

Copy `.env.example` to `.env.local` for local development. **Do not commit `.env.local` or any file containing real secrets.**

| Variable | Scope | Purpose |
|----------|-------|---------|
| `MULTISET_CLIENT_ID` | Server | Multiset M2M auth |
| `MULTISET_CLIENT_SECRET` | Server | Multiset M2M auth — **never** expose to the browser |
| `EDITOR_SHARED_KEY` | Server | Protects `/api/*` (except health) |
| `NEXT_PUBLIC_EDITOR_SHARED_KEY` | Browser | Sent as `x-editor-key` on API calls |
| `NEXT_PUBLIC_EDITOR_PASSWORD` | Browser | Prototype login gate |
| `NEXT_PUBLIC_API_BASE_URL` | Browser | Optional; empty = same origin |
| `SUPABASE_URL` | Server | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Service role key — server only |
| `SUPABASE_GLBS_BUCKET` | Server | GLB storage bucket (default `glb-assets`) |
| `SUPABASE_AR_LOGS_BUCKET` | Server | AR log files (default `ar-logs`) |

Optional AR / localization tuning: `NEXT_PUBLIC_CAMERA_VERTICAL_FOV`, `NEXT_PUBLIC_VPS_IS_RIGHT_HANDED`, `NEXT_PUBLIC_AR_LOCALIZE_POSE_MODE`, `NEXT_PUBLIC_AR_PIXEL_RATIO`, `NEXT_PUBLIC_AR_FRAMEBUFFER_SCALE`, `NEXT_PUBLIC_AR_DOM_OVERLAY`.

On **Netlify**, set the same keys in Site configuration → Environment variables. Scope must include **Functions** (not Builds-only). See `netlify.toml`.

## Documentation

| Doc | Description |
|-----|-------------|
| [AGENT_ORCHESTRATION.md](./AGENT_ORCHESTRATION.md) | Architecture, API routes, security boundaries |
| [MAP_QUERY_REST_ARCHITECTURE.md](./MAP_QUERY_REST_ARCHITECTURE.md) | REST map query, intrinsics, coordinates |
| [multiset_web_ar_editor_spec.md](./multiset_web_ar_editor_spec.md) | Full editor/AR spec |
| [UnityPlan.md](./UnityPlan.md) | Unity integration notes |
| [FIXES_REFERENCE.md](./FIXES_REFERENCE.md) | Debugging notes from prior fixes |

Official Multiset API: [Map query (REST)](https://docs.multiset.ai/basics/rest-api-docs/map-query)

## Scripts

```bash
npm run dev          # dev server on 0.0.0.0:3000
npm run dev:localhost
npm run build
npm run start
npm run lint
```

## Security

- Never commit `.env`, `.env.local`, or real credentials.
- `MULTISET_CLIENT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` must stay on the server.
- `NEXT_PUBLIC_*` values are embedded in the client bundle at build time.
- The prototype login (`NEXT_PUBLIC_EDITOR_PASSWORD`) is client-side only; use `EDITOR_SHARED_KEY` for API protection.

## License

[MIT](./LICENSE)
