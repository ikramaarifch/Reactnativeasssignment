import { MAX_IMAGES } from '../core/types';

export interface AddPhotosResult {
  photos: string[];
  /** Picked photos that did not fit (over the limit) or were already added. */
  dropped: number;
}

/** Adds picked photos up to the limit, skipping duplicates. Never exceeds MAX_IMAGES. */
export function addPhotos(
  current: readonly string[],
  picked: readonly string[],
  max: number = MAX_IMAGES,
): AddPhotosResult {
  const photos = [...current];
  let dropped = 0;
  for (const uri of picked) {
    if (photos.includes(uri) || photos.length >= max) {
      dropped++;
    } else {
      photos.push(uri);
    }
  }
  return { photos, dropped };
}

export const removePhoto = (current: readonly string[], uri: string): string[] =>
  current.filter(u => u !== uri);
