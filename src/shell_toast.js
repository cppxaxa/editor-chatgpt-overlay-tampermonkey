// -----------------------------------------------------------------------------
// shell_toast.js — window.shell.shelltoast facade for service_toast.
//
// Exposes a small, AI-friendly subset of service_toast.js on window.shell so
// scripts (and LLM-generated snippets pasted into the console) can fire
// notifications without having to know the internal function names.
//
// Public surface (window.shell.shelltoast.*):
//   showToastSimple(message)          — fire a default 3s toast.
//   showToast(message, opts)          — full options: { duration, title, icon }.
//                                       Returns { dismiss } so callers can
//                                       early-dismiss.
//   clearHistory()                    — wipe the notifications history pane.
//
// Intentionally OMITTED (kept off the AI surface to avoid side-quests):
//   - location getters/setters: the user picks the on-screen anchor from the
//     notifications pane; programmatic override would just confuse callers.
//   - history pane open/close toggles: that's a UI concern, not a scripting
//     concern.
//
// Wired up in framework_shell.js (shelltoast: shell_toast_build()).
// -----------------------------------------------------------------------------

function shell_toast_build() {
    return {
        showToastSimple(message) {
            return service_toast_show(String(message == null ? "" : message));
        },
        showToast(message, opts) {
            return service_toast_show(
                String(message == null ? "" : message),
                opts || {}
            );
        },
        clearHistory() {
            service_toast_clear_history();
        }
    };
}
