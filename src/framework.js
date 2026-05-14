// -----------------------------------------------------------------------------
// framework.js — framework-level shared state and lifecycle bootstrap.
//
// Component-owned state has been moved into the owning component_*.js files.
// LLM cancellation state lives inside service_llm.js (see cancelCurrentLlmJob).
// -----------------------------------------------------------------------------

/* ---- Bootstrap ---- */

function framework_register_launcher() {

    framework_launcher_register("Code Editor", component_window_launch, {
        appName: "editor",
        icon:    "📝",
        title:   "Code Editor"
    });
    framework_launcher_register("Calculator", component_calc_launch, {
        appName: "calc",
        icon:    "🧮",
        title:   "Calculator"
    });
    framework_launcher_register("Local Storage", component_localstorage_launch, {
        appName: "localstorage",
        icon:    "🗂️",
        title:   "Local Storage"
    });

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

    service_hotkeys_handle_init();

    component_waitingui_handle_init();
    component_linecommand_handle_init();
    component_window_handle_init();
    component_calc_handle_init();
    component_console_handle_init();
    component_chat_handle_init();
    component_clock_handle_init();
    component_localstorage_handle_init();
    service_toast_handle_init();
}

function framework_init() {
    framework_register_launcher();

    window.addEventListener("resize", framework_on_window_resized);

    framework_on_init();

    /* Expose window.shell as a live Proxy view of the registries. Done after
       framework_on_init so all built-in apps are registered, but the Proxy
       itself doesn't snapshot — late dynamic-install registrations are
       picked up automatically. */
    framework_shell_init();

    /* Sweep stale per-app localStorage entries now that every component
       has registered. Runs once per page load. */
    framework_orphan_cleanup();

    handle_kiosk();
    handle_system_restore();

    window.__tm_loaded = true;
}
