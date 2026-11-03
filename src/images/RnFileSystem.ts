import ReactNativeBlobUtil from 'react-native-blob-util';
import { FileSystemPort } from './ports';

const { fs } = ReactNativeBlobUtil;

export const rnFileSystem: FileSystemPort = {
  exists: path => fs.exists(path),
  sizeOf: async path => Number((await fs.stat(path)).size),
  md5Hex: async path => (await fs.hash(path, 'md5')).toLowerCase(),
  ensureDir: async path => {
    if (!(await fs.exists(path))) {
      await fs.mkdir(path);
    }
  },
  move: async (from, to) => {
    if (await fs.exists(to)) {
      await fs.unlink(to);
    }
    await fs.mv(from, to);
  },
  remove: async path => {
    if (await fs.exists(path)) {
      await fs.unlink(path);
    }
  },
};
