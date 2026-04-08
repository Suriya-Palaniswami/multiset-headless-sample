"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  onFileReady: (file: File) => void;
};

/**
 * Camera preview + optional WebM recording. Multiset map processing expects zip/e57 from supported tools;
 * recordings are offered as files you can try to upload only if your account accepts that workflow.
 */
export function ScanCapture({ onFileReady }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [status, setStatus] = useState<string>("");
  const [recording, setRecording] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setStatus("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("Camera active — record a clip or pick a scan file below.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not access camera");
    }
  }, []);

  const startRecord = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) {
      setStatus("Start the camera first.");
      return;
    }
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";
    if (!mime) {
      setStatus("WebM recording not supported in this browser.");
      return;
    }
    const mr = new MediaRecorder(stream, { mimeType: mime });
    recorderRef.current = mr;
    mr.ondataavailable = (ev) => {
      if (ev.data.size) chunksRef.current.push(ev.data);
    };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
      const file = new File([blob], `camera-scan-${Date.now()}.webm`, { type: blob.type });
      onFileReady(file);
      setStatus("Recording attached — choose provider/file type to match, or export a zip/e57 from your scan tool.");
      setRecording(false);
    };
    mr.start(200);
    setRecording(true);
    setStatus("Recording… stop when done.");
  }, [onFileReady]);

  const stopRecord = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="mb-2 text-sm font-medium text-zinc-300">Camera capture</h3>
      <p className="mb-3 text-xs text-zinc-500">
        VPS map upload normally expects a <strong className="text-zinc-400">zip</strong> or <strong className="text-zinc-400">e57</strong> from a
        supported pipeline (Unity, Matterport, NavVis, etc.). Recording produces WebM for experimentation — processing may reject it unless your
        Multiset project allows it.
      </p>
      <div className="aspect-video w-full max-w-md overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void startCamera()}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"
        >
          Start camera
        </button>
        {!recording ? (
          <button type="button" onClick={startRecord} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm hover:bg-violet-500">
            Record clip
          </button>
        ) : (
          <button type="button" onClick={stopRecord} className="rounded-lg bg-red-900/80 px-3 py-1.5 text-sm hover:bg-red-800">
            Stop
          </button>
        )}
        <button type="button" onClick={stopStream} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400">
          Stop camera
        </button>
      </div>
      {status ? <p className="mt-2 text-xs text-zinc-400">{status}</p> : null}
    </div>
  );
}
