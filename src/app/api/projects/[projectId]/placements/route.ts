import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

type Params = { params: { projectId: string } };

export async function GET(_request: Request, context: Params) {
  try {
    const { projectId } = context.params;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("placements")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request, context: Params) {
  try {
    const { projectId } = context.params;
    const body = (await request.json()) as {
      asset_id?: string;
      name?: string;
      pos_x?: number;
      pos_y?: number;
      pos_z?: number;
      rot_x?: number;
      rot_y?: number;
      rot_z?: number;
      rot_w?: number;
      scale_x?: number;
      scale_y?: number;
      scale_z?: number;
    };
    if (!body.asset_id || !body.name?.trim()) {
      return NextResponse.json({ error: "asset_id and name required" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const row = {
      project_id: projectId,
      asset_id: body.asset_id,
      name: body.name.trim(),
      pos_x: body.pos_x ?? 0,
      pos_y: body.pos_y ?? 0,
      pos_z: body.pos_z ?? 0,
      rot_x: body.rot_x ?? 0,
      rot_y: body.rot_y ?? 0,
      rot_z: body.rot_z ?? 0,
      rot_w: body.rot_w ?? 1,
      scale_x: body.scale_x ?? 1,
      scale_y: body.scale_y ?? 1,
      scale_z: body.scale_z ?? 1,
    };
    const { data, error } = await supabase.from("placements").insert(row).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
