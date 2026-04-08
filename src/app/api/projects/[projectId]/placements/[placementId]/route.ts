import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

type Params = { params: { projectId: string; placementId: string } };

export async function PUT(request: Request, context: Params) {
  try {
    const { projectId, placementId } = context.params;
    const body = (await request.json()) as { name?: string } & Partial<{
      pos_x: number;
      pos_y: number;
      pos_z: number;
      rot_x: number;
      rot_y: number;
      rot_z: number;
      rot_w: number;
      scale_x: number;
      scale_y: number;
      scale_z: number;
    }>;

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.name !== undefined) update.name = body.name;
    const keys = [
      "pos_x",
      "pos_y",
      "pos_z",
      "rot_x",
      "rot_y",
      "rot_z",
      "rot_w",
      "scale_x",
      "scale_y",
      "scale_z",
    ] as const;
    for (const k of keys) {
      if (body[k] !== undefined) update[k] = body[k];
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("placements")
      .update(update)
      .eq("id", placementId)
      .eq("project_id", projectId)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Params) {
  try {
    const { projectId, placementId } = context.params;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("placements")
      .delete()
      .eq("id", placementId)
      .eq("project_id", projectId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
