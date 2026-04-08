import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

type Params = { params: { projectId: string } };

export async function GET(_request: Request, context: Params) {
  try {
    const { projectId } = context.params;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).single();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request, context: Params) {
  try {
    const { projectId } = context.params;
    const body = (await request.json()) as { name?: string };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("projects")
      .update({ name: body.name.trim(), updated_at: new Date().toISOString() })
      .eq("id", projectId)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
