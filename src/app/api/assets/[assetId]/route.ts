import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

type Params = { params: { assetId: string } };

export async function GET(_request: Request, context: Params) {
  try {
    const { assetId } = context.params;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("assets").select("*").eq("id", assetId).single();
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
