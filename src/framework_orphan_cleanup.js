// -----------------------------------------------------------------------------
// framework_orphan_cleanup.js — sweep stale per-app localStorage entries.
//
// Why one-shot at end of init, not per-mutation:
//   - Safe: every component_*_handle_init() has already registered with
//     ServiceWindow._apps, so we know the full set of live appNames. Deleting
//     a key for an unknown app means the owning component truly no longer
//     exists in this build (renamed, removed, or feature-flagged out).
//   - Cheap: runs once per page load, scans only a handful of keys.
//   - No surprises during normal use: nothing is deleted while the user is
//     interacting with windows, tabs, or the tray overflow popup.
//
// What we sweep:
//   - "tm_window_<appName>" geometry blobs whose appName is not in
//     ServiceWindow._apps.
//   - "tm_tray_hidden_apps" entries whose appName is not in the tray-app
//     registry. Tray apps register through framework_taskbar_register_tray_app,
//     which keeps an internal _tray_apps list — we expose
//     framework_taskbar_list_tray_apps() so this file doesn't need to reach
//     into private state.
//
// What we DO NOT sweep:
//   - Cache keys (tm_ascii_cache, tm_question_cache, …): they don't follow
//     the <prefix>_<appName> pattern and are owned by component_window's tab
//     system; cleaning them would couple this file to component internals.
//   - Anything not matching a known prefix. Unknown keys are left alone so
//     third-party data on the page isn't touched.
// -----------------------------------------------------------------------------

const FRAMEWORK_ORPHAN_PREFIX_WINDOW = "tm_window_";

function framework_orphan_cleanup() {

    /* ---- Window geometry blobs ---- */

    const liveAppNames = new Set();
    if (typeof ServiceWindow !== "undefined" && Array.isArray(ServiceWindow._apps)) {
        for (const a of ServiceWindow._apps) liveAppNames.add(a.appName);
    }

    /* Snapshot keys first — mutating localStorage while iterating its length
       index causes us to skip entries. */
    const allKeys = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            allKeys.push(localStorage.key(i));
        }
    } catch (e) { return; }

    let removedWindow = 0;
    for (const k of allKeys) {
        if (!k || !k.startsWith(FRAMEWORK_ORPHAN_PREFIX_WINDOW)) continue;
        const appName = k.slice(FRAMEWORK_ORPHAN_PREFIX_WINDOW.length);
        if (liveAppNames.has(appName)) continue;
        try { localStorage.removeItem(k); removedWindow++; } catch (e) {}
    }

    /* ---- Tray-hidden list ---- */

    let removedTray = 0;
    try {
        const liveTrayNames = new Set(
            framework_taskbar_list_tray_apps().map(a => a.appName)
        );
        const raw = localStorage.getItem("tm_tray_hidden_apps");
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                const filtered = arr.filter(n => liveTrayNames.has(n));
                if (filtered.length !== arr.length) {
                    removedTray = arr.length - filtered.length;
                    localStorage.setItem(
                        "tm_tray_hidden_apps",
                        JSON.stringify(filtered)
                    );
                }
            }
        }
    } catch (e) { /* best-effort */ }

    if (removedWindow || removedTray) {
        console.log(
            "[orphan-cleanup] removed " + removedWindow + " window state(s), " +
            removedTray + " tray-hidden entry(ies)"
        );
    }
}
