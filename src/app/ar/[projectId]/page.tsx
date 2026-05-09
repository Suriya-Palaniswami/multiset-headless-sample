"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  MAX_QUERY_IMAGE_DIMENSION,
  captureVideoFrameForQuery,
  startRearCamera,
  stopMediaStream,
} from "@/lib/ar/webcamCapture";
import type { LocalizeResponse, ProjectRow } from "@/lib/types";

function cameraVerticalFov(): number {
  const raw = process.env.NEXT_PUBLIC_CAMERA_VERTICAL_FOV?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 10 && n < 170) return n;
  return 60;
}

/**
 * Matches Multiset VPS Web samples / SDK default for form query (`isRightHanded: true`).
 * If you consume poses in Three.js RHS, see MAP_QUERY_REST_ARCHITECTURE.md for conversions.
 */
function queryIsRightHanded(): boolean {
  return process.env.NEXT_PUBLIC_VPS_IS_RIGHT_HANDED !== "false";
}

export default function ArPage() {
  const params = useParams();
  const projectId = String(params.projectId ?? "");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState<string>("Loading project…");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [mapCode, setMapCode] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LocalizeResponse | null>(null);

  const streamRef = useRef<MediaStream | null>(null);

  const pushDebug = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString();
    setDebugLines((prev) => [`[${stamp}] ${line}`, ...prev].slice(0, 24));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const pr = await apiFetch(`/api/projects/${projectId}`);
        if (!pr.ok) throw new Error(await pr.text());
        const proj = (await pr.json()) as ProjectRow;
        if (cancelled) return;
        setMapCode(proj.map_code);
        setStatus(proj.map_code ? "Allow camera, then tap Localize." : "Project has no map code.");
      } catch (e) {
        if (!cancelled) {
          setStatus(e instanceof Error ? e.message : "Failed to load project");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    return () => {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  async function ensureCamera(): Promise<boolean> {
    const video = videoRef.current;
    if (!video) return false;
    if (streamRef.current) return true;
    try {
      const stream = await startRearCamera(video);
      streamRef.current = stream;
      pushDebug("Camera started (environment-facing if available).");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Camera permission failed";
      setStatus(msg);
      pushDebug(msg);
      return false;
    }
  }

  async function localize() {
    if (!mapCode || busy) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      setStatus("Page not ready.");
      return;
    }
    setBusy(true);
    setConfidence(null);
    setLastResult(null);
    try {
      const ok = await ensureCamera();
      if (!ok) return;

      const fov = cameraVerticalFov();
      const frame = await captureVideoFrameForQuery(video, canvas, fov, MAX_QUERY_IMAGE_DIMENSION);
      if (!frame) {
        setStatus("Could not read a video frame (wait for preview, then retry).");
        pushDebug(`Frame capture failed (video ${video.videoWidth}x${video.videoHeight}).`);
        return;
      }

      pushDebug(
        `Query image ${frame.width}x${frame.height} JPEG ~${Math.round(frame.blob.size / 1024)}KB, ` +
          `intrinsics fx=${frame.intrinsics.fx.toFixed(1)} fy=${frame.intrinsics.fy.toFixed(1)} ` +
          `cx=${frame.intrinsics.px.toFixed(1)} cy=${frame.intrinsics.py.toFixed(1)} (vFOV≈${fov}° est.)`
      );

      const fd = new FormData();
      fd.append("mapCode", mapCode);
      fd.append("fx", String(frame.intrinsics.fx));
      fd.append("fy", String(frame.intrinsics.fy));
      fd.append("px", String(frame.intrinsics.px));
      fd.append("py", String(frame.intrinsics.py));
      fd.append("width", String(frame.width));
      fd.append("height", String(frame.height));
      fd.append("isRightHanded", String(queryIsRightHanded()));
      fd.append("queryImage", frame.blob, "query.jpg");

      const res = await apiFetch("/api/localize", { method: "POST", body: fd });
      const text = await res.text();
      if (!res.ok) {
        setStatus(`Localize failed (${res.status})`);
        pushDebug(text.slice(0, 400));
        return;
      }
      let parsed: LocalizeResponse;
      try {
        parsed = JSON.parse(text) as LocalizeResponse;
      } catch {
        setStatus("Invalid JSON from server");
        return;
      }
      setLastResult(parsed);
      const c = parsed.confidence ?? null;
      setConfidence(c);
      if (parsed.poseFound) {
        setStatus(`Localized — conf ${(c ?? 0).toFixed(3)}`);
        pushDebug(`poseFound mapCodes=${JSON.stringify(parsed.mapCodes)}`);
      } else {
        setStatus("No pose for this frame — try aim, lighting, or another angle.");
        pushDebug("poseFound=false");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-zinc-950">
      <div className="relative z-30 border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-2 backdrop-blur-sm">
        <div className="pointer-events-auto flex flex-wrap items-center gap-3">
          <Link href={`/editor/${projectId}`} className="text-sm text-violet-400 hover:underline">
            ← Editor
          </Link>
          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
          >
            {showDebug ? "Hide log" : "Show log"}
          </button>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">REST map query</span>
        </div>
        {showDebug ? (
          <div className="pointer-events-auto mt-2 w-full max-w-2xl rounded-lg border border-zinc-700/80 bg-black/70 p-3 text-xs text-zinc-200">
            <p className="mb-2 font-medium text-zinc-100">Log</p>
            <div className="max-h-40 space-y-1 overflow-auto font-mono text-[11px] leading-4">
              {debugLines.length === 0 ? <p className="text-zinc-400">No events yet.</p> : null}
              {debugLines.map((line, idx) => (
                <p key={`${idx}-${line}`} className="text-zinc-300">
                  {line}
                </p>
              ))}
            </div>
            {lastResult ? (
              <pre className="mt-2 max-h-48 overflow-auto rounded border border-zinc-600/50 bg-zinc-900/80 p-2 text-[10px] text-zinc-300">
                {JSON.stringify(lastResult, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="relative mx-auto flex max-w-lg flex-col gap-3 p-3">
        <p className="text-sm text-zinc-400">
          Live camera → single JPEG frame → server <code className="text-zinc-300">/api/localize</code> → Multiset{" "}
          <code className="text-zinc-300">query-form</code>. See{" "}
          <code className="text-zinc-300">MAP_QUERY_REST_ARCHITECTURE.md</code>.
        </p>
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-zinc-700 bg-black">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
            autoPlay
            controls={false}
          />
          <canvas ref={canvasRef} className="hidden" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-300">{status}</span>
          {confidence !== null ? (
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
              conf {confidence.toFixed(3)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void ensureCamera()}
            disabled={busy}
            className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            Start camera
          </button>
          <button
            type="button"
            onClick={() => void localize()}
            disabled={busy || !mapCode}
            className="rounded-lg bg-violet-600 px-6 py-2 text-sm font-medium text-white shadow hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? "Querying…" : "Localize (capture frame)"}
          </button>
        </div>
      </div>
    </div>
  );
}
