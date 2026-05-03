// -----------------------------------------------------------------------------
// framework.js — framework-level shared state and lifecycle bootstrap.
//
// Component-owned state has been moved into the owning component_*.js files.
// LLM cancellation state lives inside service_llm.js (see cancelCurrentLlmJob).
// -----------------------------------------------------------------------------

/* ---- Bootstrap ---- */

function framework_register_launcher() {

    framework_launcher_register("E", component_window_launch);
    framework_launcher_register("C", component_calc_launch);
    framework_launcher_register("L", component_localstorage_launch);

    framework_on_launcher_registered();
}

/* ---- Lifecycle hooks ----
   Each hook is a literal list of components that react to a framework-level
   moment. Components must NOT reach into framework state directly; instead
   they expose a component_<name>_handle_*() function and the hook calls it.
   To add a reactor, append one line to the relevant hook below. */

function framework_on_launcher_registered() {
    component_window_handle_launcher_registered();
}

function framework_on_window_resized() {
    component_window_handle_window_resized();
}

function framework_on_init() {
    framework_scrollbars_inject();

    component_waitingui_handle_init();
    component_linecommand_handle_init();
    component_window_handle_init();
    component_calc_handle_init();
    component_localstorage_handle_init();
}

function framework_init() {
    framework_register_launcher();

    window.addEventListener("resize", framework_on_window_resized);

    framework_on_init();

    handle_kiosk();
    handle_system_restore();
}
