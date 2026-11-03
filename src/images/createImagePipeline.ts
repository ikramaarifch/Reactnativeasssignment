import ReactNativeBlobUtil from 'react-native-blob-util';
import { DEFAULT_PIPELINE, ImagePipeline } from './ImagePipeline';
import { rnFileSystem } from './RnFileSystem';
import { rnResizer } from './RnResizer';

/** Prepared files live in the app's document directory: the OS may purge caches, never this. */
export const PREPARED_DIR = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/prepared`;

export const createImagePipeline = (): ImagePipeline =>
  new ImagePipeline(rnFileSystem, rnResizer, { ...DEFAULT_PIPELINE, workDir: PREPARED_DIR });
