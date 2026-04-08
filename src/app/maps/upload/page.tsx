"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api";
import { uploadFilePartsToS3 } from "@/lib/mapUploadParts";
import { ScanCapture } from "@/components/ScanCapture";

type SourcePreset = { label: string; provider: string; fileType: string; coordinateSystem: "RHS" | "LHS" };

const PRESETS: SourcePreset[] = [
  { label: "Unity / generic (zip)", provider: "unity", fileType: "zip", coordinateSystem: "RHS" },
  { label: "Matterport (e57)", provider: "matterport", fileType: "e57", coordinateSystem: "RHS" },
  { label: "NavVis (e57)", provider: "navvis", fileType: "e57", coordinateSystem: "RHS" },
  { label: "Leica (zip)", provider: "leica", fileType: "zip", coordinateSystem: "RHS" },
];

export default function MapUploadPage() {
  const [mapName, setMapName] = useState("");
  const [preset, setPreset] = useState(0);
  const [lat, setLat] = useState<number | "">("");
  const [lng, setLng] = useState<number | "">("");
  const [alt, setAlt] = useState(0);
  const [heading, setHeading] = useState<number | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMapCode, setDoneMapCode] = useState<string | null>(null);

  const fillGeo = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation not available");
      return;
    }
    setPhase("Getting location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setAlt(typeof pos.coords.altitude === "number" && !Number.isNaN(pos.coords.altitude) ? pos.coords.altitude : 0);
        setPhase("");
        setError(null);
      },
      (err) => {
        setPhase("");
        setError(err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  const runUpload = useCallback(async () => {
    setError(null);
    setDoneMapCode(null);
    if (!mapName.trim()) {
      setError("Enter a map name.");
      return;
    }
    if (!file) {
      setError("Choose or record a file first.");
      return;
    }
    if (lat === "" || lng === "") {
      setError("Set latitude and longitude (use “Use my location” or enter manually).");
      return;
    }

    const src = PRESETS[preset] ?? PRESETS[0];
    setUploading(true);
    setPhase("Starting upload with Multiset…");
    setProgress("");

    const startRes = await apiFetch("/api/maps/upload/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapName: mapName.trim(),
        fileSize: file.size,
        coordinates: { latitude: Number(lat), longitude: Number(lng), altitude: Number(alt) },
        ...(heading !== "" ? { heading: Number(heading) } : {}),
        source: {
          provider: src.provider,
          fileType: src.fileType,
          coordinateSystem: src.coordinateSystem,
        },
      }),
    });

    if (!startRes.ok) {
      const t = await startRes.text();
      setPhase("");
      setUploading(false);
      setError(t);
      return;
    }

    const created = (await startRes.json()) as {
      mapId: string;
      mapCode: string;
      uploadId: string;
      key: string;
      signedUrls: Array<{ partNumber: number; signedUrl: string }>;
    };

    setPhase("Uploading parts to storage…");
    try {
      const parts = await uploadFilePartsToS3(file, created.signedUrls, (done, total) => {
        setProgress(`Part ${done} / ${total}`);
      });

      setPhase("Completing upload…");
      const completeRes = await apiFetch("/api/maps/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapId: created.mapId,
          uploadId: created.uploadId,
          key: created.key,
          parts,
        }),
      });

      if (!completeRes.ok) {
        const t = await completeRes.text();
        setPhase("");
        setError(t);
        return;
      }

      setPhase("");
      setProgress("");
      setDoneMapCode(created.mapCode);
    } catch (e) {
      setPhase("");
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [mapName, file, lat, lng, alt, heading, preset]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/maps" className="text-sm text-violet-400 hover:underline">
        ← Maps
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Upload map scan</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Creates a map via Multiset multipart upload (same flow as third-party scan pipelines). Use a supported scan export when possible.
      </p>

      <div className="mt-8 space-y-6">
        <label className="block">
          <span className="text-sm text-zinc-400">Map name</span>
          <input
            value={mapName}
            onChange={(e) => setMapName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"
            placeholder="Office floor 2"
          />
        </label>

        <label className="block">
          <span className="text-sm text-zinc-400">Scan source (Multiset)</span>
          <select
            value={preset}
            onChange={(e) => setPreset(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"
          >
            {PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-zinc-300">Location</span>
            <button type="button" onClick={fillGeo} className="text-sm text-violet-400 hover:underline">
              Use my location
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-zinc-500">
              Latitude
              <input
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value === "" ? "" : parseFloat(e.target.value))}
                className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-zinc-500">
              Longitude
              <input
                type="number"
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value === "" ? "" : parseFloat(e.target.value))}
                className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-zinc-500">
              Altitude (m)
              <input
                type="number"
                step="any"
                value={alt}
                onChange={(e) => setAlt(parseFloat(e.target.value) || 0)}
                className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              />
            </label>
          </div>
          <label className="mt-2 block text-xs text-zinc-500">
            Heading (°) optional
            <input
              type="number"
              step="any"
              value={heading}
              onChange={(e) => setHeading(e.target.value === "" ? "" : parseFloat(e.target.value))}
              className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
            />
          </label>
        </div>

        <div>
          <span className="text-sm text-zinc-400">Scan file</span>
          <label className="mt-1 flex cursor-pointer flex-col gap-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-950/50 px-4 py-6 text-center text-sm text-zinc-400 hover:border-zinc-600">
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setFile(f ?? null);
              }}
            />
            {file ? (
              <span className="text-zinc-200">
                {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
              </span>
            ) : (
              <span>Click to choose .zip / .e57 (or other export)</span>
            )}
          </label>
        </div>

        <ScanCapture
          onFileReady={(f) => {
            setFile(f);
            setError(null);
          }}
        />

        {error ? (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-200">{error}</div>
        ) : null}
        {phase ? <p className="text-sm text-amber-200/90">{phase}</p> : null}
        {progress ? <p className="text-xs text-zinc-500">{progress}</p> : null}

        {doneMapCode ? (
          <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 p-4 text-sm text-emerald-100">
            <p className="font-medium">Upload completed.</p>
            <p className="mt-1 font-mono text-xs">{doneMapCode}</p>
            <p className="mt-2 text-xs text-emerald-200/80">Processing runs on Multiset — refresh the maps list in a few minutes.</p>
            <Link href={`/maps/${encodeURIComponent(doneMapCode)}`} className="mt-3 inline-block text-violet-300 hover:underline">
              Open map details →
            </Link>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void runUpload()}
          disabled={uploading}
          className="w-full rounded-lg bg-violet-600 py-3 text-sm font-medium hover:bg-violet-500 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Start upload"}
        </button>
      </div>
    </div>
  );
}
