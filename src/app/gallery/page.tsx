"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listWeddingPhotos, type WeddingPhoto } from "@/lib/gallery";

export default function GalleryPage() {
  const [photos, setPhotos] = useState<WeddingPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPhotos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const items = await listWeddingPhotos();
      setPhotos(items);
      console.log("[gallery] Loaded", items.length, "photos");
    } catch (err) {
      console.error("[gallery] Load failed:", err);
      setError(err instanceof Error ? err.message : "Failed to load gallery");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Wedding Gallery</h1>
          <p className="text-sm text-zinc-500">
            {loading
              ? "Loading…"
              : `${photos.length} photo${photos.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadPhotos}
            disabled={loading}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            Refresh
          </button>
          <Link
            href="/"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
          >
            Back to camera
          </Link>
        </div>
      </header>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
          <span className="mt-1 block text-xs text-red-600">
            Make sure the bucket is public (or has a select policy) and the
            &quot;Allow public reads&quot; policy is set.
          </span>
        </p>
      )}

      {!loading && !error && photos.length === 0 && (
        <p className="py-12 text-center text-sm text-zinc-500">
          No photos yet — capture one from the camera page.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {photos.map((photo) => (
          <a
            key={photo.name}
            href={photo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="aspect-square overflow-hidden rounded-lg bg-zinc-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </a>
        ))}
      </div>
    </main>
  );
}
