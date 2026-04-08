import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getGlbBucket, getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("assets").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file field required" }, { status: 400 });
    }
    const name = (formData.get("name") as string | null) || file.name;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".glb")) {
      return NextResponse.json({ error: "Only .glb files are allowed" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const bucket = getGlbBucket();
    const id = randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${id}/${safeName}`;

    const buf = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, buf, {
      contentType: "model/gltf-binary",
      upsert: false,
    });
    if (upErr) throw upErr;

    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(storagePath);

    const { data: row, error: insErr } = await supabase
      .from("assets")
      .insert({
        name: name.trim(),
        filename: file.name,
        storage_path: storagePath,
        public_url: publicUrl,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    return NextResponse.json({
      id: row.id,
      public_url: row.public_url,
      filename: row.filename,
      name: row.name,
      storage_path: row.storage_path,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
