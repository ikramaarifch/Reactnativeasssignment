/**
 * Cloudinary account used for report photos. Both values are PUBLIC identifiers
 * (they appear in every image URL). The API key and API secret are deliberately
 * not in this app: an unsigned upload preset is what lets the client upload
 * without a secret. Never put the secret in app code.
 */
export const CLOUDINARY = {
  cloudName: 'vzcbf0xj',
  uploadPreset: 'rnassignment',
} as const;
