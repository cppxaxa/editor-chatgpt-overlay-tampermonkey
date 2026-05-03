// -----------------------------------------------------------------------------
// framework_system_restore.js — system-restore bootstrap. Reads
// localStorage["system_restore"] (populated by run_app.go from
// appsettings.json "properties" or set manually) and, if equal to the string
// "true", iterates the ServiceWindow app registry and re-launches every app
// whose persisted state has visible:true.
//
// Each ServiceWindow instance auto-persists geometry/mode/visibility on
// drag end, resize end, min/max/close, and show/hide — so the registry walk
// here is the only thing required at boot time to bring back the previous
// session's window layout.
// -----------------------------------------------------------------------------

function handle_system_restore() {
    try {
        if (localStorage.getItem("system_restore") !== "true") return;
    } catch (e) {
        return;
    }

    for (const { appName, launchFn } of ServiceWindow._apps) {
        try {
            const raw = localStorage.getItem("tm_window_" + appName);
            if (!raw) continue;
            const state = JSON.parse(raw);
            if (state && state.visible) {
                launchFn();
            }
        } catch (e) {
            // Malformed state — skip this app.
        }
    }
}
