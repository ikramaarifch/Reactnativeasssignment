/** File operations the pipeline needs. Real: RnFileSystem. Tests: an in-memory fake. */
export interface FileSystemPort {
  exists(path: string): Promise<boolean>;
  /** Size in bytes as measured on disk (never trust a library's own report). */
  sizeOf(path: string): Promise<number>;
  /** Lower-case hex MD5 of the file contents. */
  md5Hex(path: string): Promise<string>;
  ensureDir(path: string): Promise<void>;
  /** Moves, replacing the destination if it exists. */
  move(from: string, to: string): Promise<void>;
  /** Copies a file, replacing the destination if it exists. */
  copy(from: string, to: string): Promise<void>;
  /** Deletes a file or a directory tree; a missing path is not an error. */
  remove(path: string): Promise<void>;
}

export interface ResizeRequest {
  sourcePath: string;
  /** Longest edge in pixels; never upscales. */
  maxEdge: number;
  /** JPEG quality 1-100. */
  quality: number;
  /** Directory the native resizer writes its output into. */
  outputDir: string;
}

/** Native resize + re-encode. Must apply EXIF orientation. */
export interface ResizerPort {
  /** Returns the path of the written JPEG. */
  resize(request: ResizeRequest): Promise<{ path: string }>;
}
