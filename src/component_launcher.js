// -----------------------------------------------------------------------------
// component_launcher.js — the floating "E" button that opens the editor.
// -----------------------------------------------------------------------------

function createLauncher() {

    const btn = document.createElement("button");

    btn.textContent = "E";

    Object.assign(btn.style, {
        position: "fixed",
        left: "10px",
        bottom: "90px",
        zIndex: "999999",
        width: "28px",
        height: "28px",
        background: "#202123",
        color: "white",
        border: "1px solid #444",
        borderRadius: "6px",
        cursor: "pointer",
        fontWeight: "bold"
    });

    btn.onclick = () => {

        if (!container) createEditor();

        container.style.display = "flex";

        /* If restored as maximized, the initial split happened before the
           container was visible (offsetHeight was 0). Re-split now. */
        if (windowMode === "maximized") redistributeColumns();
    };

    document.body.appendChild(btn);
}
