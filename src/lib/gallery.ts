import { getSupabase, WEDDING_PHOTOS_BUCKET } from "./supabase";

export type WeddingPhoto = {
  name: string;
  url: string;
  createdAt: string | null;
};

/**
 * Lists all images in the wedding-photos bucket (newest first).
 */
export async function listWeddingPhotos(): Promise<WeddingPhoto[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase.storage
    .from(WEDDING_PHOTOS_BUCKET)
    .list("", {
      limit: 1000,
      sortBy: { column: "created_at", order: "desc" },
    });

  if (error) {
    console.error("[gallery] Failed to list photos:", error.message);
    throw new Error(`Failed to load gallery: ${error.message}`);
  }

  const files = (data ?? []).filter((item) => {
    if (!item.name || item.id === null) return false;
    return /\.(jpe?g|png|webp|gif)$/i.test(item.name);
  });

  return files.map((file) => {
    const { data: publicUrlData } = supabase.storage
      .from(WEDDING_PHOTOS_BUCKET)
      .getPublicUrl(file.name);

    return {
      name: file.name,
      url: publicUrlData.publicUrl,
      createdAt: file.created_at ?? null,
    };
  });
}
