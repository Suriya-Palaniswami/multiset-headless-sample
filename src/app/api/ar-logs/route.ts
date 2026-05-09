import { NextResponse } from "next/server";
import { getArLogsBucket, getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";

type ArLogInput = {
  projectId?: string | null;
  mapCode?: string | null;
  level?: "debug" | "info" | "warn" | "error";
  event?: string;
  message?: string | null;
  data?: unknown;
  url?: string | null;
  userAgent?: string | null;
};

const MAX_LOGS_PER_REQUEST = 25;
const MAX_TEXT = 2000;

function trimText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.slice(0, MAX_TEXT);
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null)).valueOf();
  } catch {
    return { serializationError: true };
  }
}

function toRow(input: ArLogInput, request: Request) {
  const event = trimText(input.event) ?? "unknown";
  return {
    project_id: input.projectId || null,
    map_code: trimText(input.mapCode),
    level: input.level ?? "info",
    event,
    message: trimText(input.message),
    data: safeJson(input.data),
    url: trimText(input.url) ?? trimText(request.headers.get("referer")),
    user_agent: trimText(input.userAgent) ?? trimText(request.headers.get("user-agent")),
  };
}

function slugPart(value: string | null | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  return raw.replace(/[^a-zA-Z0-9_.=-]+/g, "-").slice(0, 80);
}

function jsonl(rows: ReturnType<typeof toRow>[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

async function ensureLogBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const { data } = await supabase.storage.getBucket(bucket);
  if (data) return;
  await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: "1MiB",
    allowedMimeTypes: ["application/json", "application/x-ndjson", "text/plain"],
  });
}

async function writeRowsToStorage(rows: ReturnType<typeof toRow>[]) {
  if (rows.length === 0) return;
  const supabase = getSupabaseAdmin();
  const bucket = getArLogsBucket();
  await ensureLogBucket(supabase, bucket);
  const first = rows[0];
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const project = slugPart(first.project_id, "no-project");
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const event = slugPart(first.event, "event");
  const path = `${project}/${day}/${stamp}-${event}-${crypto.randomUUID()}.jsonl`;
  const { error } = await supabase.storage.from(bucket).upload(path, jsonl(rows), {
    contentType: "application/x-ndjson",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

async function parseLogBody(request: Request): Promise<ArLogInput | { logs?: ArLogInput[] }> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as ArLogInput | { logs?: ArLogInput[] };
  } catch {
    return {
      level: "error",
      event: "ar_log_parse_error",
      message: "Could not parse AR log request body as JSON",
      data: { bodyPreview: text.slice(0, 1000), contentType: request.headers.get("content-type") },
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseLogBody(request);
    const rawLogs = Array.isArray((body as { logs?: ArLogInput[] }).logs)
      ? (body as { logs: ArLogInput[] }).logs
      : [body as ArLogInput];
    const rows = rawLogs.slice(0, MAX_LOGS_PER_REQUEST).map((log) => toRow(log, request));
    const supabase = getSupabaseAdmin();
    let storagePath: string | undefined;
    let storageErrorMessage: string | undefined;
    let tableErrorMessage: string | undefined;

    try {
      storagePath = await writeRowsToStorage(rows);
    } catch (storageError) {
      console.error("Failed to write AR logs to storage", storageError);
      storageErrorMessage = storageError instanceof Error ? storageError.message : String(storageError);
    }

    try {
      const { error } = await supabase.from("ar_logs").insert(rows);
      if (error) throw error;
    } catch (tableError) {
      console.error("Failed to insert AR logs into table", tableError);
      tableErrorMessage = tableError instanceof Error ? tableError.message : String(tableError);
    }

    if (storageErrorMessage && tableErrorMessage) {
      return NextResponse.json(
        { ok: false, count: rows.length, storageError: storageErrorMessage, tableError: tableErrorMessage },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      count: rows.length,
      storagePath,
      tableWarning: tableErrorMessage,
      storageWarning: storageErrorMessage,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const format = url.searchParams.get("format");
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 100)));
    const supabase = getSupabaseAdmin();
    let query = supabase.from("ar_logs").select("*").order("created_at", { ascending: false }).limit(limit);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query;
    if (error) throw error;
    if (format === "jsonl" || format === "txt") {
      const text = (data ?? []).map((row) => JSON.stringify(row)).join("\n") + "\n";
      return new NextResponse(text, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Content-Disposition": `attachment; filename="ar-logs-${projectId ?? "latest"}.jsonl"`,
        },
      });
    }
    return NextResponse.json(data ?? []);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
