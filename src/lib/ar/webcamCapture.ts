/**
 * Capture stills from a live <video> for Multiset map query (REST).
 * @see https://docs.multiset.ai/basics/rest-api-docs/map-query
 */

export const MAX_QUERY_IMAGE_DIMENSION = 1280;

/** JPEG quality for query frames (balance size vs. feature detail). */
export const QUERY_JPEG_QUALITY = 0.82;

/**
 * Pinhole intrinsics in **pixel units** for the **encoded** query image (after downscale).
 * Assumes square pixels: fx = fy * (width/height) from a vertical FOV model.
 *
 * This is an **estimate** unless you calibrate the device. Document the chosen FOV in your script.
 */
export function estimateIntrinsicsFromVerticalFov(
  width: number,
  height: number,
  verticalFovDegrees: number
): { fx: number; fy: number; px: number; py: number } {
  const v = (verticalFovDegrees * Math.PI) / 180;
  const fy = height / (2 * Math.tan(v / 2));
  const fx = fy * (width / height);
  const px = width / 2;
  const py = height / 2;
  return { fx, fy, px, py };
}

function drawVideoToCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxDim: number
): { width: number; height: number } {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return { width: 0, height: 0 };
  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { width: 0, height: 0 };
  ctx.drawImage(video, 0, 0, w, h);
  return { width: w, height: h };
}

export type WebcamFrameResult = {
  blob: Blob;
  width: number;
  height: number;
  intrinsics: { fx: number; fy: number; px: number; py: number };
};

/**
 * Grab one frame from the video element, downscale so max(width,height) ≤ maxDim, encode JPEG.
 */
export async function captureVideoFrameForQuery(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  verticalFovDegrees: number,
  maxDim = MAX_QUERY_IMAGE_DIMENSION,
  quality = QUERY_JPEG_QUALITY
): Promise<WebcamFrameResult | null> {
  const { width, height } = drawVideoToCanvas(video, canvas, maxDim);
  if (!width || !height) return null;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  if (!blob?.size) return null;

  const intrinsics = estimateIntrinsicsFromVerticalFov(width, height, verticalFovDegrees);
  return { blob, width, height, intrinsics };
}

export async function startRearCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopMediaStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
}
