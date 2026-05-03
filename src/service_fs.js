// -----------------------------------------------------------------------------
// service_fs.js — IndexedDB-backed file store seeded by run_app.go.
//
// Layout: one IndexedDB database "tm_fs", one object store "files",
// keyed by the file's relative path under src-fs/ (forward slashes).
// Each value is { mime, dataUrl } where dataUrl is a fully-formed
// "data:<mime>;base64,<...>" string suitable for direct use in
// background-image, <img src>, <iframe srcdoc>, etc.
//
// run_app.go walks src-fs/ at boot time and calls window.__tm_seed_fs([...])
// once with every file. If the seed call lands BEFORE source.js has parsed
// (race), it stashes the payload in window.__tm_pending_fs and we drain it
// when this file initialises.
// -----------------------------------------------------------------------------

const FS_DB_NAME    = "tm_fs";
const FS_STORE_NAME = "files";

function _fs_open() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(FS_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(FS_STORE_NAME)) {
                db.createObjectStore(FS_STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

function service_fs_put(path, mime, dataUrl) {
    return _fs_open().then(db => new Promise((res, rej) => {
        const tx = db.transaction(FS_STORE_NAME, "readwrite");
        tx.objectStore(FS_STORE_NAME).put({ mime, dataUrl }, path);
        tx.oncomplete = () => res();
        tx.onerror    = () => rej(tx.error);
    }));
}

/* Returns { mime, dataUrl } or null. dataUrl is directly usable in
   background-image / <img src> / <iframe srcdoc>. */
function service_fs_get(path) {
    return _fs_open().then(db => new Promise((res, rej) => {
        const tx = db.transaction(FS_STORE_NAME, "readonly");
        const r  = tx.objectStore(FS_STORE_NAME).get(path);
        r.onsuccess = () => res(r.result || null);
        r.onerror   = () => rej(r.error);
    }));
}

function service_fs_list() {
    return _fs_open().then(db => new Promise((res, rej) => {
        const tx = db.transaction(FS_STORE_NAME, "readonly");
        const r  = tx.objectStore(FS_STORE_NAME).getAllKeys();
        r.onsuccess = () => res(r.result || []);
        r.onerror   = () => rej(r.error);
    }));
}

/* Called by run_app.go (via Runtime.evaluate) after source.js is loaded.
   `entries` is [{ path, mime, b64 }, ...]. */
window.__tm_seed_fs = function (entries) {
    if (!Array.isArray(entries)) return Promise.resolve();
    const promises = entries.map(e =>
        service_fs_put(e.path, e.mime, "data:" + e.mime + ";base64," + e.b64)
    );
    return Promise.all(promises);
};

/* Drain any pre-seed payload that arrived before source.js parsed. */
if (Array.isArray(window.__tm_pending_fs)) {
    window.__tm_seed_fs(window.__tm_pending_fs);
    window.__tm_pending_fs = null;
}
