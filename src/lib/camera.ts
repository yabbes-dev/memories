/**
 * Camera helpers that push the browser MediaStream / ImageCapture APIs
 * as far as the device allows. Native camera apps can still go further
 * (multi-lens, computational photography, RAW) — those are not exposed to the web.
 */

export type PhotoSettingsLike = {
  imageWidth?: number;
  imageHeight?: number;
  fillLightMode?: string;
  redEyeReduction?: boolean;
};

export type MediaSettingsRange = {
  min?: number;
  max?: number;
  step?: number;
};

export type PhotoCapabilitiesLike = {
  imageWidth?: MediaSettingsRange;
  imageHeight?: MediaSettingsRange;
  fillLightMode?: string[];
  redEyeReduction?: string | boolean;
};

export interface ImageCaptureLike {
  takePhoto: (photoSettings?: PhotoSettingsLike) => Promise<Blob>;
  getPhotoCapabilities?: () => Promise<PhotoCapabilitiesLike>;
  getPhotoSettings?: () => Promise<PhotoSettingsLike>;
}

declare global {
  interface Window {
    ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike;
  }
}

/** Extended capabilities many Chromium browsers expose on camera tracks. */
export type CameraTrackCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  torch?: boolean;
  zoom?: MediaSettingsRange;
};

export type CameraTrackSettings = MediaTrackSettings & {
  focusMode?: string;
  exposureMode?: string;
  whiteBalanceMode?: string;
  torch?: boolean;
  zoom?: number;
};

export const BASE_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 3840 },
    height: { ideal: 2160 },
    // Image Capture extension constraints (best-effort)
    focusMode: { ideal: "continuous" },
    exposureMode: { ideal: "continuous" },
  } as MediaTrackConstraints,
  audio: false,
};

export function createImageCapture(
  track: MediaStreamTrack
): ImageCaptureLike | null {
  if (typeof window === "undefined" || !window.ImageCapture) return null;
  return new window.ImageCapture(track);
}

/**
 * After the stream starts, re-apply the highest supported video resolution
 * and continuous AF / AE when the device reports them.
 */
export async function optimizeTrackForCapture(
  track: MediaStreamTrack
): Promise<void> {
  const caps = track.getCapabilities?.() as CameraTrackCapabilities | undefined;
  if (!caps) {
    console.log("[camera] getCapabilities() unavailable");
    return;
  }

  console.log("[camera] Track capabilities:", caps);

  const next: Record<string, unknown> = {};

  if (caps.width?.max) {
    next.width = { ideal: caps.width.max };
  }
  if (caps.height?.max) {
    next.height = { ideal: caps.height.max };
  }
  if (caps.frameRate?.max) {
    // Cap preview FPS slightly for stability; photo path uses ImageCapture
    next.frameRate = { ideal: Math.min(caps.frameRate.max, 30) };
  }
  if (caps.focusMode?.includes("continuous")) {
    next.focusMode = "continuous";
  }
  if (caps.exposureMode?.includes("continuous")) {
    next.exposureMode = "continuous";
  }
  if (caps.whiteBalanceMode?.includes("continuous")) {
    next.whiteBalanceMode = "continuous";
  }

  if (Object.keys(next).length === 0) return;

  try {
    await track.applyConstraints(next as MediaTrackConstraints);
    console.log(
      "[camera] Applied optimized constraints:",
      next,
      "→ settings:",
      track.getSettings()
    );
  } catch (err) {
    console.warn("[camera] applyConstraints failed (non-fatal):", err);
  }
}

export function trackSupportsTorch(track: MediaStreamTrack | null): boolean {
  if (!track?.getCapabilities) return false;
  const caps = track.getCapabilities() as CameraTrackCapabilities;
  return caps.torch === true;
}

export async function setTorch(
  track: MediaStreamTrack,
  enabled: boolean
): Promise<void> {
  if (!trackSupportsTorch(track)) {
    throw new Error("Torch is not supported on this camera");
  }
  await track.applyConstraints({
    advanced: [{ torch: enabled } as MediaTrackConstraintSet],
  });
  console.log("[camera] Torch:", enabled);
}

export function getTrackZoomRange(
  track: MediaStreamTrack | null
): MediaSettingsRange | null {
  if (!track?.getCapabilities) return null;
  const caps = track.getCapabilities() as CameraTrackCapabilities;
  if (!caps.zoom?.max || caps.zoom.max <= (caps.zoom.min ?? 1)) return null;
  return caps.zoom;
}

export async function setZoom(
  track: MediaStreamTrack,
  zoom: number
): Promise<void> {
  const range = getTrackZoomRange(track);
  if (!range?.max) throw new Error("Zoom is not supported on this camera");
  const min = range.min ?? 1;
  const clamped = Math.min(range.max, Math.max(min, zoom));
  await track.applyConstraints({
    advanced: [{ zoom: clamped } as MediaTrackConstraintSet],
  });
  console.log("[camera] Zoom:", clamped);
}

/**
 * Build PhotoSettings that request the maximum still-image size the
 * hardware advertises (often higher than the live video track).
 */
export async function buildMaxPhotoSettings(
  imageCapture: ImageCaptureLike
): Promise<PhotoSettingsLike> {
  const settings: PhotoSettingsLike = {};

  if (!imageCapture.getPhotoCapabilities) {
    return settings;
  }

  try {
    const caps = await imageCapture.getPhotoCapabilities();
    console.log("[capture] Photo capabilities:", caps);

    if (caps.imageWidth?.max) {
      settings.imageWidth = caps.imageWidth.max;
    }
    if (caps.imageHeight?.max) {
      settings.imageHeight = caps.imageHeight.max;
    }

    // Prefer auto flash when available; never force flash in guest venues
    if (caps.fillLightMode?.includes("auto")) {
      settings.fillLightMode = "auto";
    } else if (caps.fillLightMode?.includes("off")) {
      settings.fillLightMode = "off";
    }

    if (
      caps.redEyeReduction === "controllable" ||
      caps.redEyeReduction === true
    ) {
      settings.redEyeReduction = true;
    }
  } catch (err) {
    console.warn("[capture] getPhotoCapabilities failed:", err);
  }

  return settings;
}

export async function captureHighResPhoto(
  video: HTMLVideoElement,
  stream: MediaStream
): Promise<Blob> {
  const [track] = stream.getVideoTracks();

  if (track) {
    const imageCapture = createImageCapture(track);
    if (imageCapture) {
      try {
        const photoSettings = await buildMaxPhotoSettings(imageCapture);
        console.log("[capture] takePhoto settings:", photoSettings);

        const blob =
          Object.keys(photoSettings).length > 0
            ? await imageCapture.takePhoto(photoSettings)
            : await imageCapture.takePhoto();

        // Log actual still dimensions when possible
        try {
          const bitmap = await createImageBitmap(blob);
          console.log(
            "[capture] ImageCapture hardware still:",
            bitmap.width,
            "x",
            bitmap.height,
            "bytes:",
            blob.size
          );
          bitmap.close();
        } catch {
          console.log(
            "[capture] ImageCapture.takePhoto() succeeded",
            blob.size,
            blob.type
          );
        }

        return blob;
      } catch (err) {
        console.warn(
          "[capture] ImageCapture.takePhoto() failed, falling back to canvas:",
          err
        );
      }
    } else {
      console.log(
        "[capture] ImageCapture API unavailable — using canvas fallback"
      );
    }
  }

  return captureFromCanvas(video);
}

export function captureFromCanvas(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) {
    return Promise.reject(new Error("Video frame has no dimensions yet"));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(new Error("Could not get canvas 2d context"));
  }

  ctx.drawImage(video, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("canvas.toBlob() returned null"));
          return;
        }
        console.log(
          "[capture] Canvas fallback",
          width,
          "x",
          height,
          "size:",
          blob.size
        );
        resolve(blob);
      },
      "image/jpeg",
      0.95
    );
  });
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    track.stop();
    console.log("[camera] Stopped track:", track.kind, track.label);
  });
}

export function describeTrack(track: MediaStreamTrack | undefined): string {
  if (!track) return "no track";
  const s = track.getSettings() as CameraTrackSettings;
  const parts = [
    s.width && s.height ? `${s.width}×${s.height}` : null,
    s.facingMode ? `facing:${s.facingMode}` : null,
    s.frameRate ? `${Math.round(s.frameRate)}fps` : null,
    s.focusMode ? `focus:${s.focusMode}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || track.label || "camera";
}
