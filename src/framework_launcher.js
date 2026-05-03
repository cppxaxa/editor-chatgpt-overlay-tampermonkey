// -----------------------------------------------------------------------------
// framework_launcher.js — framework-level launcher button registry.
//
// Any component that wants a fixed-position floating launcher button (like
// the editor's "E") calls:
//
//     framework_launcher_register("E", () => { ... open my thing ... });
//     framework_launcher_register("E", () => { ... }, {
//         icon:  "<svg>...</svg>" | "E",        // HTML or text glyph
//         title: "Editor — code scratchpad"     // tooltip / secondary line
//     });
//
// Multiple registrations stack vertically in the bottom-left corner — each
// new button sits one slot above the previous one. The registry owns all
// styling so every launcher button looks identical.
// -----------------------------------------------------------------------------

const FRAMEWORK_LAUNCHER_SIZE = 28;       // button width/height in px
const FRAMEWORK_LAUNCHER_GAP = 6;         // gap between stacked buttons in px
const FRAMEWORK_LAUNCHER_BASE_BOTTOM = 90; // px from viewport bottom for the first slot
const FRAMEWORK_LAUNCHER_LEFT = 10;        // px from viewport left

let _framework_launcher_count = 0;

function framework_launcher_register_simple(textContent, onlaunch, opts) {

    opts = opts || {};

    const slotIndex = _framework_launcher_count;
    _framework_launcher_count++;

    const bottom = FRAMEWORK_LAUNCHER_BASE_BOTTOM
        + slotIndex * (FRAMEWORK_LAUNCHER_SIZE + FRAMEWORK_LAUNCHER_GAP);

    const btn = document.createElement("button");

    /* Prefer icon over textContent. icon may be inline HTML (e.g. an SVG)
       or plain text. Fall back to textContent when no icon is provided so
       existing two-arg callers still work. */
    if (opts.icon) {
        btn.innerHTML = opts.icon;
    } else {
        btn.textContent = textContent;
    }
    if (opts.title) btn.title = opts.title;

    Object.assign(btn.style, {
        position: "fixed",
        left: FRAMEWORK_LAUNCHER_LEFT + "px",
        bottom: bottom + "px",
        zIndex: "999999",
        width: FRAMEWORK_LAUNCHER_SIZE + "px",
        height: FRAMEWORK_LAUNCHER_SIZE + "px",
        background: "#202123",
        color: "white",
        border: "1px solid #444",
        borderRadius: "6px",
        cursor: "pointer",
        fontWeight: "bold",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    });

    btn.onclick = () => {
        if (typeof onlaunch === "function") {
            try {
                /* Record this button's rect as the one-shot launch anchor so
                   the next ServiceWindow.show() animates from here. */
                if (typeof ServiceWindow !== "undefined" && ServiceWindow.setLaunchAnchor) {
                    ServiceWindow.setLaunchAnchor(btn.getBoundingClientRect());
                }
                onlaunch();
            }
            catch (e) { console.error("framework_launcher onlaunch threw:", e); }
        }
    };

    document.body.appendChild(btn);
}

function framework_launcher_register_kdeubuntu(textContent, onlaunch, opts) {
    framework_launcher_kdeubuntu_register(textContent, onlaunch, opts);
}

/* Public API for components to register launcher buttons. Switches between the
   simple stacked-button style and the KDE/Ubuntu-style desktop shell.

   `opts` (optional):
     icon  — inline HTML (e.g. an <svg>) or text glyph for the button face.
             If omitted, `textContent` is used as the face.
     title — tooltip / accessible name. Also used as a secondary line in
             the kdeubuntu Start menu when present and different from the
             primary label. */
function framework_launcher_register(textContent, onlaunch, opts) {
    framework_launcher_register_kdeubuntu(textContent, onlaunch, opts);
}