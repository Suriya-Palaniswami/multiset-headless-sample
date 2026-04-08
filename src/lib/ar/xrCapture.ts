import * as THREE from "three";

/** Derive intrinsics from WebXR projection matrix (column-major). */
export function projectionToIntrinsics(
  projectionMatrix: Float32Array,
  viewport: { width: number; height: number; x: number; y: number }
) {
  const t = projectionMatrix;
  const fx = (viewport.width / 2) * t[0];
  const fy = (viewport.height / 2) * t[5];
  const px = (1 - t[8]) * (viewport.width / 2) + viewport.x;
  const py = (1 - t[9]) * (viewport.height / 2) + viewport.y;
  return { fx, fy, px, py, width: viewport.width, height: viewport.height };
}

async function imageDataToJpegBlob(
  rgba: ArrayBufferLike,
  width: number,
  height: number,
  quality = 0.7
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Blob();
  const data = new Uint8ClampedArray(rgba as ArrayBuffer);
  const img = new ImageData(data, width, height);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? new Blob()), "image/jpeg", quality);
  });
}

/** Read camera texture to flipped RGBA and encode as JPEG blob (matches Multiset SDK behavior). */
export async function readCameraTextureToBlob(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const fb = gl.createFramebuffer();
  if (!fb) return null;
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);

    const flipped = new Uint8ClampedArray(raw.length);
    for (let row = 0; row < height; row += 1) {
      const src = row * width * 4;
      const dst = (height - row - 1) * width * 4;
      flipped.set(raw.subarray(src, src + width * 4), dst);
    }
    const blob = await imageDataToJpegBlob(flipped.buffer, width, height, 0.7);
    if (!blob.size) return null;
    return { blob, width, height };
  } catch {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (fb) gl.deleteFramebuffer(fb);
    return null;
  }
}

export type CaptureResult = {
  blob: Blob;
  intrinsics: { fx: number; fy: number; px: number; py: number; width: number; height: number };
  /** View transform in the current XR reference space (column-major) */
  viewerMatrix: THREE.Matrix4;
};

const TRACK_TIMEOUT_MS = 10_000;
const MAX_POSE_ATTEMPTS = 300;
const MAX_IMAGE_ATTEMPTS = 10;

/**
 * Capture one camera frame + intrinsics from an active WebXR session (camera-access).
 */
export async function captureFrameForLocalization(
  renderer: THREE.WebGLRenderer,
  session: XRSession,
  refSpace: XRReferenceSpace
): Promise<CaptureResult | null> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const xrBinding = new XRWebGLBinding(session, gl);
  const getCameraImage = (xrBinding as XRWebGLBinding & { getCameraImage?: (cam: unknown) => WebGLTexture | null })
    .getCameraImage;

  return new Promise((resolve) => {
    const start = Date.now();
    let poseAttempts = 0;
    let imageAttempts = 0;

    const frame = () => {
      session.requestAnimationFrame((_time, xrFrame) => {
        if (Date.now() - start > TRACK_TIMEOUT_MS || poseAttempts >= MAX_POSE_ATTEMPTS) {
          resolve(null);
          return;
        }
        poseAttempts += 1;
        const pose = xrFrame.getViewerPose(refSpace);
        if (!pose) {
          frame();
          return;
        }
        const view = pose.views[0] as XRView & { camera?: { width: number; height: number } };
        if (!view?.camera) {
          frame();
          return;
        }
        const cam = view.camera;
        const w = cam.width;
        const h = cam.height;
        if (!w || !h) {
          frame();
          return;
        }
        const img = getCameraImage?.call(xrBinding, cam) ?? null;
        if (!img) {
          if (imageAttempts >= MAX_IMAGE_ATTEMPTS) {
            resolve(null);
            return;
          }
          imageAttempts += 1;
          frame();
          return;
        }
        void readCameraTextureToBlob(gl, img, w, h).then((read) => {
          const baseLayer = session.renderState.baseLayer;
          if (baseLayer?.framebuffer) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
          }
          if (!read) {
            resolve(null);
            return;
          }
          const intrinsics = projectionToIntrinsics(view.projectionMatrix, {
            width: w,
            height: h,
            x: 0,
            y: 0,
          });
          const viewerMatrix = new THREE.Matrix4().fromArray(view.transform.matrix);
          resolve({
            blob: read.blob,
            intrinsics,
            viewerMatrix,
          });
        });
      });
    };
    frame();
  });
}
