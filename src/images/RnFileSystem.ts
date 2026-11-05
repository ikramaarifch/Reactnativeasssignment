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
  list: async dir => ((await fs.exists(dir)) ? fs.ls(dir) : []),
  copy: async (from, to) => {
    if (await fs.exists(to)) {
      await fs.unlink(to);
    }
    await fs.cp(from, to);
  },
  readText: async path => ((await fs.exists(path)) ? fs.readFile(path, 'utf8') : null),
  writeText: async (path, text) => {
    await fs.writeFile(path, text, 'utf8');
  },
  remove: async path => {
    if (await fs.exists(path)) {
      await fs.unlink(path);
    }
  },
};
