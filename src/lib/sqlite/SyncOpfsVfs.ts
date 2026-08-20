import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { OpenFile, Sqlite3Api, Sqlite3InstallableFn, Sqlite3VfsStruct, SyncAccessHandle } from './types';

export type FileMap = Map<string, SyncAccessHandle>;

// -----------------------------------------------------------------------------
// raw StructBinder bridge
// -----------------------------------------------------------------------------
// The shipped Sqlite3Static typings model the OO struct API (`xClose` etc. as
// JS functions) but omit the raw StructBinder surface this VFS drives: the
// `$field` pointer slots and struct-level `registerVfs()`. There is no safe
// alternative, so the single assertion lives here at the module boundary and
// everything past it is fully typed via `Sqlite3Api`.
const rawApi = (sqlite3: Sqlite3Static): Sqlite3Api => {
  const widened: { capi: object; wasm: object } = sqlite3;
  return widened as Sqlite3Api;
};

/**
 * Custom VFS for SYNC opfs without COOP/COEP headers
 * A lot of AI generated code here, useful since I really dont know
 * anything how sqlite works internally, and wanted to focus on acually usage with opfs sync
 * for write you will need to lock files exclusive, for multiple reads we can prob use shared synchandles
 *
 * Need someone who knows sqlite wasm/internals to confirm a lot of this..
 * I really cant help much here..
 */
export class SyncOpfsVfs {
  readonly name: string;
  private fileMap: FileMap;
  private openFiles = new Map<number, OpenFile>();
  private installedFunctions: number[] = [];
  // the C-side sqlite3_vfs struct, kept so we can unregister + free it. The
  // worker is long-lived and registers a fresh VFS per run; without this the
  // registrations pile up under one name and `sqlite3_vfs_find` keeps handing
  // back the FIRST (now stale, handles-closed) VFS → SQLITE_CANTOPEN.
  private vfsStruct: Sqlite3VfsStruct | null = null;

  constructor(fileMap: FileMap, name = 'opfs-sync-vfs') {
    this.name = name;
    this.fileMap = fileMap;
  }

  register(sqlite3: Sqlite3Static): void {
    const { capi, wasm } = rawApi(sqlite3);
    const S = capi;

    const inst = (fn: Sqlite3InstallableFn, sig: string): number => {
      const ptr = wasm.installFunction(sig, fn);
      this.installedFunctions.push(ptr);
      return ptr;
    };

    const readCStr = (ptr: number): string => (ptr ? wasm.cstrToJs(ptr) || '' : '');

    // const writeI64 = (pOut: number, value: number): void => {
    //     wasm.poke(pOut, value >>> 0, "i32");
    //     wasm.poke(pOut + 4, Math.floor(value / 0x100000000), "i32");
    // };

    // Char	    C type	        Notes
    // v	    void	        return only
    // i	    int32_t	        most common
    // j	    int64_t	        use for sqlite3_int64, offsets, sizes
    // f	    float	        rare in sqlite
    // d	    double	        e.g. xCurrentTime out param
    // p	    int32_t         (pointer)	non-null pointer
    // P	    int32_t         (pointer, nullable)	may be 0/null
    // s	    const char*	    string pointer, same width as p
    //https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html#function-signatures

    // -----------------------------------------------------------------------------
    // io_methods
    // -----------------------------------------------------------------------------
    const ioMethods = new capi.sqlite3_io_methods();
    ioMethods.$iVersion = 1;

    ioMethods.$xClose = inst((pFile: number): number => {
      this.openFiles.delete(pFile);
      return S.SQLITE_OK;
    }, 'i(p)');

    ioMethods.$xRead = inst((pFile: number, pDest: number, iAmt: number, iOff: bigint): number => {
      const file = this.openFiles.get(pFile);
      if (!file) {
        return S.SQLITE_IOERR_READ;
      }

      const offset = Number(iOff);
      const buf = new Uint8Array(iAmt);
      let fileSize = 0;

      if (file.handle) {
        fileSize = file.handle.getSize();
        if (offset < fileSize) {
          const n = file.handle.read(buf, { at: offset });
          if (n < iAmt) {
            buf.fill(0, n);
          }
        } else {
          buf.fill(0);
        }
      } else if (file.inMemory) {
        fileSize = file.inMemory.length;
        if (offset < fileSize) {
          buf.set(file.inMemory.subarray(offset, offset + iAmt));
          if (offset + iAmt > fileSize) {
            buf.fill(0, fileSize - offset);
          }
        } else {
          buf.fill(0);
        }
      }

      wasm.heap8u().set(buf, pDest);
      return offset + iAmt > fileSize ? S.SQLITE_IOERR_SHORT_READ : S.SQLITE_OK;
    }, 'i(ppij)');

    ioMethods.$xWrite = inst((pFile: number, pSrc: number, iAmt: number, iOff: bigint): number => {
      const file = this.openFiles.get(pFile);
      if (!file) {
        return S.SQLITE_IOERR_WRITE;
      }

      const offset = Number(iOff);
      const data = wasm.heap8u().slice(pSrc, pSrc + iAmt);

      if (file.handle) {
        file.handle.write(data, { at: offset });
      } else if (file.inMemory !== undefined) {
        const needed = offset + iAmt;
        if (needed > file.inMemory.length) {
          const grown = new Uint8Array(needed);
          grown.set(file.inMemory);
          file.inMemory = grown;
        }
        file.inMemory.set(data, offset);
      }
      return S.SQLITE_OK;
    }, 'i(ppij)');

    ioMethods.$xTruncate = inst((pFile: number, sz: bigint): number => {
      const file = this.openFiles.get(pFile);
      if (!file) {
        return S.SQLITE_IOERR_TRUNCATE;
      }
      const size = Number(sz);
      if (file.handle) {
        file.handle.truncate(size);
      } else if (file.inMemory) {
        file.inMemory = file.inMemory.subarray(0, size);
      }
      return S.SQLITE_OK;
    }, 'i(pj)');

    ioMethods.$xSync = inst((pFile: number, _flags: number): number => {
      const file = this.openFiles.get(pFile);
      if (file?.handle) {
        file.handle.flush();
      }
      return S.SQLITE_OK;
    }, 'i(pi)');

    ioMethods.$xFileSize = inst((pFile: number, pSize: number): number => {
      const file = this.openFiles.get(pFile);
      if (!file) {
        return S.SQLITE_IOERR_FSTAT;
      }
      const sz = file.handle ? file.handle.getSize() : (file.inMemory?.length ?? 0);
      // writeI64(pSize, sz);
      wasm.poke64(pSize, sz);
      return S.SQLITE_OK;
    }, 'i(pp)');

    ioMethods.$xLock = inst((_pFile: number, _eLock: number): number => S.SQLITE_OK, 'i(pi)');

    ioMethods.$xUnlock = inst((_pFile: number, _eLock: number): number => S.SQLITE_OK, 'i(pi)');

    ioMethods.$xCheckReservedLock = inst((_pFile: number, pResOut: number): number => {
      wasm.poke(pResOut, 0, 'i32');
      return S.SQLITE_OK;
    }, 'i(pp)');

    ioMethods.$xFileControl = inst((_pFile: number, _op: number, _pArg: number): number => S.SQLITE_NOTFOUND, 'i(pip)');

    ioMethods.$xSectorSize = inst((_pFile: number): number => 4096, 'i(p)');

    ioMethods.$xDeviceCharacteristics = inst((_pFile: number): number => S.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN, 'i(p)');

    // -----------------------------------------------------------------------------
    // sqlite3_vfs
    // -----------------------------------------------------------------------------
    const vfs = new capi.sqlite3_vfs();
    vfs.$iVersion = 1;
    vfs.$mxPathname = 512;
    vfs.$szOsFile = capi.sqlite3_file.structInfo.sizeof;
    vfs.$zName = wasm.allocCString(this.name);

    vfs.$xOpen = inst((_pVfs: number, zName: number, pFile: number, flags: number, pOutFlags: number): number => {
      const name = readCStr(zName);
      // keyed by the FULL path (the reference keyed by basename,
      // which silently opened an in-memory file for anything in a
      // subdirectory); basename is kept as a fallback for the
      // journal/temp names SQLite derives itself
      const basename = name.replace(/^.*[/\\]/, '');
      const key = this.fileMap.has(name) ? name : basename;

      const fd: OpenFile = { name: key };
      if (this.fileMap.has(key)) {
        fd.handle = this.fileMap.get(key);
      } else {
        //console.log(basename);
        // Journal/WAL/other SQLite temp files → in-memory fallback
        fd.inMemory = new Uint8Array(0);
      }
      this.openFiles.set(pFile, fd);

      // sqlite3_file starts with pMethods pointer — write it directly
      wasm.pokePtr(pFile, ioMethods.pointer);

      if (pOutFlags) {
        wasm.poke(pOutFlags, flags, 'i32');
      }
      return S.SQLITE_OK;
    }, 'i(pppip)');

    vfs.$xDelete = inst((_pVfs: number, _zName: number, _syncDir: number): number => S.SQLITE_OK, 'i(ppi)');

    vfs.$xAccess = inst((_pVfs: number, zName: number, _flags: number, pResOut: number): number => {
      const name = readCStr(zName);
      const basename = name.replace(/^.*[/\\]/, '');
      const known = this.fileMap.has(name) || this.fileMap.has(basename);
      wasm.poke(pResOut, known ? 1 : 0, 'i32');
      return S.SQLITE_OK;
    }, 'i(ppip)');

    vfs.$xFullPathname = inst((_pVfs: number, zName: number, nOut: number, zOut: number): number => {
      const name = readCStr(zName);
      const bytes = new TextEncoder().encode(`${name}\0`);
      if (bytes.length > nOut) {
        return S.SQLITE_CANTOPEN;
      }
      wasm.heap8u().set(bytes, zOut);
      return S.SQLITE_OK;
    }, 'i(ppip)');

    vfs.$xRandomness = inst((_pVfs: number, nByte: number, zOut: number): number => {
      crypto.getRandomValues(wasm.heap8u().subarray(zOut, zOut + nByte));
      return nByte;
    }, 'i(pip)');

    vfs.$xSleep = inst((_pVfs: number, _us: number): number => S.SQLITE_OK, 'i(pi)');

    vfs.$xCurrentTime = inst((_pVfs: number, pTime: number): number => {
      wasm.poke(pTime, Date.now() / 86400000.0 + 2440587.5, 'double');
      return S.SQLITE_OK;
    }, 'i(pp)');

    vfs.$xGetLastError = inst((_pVfs: number, _n: number, _z: number): number => 0, 'i(pip)');

    this.vfsStruct = vfs;
    vfs.registerVfs(false);
  }

  /** Full teardown for a per-run VFS: pull it out of SQLite's VFS list, free
   *  the C struct, then uninstall the JS callbacks. MUST run once the DB using
   *  it is closed — otherwise the next run's `sqlite3_vfs_find` resolves this
   *  stale registration (whose sync handles are already closed). */
  unregister(sqlite3: Sqlite3Static): void {
    if (this.vfsStruct) {
      rawApi(sqlite3).capi.sqlite3_vfs_unregister(this.vfsStruct.pointer);
      // frees the struct's C memory (incl. the allocCString name)
      this.vfsStruct.dispose?.();
      this.vfsStruct = null;
    }
    this.dispose(sqlite3);
  }

  dispose(sqlite3: Sqlite3Static): void {
    for (const ptr of this.installedFunctions) {
      rawApi(sqlite3).wasm.uninstallFunction(ptr);
    }
    this.installedFunctions = [];
  }
}
