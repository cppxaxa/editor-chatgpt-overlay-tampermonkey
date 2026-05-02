// -----------------------------------------------------------------------------
// framework_kiosk.js — kiosk-mode bootstrap. Reads localStorage["kiosk"]
// (populated by run_app.go from appsettings.json "properties") and, if set
// to the string "true", delegates to component_kiosk() which lives in
// component_kiosk.js.
// -----------------------------------------------------------------------------

function handle_kiosk() {
    try {
        if (localStorage.getItem("kiosk") === "true") {
            component_kiosk();
        }
    } catch (e) {
        // localStorage may be unavailable in restricted contexts; ignore.
    }
}
