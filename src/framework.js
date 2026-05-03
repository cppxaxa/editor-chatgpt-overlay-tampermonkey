// -----------------------------------------------------------------------------
// framework.js — framework-level shared state and lifecycle bootstrap.
//
// Component-owned state has been moved into the owning component_*.js files.
// What lives here is genuinely cross-component:
//   - waitAbortController: the single in-flight cancellable LLM request,
//     shared by every tab generator, line commands, codecheck, waitingui,
//     and service_llm.
// -----------------------------------------------------------------------------

/* ---- Framework-level shared state ---- */

let waitAbortController = null;

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
