"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BASE_CAMERA_CONSTRAINTS,
  captureHighResPhoto,
  describeTrack,
  getTrackZoomRange,
  optimizeTrackForCapture,
  setTorch,
  setZoom,
  stopStream,
  trackSupportsTorch,
  type MediaSettingsRange,
} from "@/lib/camera";
import { uploadWeddingPhoto } from "@/lib/upload";

const MAX_UPLOADS = 30;
const STORAGE_KEY = "wedding-photo-upload-count";

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

export default function WeddingCameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [uploadCount, setUploadCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [trackInfo, setTrackInfo] = useState<string>("");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomRange, setZoomRange] = useState<MediaSettingsRange | null>(null);
  const [zoom, setZoomValue] = useState(1);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const limitReached = uploadCount >= MAX_UPLOADS;
  const remaining = Math.max(0, MAX_UPLOADS - uploadCount);

  useEffect(() => {
    setUploadCount(getStoredCount());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    if (limitReached) {
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setCameraReady(false);
      setTorchSupported(false);
      setZoomRange(null);
      return;
    }

    let cancelled = false;

    async function startCamera() {
      try {
        setCameraError(null);
        const stream = await navigator.mediaDevices.getUserMedia(
          BASE_CAMERA_CONSTRAINTS
        );

        if (cancelled) {
          stopStream(stream);
          return;
        }

        const track = stream.getVideoTracks()[0];
        if (track) {
          await optimizeTrackForCapture(track);
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }

        setTrackInfo(describeTrack(track));
        setTorchSupported(trackSupportsTorch(track ?? null));
        setTorchOn(false);

        const range = getTrackZoomRange(track ?? null);
        setZoomRange(range);
        setZoomValue(range?.min ?? 1);

        console.log("[camera] Stream ready:", describeTrack(track));
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

  const handleTorchToggle = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await setTorch(track, next);
      setTorchOn(next);
    } catch (err) {
      console.warn("[camera] Torch toggle failed:", err);
    }
  }, [torchOn]);

  const handleZoomChange = useCallback(
    async (value: number) => {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || !zoomRange) return;
      setZoomValue(value);
      try {
        await setZoom(track, value);
      } catch (err) {
        console.warn("[camera] Zoom failed:", err);
      }
    },
    [zoomRange]
  );

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
      setStatusMessage("Capturing at max photo resolution…");

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
        <Link
          href="/gallery"
          className="rounded-lg bg-zinc-900 px-4 py-3 text-base font-medium text-white"
        >
          View gallery
        </Link>
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
        {torchSupported && (
          <button
            type="button"
            onClick={handleTorchToggle}
            disabled={!cameraReady}
            className="absolute right-3 top-3 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {torchOn ? "Torch on" : "Torch off"}
          </button>
        )}
      </div>

      {trackInfo && (
        <p className="text-xs text-zinc-400">Preview: {trackInfo}</p>
      )}

      {zoomRange?.max != null && (
        <label className="flex flex-col gap-1 text-sm text-zinc-600">
          <span>
            Zoom: {zoom.toFixed(1)}×
            {zoomRange.max ? ` (max ${zoomRange.max}×)` : ""}
          </span>
          <input
            type="range"
            min={zoomRange.min ?? 1}
            max={zoomRange.max}
            step={zoomRange.step ?? 0.1}
            value={zoom}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
            disabled={!cameraReady || isBusy}
          />
        </label>
      )}

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

      <Link
        href="/gallery"
        className="rounded-lg border border-zinc-300 px-4 py-3 text-center text-base font-medium text-zinc-900"
      >
        View gallery
      </Link>

      <p className="text-xs text-zinc-400">
        Photos are taken in-app only — device gallery uploads are disabled.
        Stills use the max ImageCapture resolution when the browser supports
        it.
      </p>
    </main>
  );
}
