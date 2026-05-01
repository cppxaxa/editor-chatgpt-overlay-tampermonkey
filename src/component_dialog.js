// -----------------------------------------------------------------------------
// component_dialog.js — modal result dialog (used by Code Check, etc.).
// -----------------------------------------------------------------------------

function showResultDialog(title, body) {

    const existing = document.getElementById("tm-result-dialog");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "tm-result-dialog";

    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        background: "rgba(0,0,0,.55)",
        zIndex: "9999999",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    });

    const dialog = document.createElement("div");

    Object.assign(dialog.style, {
        background: "#1e1e1e",
        color: "#c9a36a",
        border: "1px solid #444",
        borderRadius: "10px",
        padding: "20px 24px",
        maxWidth: "520px",
        width: "90%",
        maxHeight: "70vh",
        overflowY: "auto",
        fontFamily: "monospace",
        fontSize: "13px",
        boxShadow: "0 12px 40px rgba(0,0,0,.6)"
    });

    const heading = document.createElement("div");

    Object.assign(heading.style, {
        fontSize: "15px",
        fontWeight: "bold",
        marginBottom: "14px",
        color: "white"
    });

    heading.textContent = title;

    const content = document.createElement("pre");

    Object.assign(content.style, {
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: "0",
        lineHeight: "1.5"
    });

    content.textContent = body;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";

    Object.assign(closeBtn.style, {
        marginTop: "16px",
        background: "#444",
        color: "white",
        border: "none",
        borderRadius: "6px",
        padding: "6px 18px",
        cursor: "pointer",
        fontSize: "13px",
        display: "block",
        marginLeft: "auto"
    });

    closeBtn.onclick = () => overlay.remove();

    dialog.appendChild(heading);
    dialog.appendChild(content);
    dialog.appendChild(closeBtn);
    overlay.appendChild(dialog);

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);

    closeBtn.focus();
}
