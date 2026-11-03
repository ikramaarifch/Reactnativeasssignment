/**
 * Our logical image key is `reports/{reportId}/{index}.jpg` (also what Firestore
 * stores). Cloudinary's public_id has no extension, and the delivery URL adds it.
 */
export const publicIdFor = (path: string): string => path.replace(/\.[A-Za-z0-9]+$/, '');

export const uploadEndpoint = (cloudName: string): string =>
  `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

/** Public delivery URL of the ORIGINAL file (what we compare size and MD5 against). */
export const originalUrl = (cloudName: string, path: string): string =>
  `https://res.cloudinary.com/${cloudName}/image/upload/${path}`;

/**
 * A server-resized copy for list views: long edge capped, automatic quality.
 * On 2G this is tens of KB instead of up to 4.5 MB per photo.
 */
export const thumbnailUrl = (cloudName: string, path: string, maxEdge = 480): string =>
  `https://res.cloudinary.com/${cloudName}/image/upload/c_limit,w_${maxEdge},h_${maxEdge},q_auto/${path}`;
