-- Run in Supabase SQL editor. Create storage bucket "glb-assets" in dashboard.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  map_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  filename text not null,
  storage_path text not null,
  public_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists placements (
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

create index if not exists placements_project_id_idx on placements(project_id);
