// -----------------------------------------------------------------------------
// component_waitingui.js — spinner + Cancel button that replaces the
// .tm-action-btns row during async ChatGPT operations.
// -----------------------------------------------------------------------------

function component_waitingui_handle_init() {
    const s = document.createElement("style");
    s.textContent = `@keyframes tm-spin{to{transform:rotate(360deg)}}`;
    document.head.appendChild(s);
}

function showWaitingUI() {

    if (!headerEl) return;

    const actionBtns = headerEl.querySelector(".tm-action-btns");
    if (actionBtns) {
        actionBtns._savedHTML = actionBtns.innerHTML;
        actionBtns.innerHTML = "";
    }

    const indicator = document.createElement("span");
    indicator.className = "tm-wait-indicator";

    const spinner = document.createElement("span");
    spinner.textContent = "⟳";

    Object.assign(spinner.style, {
        display: "inline-block",
        animation: "tm-spin 1s linear infinite",
        marginRight: "6px",
        fontSize: "14px"
    });

    const label = document.createElement("span");
    label.textContent = "Waiting...";

    indicator.appendChild(spinner);
    indicator.appendChild(label);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "tm-cancel-btn";
    cancelBtn.textContent = "Cancel";

    Object.assign(cancelBtn.style, {
        marginLeft: "10px",
        background: "#c0392b",
        color: "white",
        border: "none",
        borderRadius: "4px",
        padding: "2px 8px",
        cursor: "pointer",
        fontSize: "11px"
    });

    cancelBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof flushLlmQueue === "function") flushLlmQueue();
        if (typeof cancelCurrentLlmJob === "function") cancelCurrentLlmJob();
    };

    if (actionBtns) {
        actionBtns.appendChild(indicator);
        actionBtns.appendChild(cancelBtn);
    }
}

function hideWaitingUI() {

    if (!headerEl) return;

    const actionBtns = headerEl.querySelector(".tm-action-btns");
    if (actionBtns && actionBtns._savedHTML != null) {
        actionBtns.innerHTML = actionBtns._savedHTML;
        delete actionBtns._savedHTML;

        /* Re-attach click handlers since innerHTML destroyed them */
        const btns = actionBtns.querySelectorAll("button");
        btns.forEach(btn => {
            if (btn.textContent === "↻") {
                btn.onclick = (e) => { e.stopPropagation(); regenerateCurrentTab(); };
            } else if (btn.textContent === "Command") {
                btn.onclick = (e) => { e.stopPropagation(); handleLineAction(); };
            } else if (btn.textContent === "Check") {
                btn.onclick = (e) => { e.stopPropagation(); handleCodeCheck(); };
            } else if (btn.querySelector("svg")) {
                btn.onclick = (e) => { e.stopPropagation(); window.open("https://github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey", "_blank"); };
            }
        });
    }
}
