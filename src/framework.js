// -----------------------------------------------------------------------------
// framework.js — framework-level shared state and lifecycle bootstrap.
//
// Component-owned state has been moved into the owning component_*.js files.
// LLM cancellation state lives inside service_llm.js (see cancelCurrentLlmJob).
// -----------------------------------------------------------------------------

/* ---- Bootstrap ---- */

function framework_register_launcher() {

    framework_launcher_register("E", () => {

        if (!container) createEditor();

        container.style.display = "flex";

        /* If restored as maximized, the initial split happened before the
           container was visible (offsetHeight was 0). Re-split now. */
        if (windowMode === "maximized") redistributeColumns();
    });
}

function framework_init() {

    framework_register_launcher();

    registerLineReaderHotkey();

    window.addEventListener("resize", () => {
        if (windowMode === "maximized") redistributeColumns();
    });

    const tmStyle = document.createElement("style");
    tmStyle.textContent = `@keyframes tm-spin{to{transform:rotate(360deg)}}`;
    document.head.appendChild(tmStyle);

    framework_scrollbars_inject();

    handle_kiosk();
}
