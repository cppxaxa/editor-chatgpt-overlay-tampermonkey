// -----------------------------------------------------------------------------
// component_kiosk.js — kiosk-mode UI behaviour. Invoked by handle_kiosk()
// in framework_kiosk.js when localStorage["kiosk"] === "true". Opens the
// floating editor and forces it into maximized mode so the app behaves
// like a kiosk-style single-window experience.
// -----------------------------------------------------------------------------

function component_kiosk() {

    /* 1. Open the editor dialog (lazy-create on first use, just like the
          launcher button does). */
    if (!container) createEditor();
    container.style.display = "flex";

    /* 2. Maximize it if it isn't already. The maximize button is not held
          in a global ref, so locate it by text content within the header.
          Falls back to inlining the same state transitions performed by
          maxBtn.onclick in component_window.js if the button can't be
          found (e.g. future markup changes). */
    if (windowMode !== "maximized") {
        const maxBtn = container.querySelector
            ? Array.from(container.querySelectorAll("button"))
                .find(b => b.textContent === "□")
            : null;

        if (maxBtn) {
            maxBtn.click();
        } else {
            previousBounds = {
                left: container.style.left,
                top: container.style.top,
                width: container.style.width,
                height: container.style.height
            };
            container.style.left = "0";
            container.style.top = "0";
            container.style.width = "100vw";
            container.style.height = "100vh";
            if (resizeHandle) resizeHandle.style.display = "none";
            windowMode = "maximized";
            if (activeTab === "editor") enterMaximizedColumnLayout();
        }
    }

    /* If we ended up maximized (just now or already), re-split the columns
       since the launcher path does the same when restoring. */
    if (windowMode === "maximized") redistributeColumns();
}
