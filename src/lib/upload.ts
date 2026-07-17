import { getSupabase, WEDDING_PHOTOS_BUCKET } from "./supabase";

/**
 * Uploads a captured photo blob to the Supabase `wedding-photos` bucket.
 * Returns the storage path on success.
 */
export async function uploadWeddingPhoto(blob: Blob): Promise<string> {
  const filename = `wedding-photo-${Date.now()}-${Math.random()
    .toString(36)
    .substring(7)}.jpg`;

  console.log("[upload] Starting upload:", filename, "size:", blob.size);

  const supabase = getSupabase();

  const { data, error } = await supabase.storage
    .from(WEDDING_PHOTOS_BUCKET)
    .upload(filename, blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (error) {
    console.error("[upload] Failed:", error.message);
    throw new Error(`Upload failed: ${error.message}`);
  }

  console.log("[upload] Success:", data.path);
  return data.path;
}
