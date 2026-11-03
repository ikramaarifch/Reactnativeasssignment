import { launchCamera, launchImageLibrary } from 'react-native-image-picker';

export type PickResult =
  | { kind: 'picked'; uris: string[] }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

/**
 * Gallery uses the system photo picker: it needs no storage permission, and
 * the user only exposes the photos they choose. We pass no maxWidth/quality, so
 * the original is kept; our own pipeline does the compression later, off the UI.
 */
export async function pickFromGallery(selectionLimit: number): Promise<PickResult> {
  const response = await launchImageLibrary({ mediaType: 'photo', selectionLimit });
  return toResult(response);
}

export async function takePhoto(): Promise<PickResult> {
  const response = await launchCamera({ mediaType: 'photo', saveToPhotos: false });
  return toResult(response);
}

function toResult(response: Awaited<ReturnType<typeof launchCamera>>): PickResult {
  if (response.didCancel) {
    return { kind: 'cancelled' };
  }
  if (response.errorCode) {
    return {
      kind: 'error',
      message:
        response.errorCode === 'camera_unavailable'
          ? 'No camera is available on this device.'
          : response.errorCode === 'permission'
            ? 'Permission was denied.'
            : response.errorMessage ?? 'Could not get the photo.',
    };
  }
  const uris = (response.assets ?? []).flatMap(a => (a.uri ? [a.uri] : []));
  return uris.length > 0 ? { kind: 'picked', uris } : { kind: 'cancelled' };
}
