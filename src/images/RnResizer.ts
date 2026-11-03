import ImageResizer from '@bam.tech/react-native-image-resizer';
import { ResizerPort } from './ports';

export const rnResizer: ResizerPort = {
  async resize({ sourcePath, maxEdge, quality, outputDir }) {
    const result = await ImageResizer.createResizedImage(
      `file://${sourcePath}`,
      maxEdge,
      maxEdge,
      'JPEG',
      quality,
      0, // no extra rotation: the library applies EXIF orientation itself
      outputDir,
      false, // keepMeta=false: drops EXIF/GPS from what we upload
      { mode: 'contain', onlyScaleDown: true }, // long edge <= maxEdge, never upscale
    );
    return { path: result.path };
  },
};
