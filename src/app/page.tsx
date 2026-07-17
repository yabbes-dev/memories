"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadWeddingPhoto } from "@/lib/upload";

const MAX_UPLOADS = 30;
const STORAGE_KEY = "wedding-photo-upload-count";

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: "environment",
    width: { ideal: 3840 },
    height: { ideal: 2160 },
  },
  audio: false,
};

type CaptureStatus = "idle" | "capturing" | "uploading" | "success" | "error";

function getStoredCount(): number {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function setStoredCount(count: number): void {
  localStorage.setItem(STORAGE_KEY, String(count));
}

/** ImageCapture is not in all TS DOM libs; narrow via runtime check. */
interface ImageCaptureLike {
  takePhoto: () => Promise<Blob>;
}

declare global {
  interface Window {
    ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike;
  }
}

async function captureHighResPhoto(
  video: HTMLVideoElement,
  stream: MediaStream
): Promise<Blob> {
  const [track] = stream.getVideoTracks();

  if (typeof window !== "undefined" && window.ImageCapture && track) {
    try {
      const imageCapture = new window.ImageCapture(track);
      const blob = await imageCapture.takePhoto();
      console.log(
        "[capture] ImageCapture.takePhoto() succeeded — hardware high-res blob",
        blob.size,
        blob.type
      );
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

  return captureFromCanvas(video);
}

function captureFromCanvas(video: HTMLVideoElement): Promise<Blob> {
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
          "[capture] Canvas fallback succeeded",
          width,
          "x",
          height,
          "size:",
          blob.size
        );
        resolve(blob);
      },
      "image/jpeg",
      0.92
    );
  });
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    track.stop();
    console.log("[camera] Stopped track:", track.kind, track.label);
  });
}

export default function WeddingCameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [uploadCount, setUploadCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const limitReached = uploadCount >= MAX_UPLOADS;
  const remaining = Math.max(0, MAX_UPLOADS - uploadCount);

  // Hydrate upload count from localStorage
  useEffect(() => {
    setUploadCount(getStoredCount());
    setHydrated(true);
  }, []);

  // Start / stop camera based on limit
  useEffect(() => {
    if (!hydrated) return;

    if (limitReached) {
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setCameraReady(false);
      return;
    }

    let cancelled = false;

    async function startCamera() {
      try {
        setCameraError(null);
        const stream = await navigator.mediaDevices.getUserMedia(
          CAMERA_CONSTRAINTS
        );

        if (cancelled) {
          stopStream(stream);
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }

        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings();
        console.log("[camera] Stream started", {
          label: track?.label,
          width: settings?.width,
          height: settings?.height,
          facingMode: settings?.facingMode,
        });

        setCameraReady(true);
      } catch (err) {
        console.error("[camera] getUserMedia failed:", err);
        const message =
          err instanceof Error ? err.message : "Camera access denied";
        setCameraError(message);
        setCameraReady(false);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [hydrated, limitReached]);

  const handleCapture = useCallback(async () => {
    if (limitReached || status === "capturing" || status === "uploading") {
      return;
    }

    const video = videoRef.current;
    const stream = streamRef.current;

    if (!video || !stream || !cameraReady) {
      setStatus("error");
      setStatusMessage("Camera is not ready yet.");
      return;
    }

    try {
      setStatus("capturing");
      setStatusMessage("Capturing…");

      const blob = await captureHighResPhoto(video, stream);

      setStatus("uploading");
      setStatusMessage("Uploading…");

      await uploadWeddingPhoto(blob);

      const nextCount = getStoredCount() + 1;
      setStoredCount(nextCount);
      setUploadCount(nextCount);

      setStatus("success");
      setStatusMessage(
        nextCount >= MAX_UPLOADS
          ? "Uploaded! That was your last shot."
          : "Photo uploaded successfully!"
      );

      // Clear success message after a short delay
      window.setTimeout(() => {
        setStatus("idle");
        setStatusMessage(null);
      }, 2000);
    } catch (err) {
      console.error("[capture] Pipeline failed:", err);
      setStatus("error");
      setStatusMessage(
        err instanceof Error ? err.message : "Capture or upload failed"
      );
    }
  }, [cameraReady, limitReached, status]);

  if (!hydrated) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-zinc-500">Loading…</p>
      </main>
    );
  }

  if (limitReached) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Limit Reached! Go hit the dance floor!
        </h1>
        <p className="text-sm text-zinc-500">
          You&apos;ve used all {MAX_UPLOADS} shots on this device.
        </p>
      </main>
    );
  }

  const isBusy = status === "capturing" || status === "uploading";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Wedding Memories</h1>
        <p className="text-sm tabular-nums text-zinc-600">
          Remaining Shots: {remaining}/{MAX_UPLOADS}
        </p>
      </header>

      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        {!cameraReady && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
            Starting camera…
          </div>
        )}
      </div>

      {cameraError && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Camera error: {cameraError}. Allow camera access and reload.
        </p>
      )}

      {statusMessage && (
        <p
          className={`rounded px-3 py-2 text-sm ${
            status === "error"
              ? "border border-red-300 bg-red-50 text-red-800"
              : status === "success"
                ? "border border-green-300 bg-green-50 text-green-800"
                : "border border-zinc-200 bg-zinc-50 text-zinc-700"
          }`}
        >
          {statusMessage}
        </p>
      )}

      <button
        type="button"
        onClick={handleCapture}
        disabled={!cameraReady || isBusy}
        className="rounded-lg bg-zinc-900 px-4 py-3 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "capturing"
          ? "Capturing…"
          : status === "uploading"
            ? "Uploading…"
            : "Capture"}
      </button>

      <p className="text-xs text-zinc-400">
        Photos are taken in-app only — gallery uploads are disabled.
      </p>
    </main>
  );
}
