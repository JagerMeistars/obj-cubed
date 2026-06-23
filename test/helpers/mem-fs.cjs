// In-memory fs stub for driving I/O functions (saveSingleOutput) under vitest
// without touching the disk. Records every writeFileSync(path, content) into a
// Map so tests can assert the exact write keys + contents. mkdirSync is a no-op
// (records created dirs), existsSync/readFileSync are backed by the same store
// so merge/back-up code paths can be exercised.
//
// Usage:
//   const { makeMemFs } = require('./mem-fs.cjs');
//   const memfs = makeMemFs();
//   loadObjcubedWithContext({ requireImpl: id => id === 'fs' ? memfs : require(id) });
//   ...drive saveSingleOutput...
//   memfs.writes.get('/rp/assets/.../cat.png')  // -> recorded content

function makeMemFs(seed) {
  // writes: path -> content (Buffer or string), the source of truth.
  const writes = new Map();
  const dirs = new Set();
  if (seed) for (const [k, v] of Object.entries(seed)) writes.set(k, v);

  return {
    writes,
    dirs,
    writeFileSync(p, content /*, opts */) {
      writes.set(p, content);
    },
    renameSync(from, to) {
      // Mirror fs.renameSync for the atomic .tmp->target write path.
      if (!writes.has(from)) {
        const err = new Error('ENOENT: no such file, rename ' + from);
        err.code = 'ENOENT';
        throw err;
      }
      writes.set(to, writes.get(from));
      writes.delete(from);
    },
    mkdirSync(p /*, opts */) {
      dirs.add(p);
    },
    existsSync(p) {
      return writes.has(p) || dirs.has(p);
    },
    readFileSync(p /*, enc */) {
      if (!writes.has(p)) {
        const err = new Error('ENOENT: no such file, open ' + p);
        err.code = 'ENOENT';
        throw err;
      }
      return writes.get(p);
    },
  };
}

module.exports = { makeMemFs };
