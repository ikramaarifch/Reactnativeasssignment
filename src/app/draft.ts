import { MAX_IMAGES } from '../core/types';
import { FileSystemPort } from '../images/ports';

/** What the compose form holds before Save. */
export interface DraftState {
  id: string;
  description: string;
  photos: string[];
}

/** Opens the camera, which writes the photo to `path`. Real: rnCameraCapture. */
export interface CameraCapturePort {
  capture(path: string): Promise<'captured' | 'cancelled'>;
}

export type CaptureResult =
  | { kind: 'captured'; uri: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export interface DraftDeps {
  fs: FileSystemPort;
  camera: CameraCapturePort;
  /** JSON file holding the draft. */
  draftFile: string;
  /** Where the camera writes photos. Persistent storage, not cache. */
  capturesDir: string;
  now: () => number;
}

/** The file on disk: the draft plus the photo the camera was asked to write, if any. */
interface Persisted extends DraftState {
  pendingCapture: string | null;
}

const toPath = (uri: string): string =>
  uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;

const isString = (v: unknown): v is string => typeof v === 'string';

function parse(text: string | null): Persisted | null {
  if (text === null) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const o = raw as Record<string, unknown>;
    if (!isString(o.id) || !isString(o.description) || !Array.isArray(o.photos)) {
      return null;
    }
    return {
      id: o.id,
      description: o.description,
      photos: o.photos.filter(isString),
      pendingCapture: isString(o.pendingCapture) ? o.pendingCapture : null,
    };
  } catch {
    return null; // a half-written or foreign file is "no draft", never a crash
  }
}

/**
 * The form is kept on disk so that Android killing the app (it does, on phones
 * with little memory, while the camera is in front) loses nothing the user typed
 * or took.
 *
 * The camera is told WHERE to write before it opens, and that path is saved with
 * the draft. If the app dies meanwhile, the photo is still written there and
 * load() finds it on the next start.
 *
 * This is only a draft. Nothing here is "saved": the report exists once
 * saveReport has put it in the queue.
 */
export class DraftService {
  /** The path the camera was last asked to write, until the UI has taken the photo. */
  private pending: string | null = null;

  constructor(private readonly deps: DraftDeps) {}

  /** The draft from the last run, with a photo that arrived while the app was dead added back. */
  async load(): Promise<DraftState | null> {
    const { fs } = this.deps;
    const saved = parse(await fs.readText(this.deps.draftFile));
    if (!saved) {
      return null;
    }
    const photos: string[] = [];
    for (const uri of saved.photos) {
      if (uri.startsWith('file://') ? await fs.exists(toPath(uri)) : true) {
        photos.push(uri);
      }
    }
    if (saved.pendingCapture) {
      const uri = `file://${saved.pendingCapture}`;
      if (
        (await this.hasContent(saved.pendingCapture)) &&
        !photos.includes(uri) &&
        photos.length < MAX_IMAGES
      ) {
        photos.push(uri);
      }
    }
    this.pending = null;
    const state: DraftState = { id: saved.id, description: saved.description, photos };
    await this.save(state);
    return this.isEmpty(state) ? null : state;
  }

  async save(state: DraftState): Promise<void> {
    const { fs, draftFile } = this.deps;
    if (this.isEmpty(state) && this.pending === null) {
      await fs.remove(draftFile);
      return;
    }
    const persisted: Persisted = { ...state, pendingCapture: this.pending };
    await fs.writeText(draftFile, JSON.stringify(persisted));
  }

  /** Persists the draft and the target path FIRST, then opens the camera. */
  async capture(state: DraftState): Promise<CaptureResult> {
    const { camera, capturesDir } = this.deps;
    const path = `${capturesDir}/${state.id}-${this.deps.now()}.jpg`;
    this.pending = path;
    try {
      await this.save(state);
      const outcome = await camera.capture(path);
      if (outcome === 'captured' && (await this.hasContent(path))) {
        this.pending = null; // the caller now holds the photo; its next save() records that
        return { kind: 'captured', uri: `file://${path}` };
      }
      await this.discard(path, state);
      return { kind: 'cancelled' };
    } catch (e) {
      await this.discard(path, state).catch(() => {});
      return { kind: 'error', message: messageFor(e) };
    }
  }

  /** After a successful Save, or a reset: nothing of the draft may remain. */
  async clear(): Promise<void> {
    this.pending = null;
    await this.deps.fs.remove(this.deps.draftFile);
    await this.deps.fs.remove(this.deps.capturesDir);
  }

  private async discard(path: string, state: DraftState): Promise<void> {
    this.pending = null;
    await this.deps.fs.remove(path);
    await this.save(state);
  }

  private async hasContent(path: string): Promise<boolean> {
    const { fs } = this.deps;
    return (await fs.exists(path)) && (await fs.sizeOf(path)) > 0;
  }

  private isEmpty(state: DraftState): boolean {
    return state.description.trim() === '' && state.photos.length === 0;
  }
}

function messageFor(e: unknown): string {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  return code === 'E_CAMERA_UNAVAILABLE'
    ? 'No camera is available on this device.'
    : 'Could not open the camera. Try again.';
}
