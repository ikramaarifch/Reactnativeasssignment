import ReactNativeBlobUtil from 'react-native-blob-util';
import { CloudinaryHttp, HttpNetworkError } from './CloudinaryHttp';

const lowerCaseKeys = (headers: Record<string, unknown> | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    out[key.toLowerCase()] = String(value);
  }
  return out;
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : 'Network request failed');

/**
 * Real HTTP, on react-native-blob-util: native networking, so large files are
 * streamed from disk (never held in JS memory), upload progress comes from the
 * native layer, and callbacks keep arriving while the app is in the background.
 */
export const rnCloudinaryHttp: CloudinaryHttp = {
  async head(url, signal) {
    const task = ReactNativeBlobUtil.fetch('HEAD', url);
    const onAbort = () => {
      task.cancel();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const info = (await task).info();
      return { status: info.status, headers: lowerCaseKeys(info.headers) };
    } catch (e) {
      throw new HttpNetworkError(messageOf(e));
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  },

  async upload({ url, fields, file, onProgress, signal }) {
    const parts = [
      ...Object.entries(fields).map(([name, data]) => ({ name, data })),
      {
        name: 'file',
        filename: file.name,
        type: file.mimeType,
        data: ReactNativeBlobUtil.wrap(file.path),
      },
    ];
    const task = ReactNativeBlobUtil.fetch(
      'POST',
      url,
      { 'Content-Type': 'multipart/form-data' },
      parts,
    ).uploadProgress({ interval: 250 }, onProgress);
    const onAbort = () => {
      task.cancel();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await task;
      return { status: response.info().status, body: String(await response.text()) };
    } catch (e) {
      throw new HttpNetworkError(messageOf(e));
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  },
};
