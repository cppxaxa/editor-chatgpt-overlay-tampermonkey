// -----------------------------------------------------------------------------
// service_hotkeys.js — single document-level keydown dispatcher that routes
// window-scoped hotkeys to the currently-active ServiceWindow.
//
// Components register their hotkeys against their ServiceWindow instance:
//
//     service_hotkeys_register(editorServiceWindow, "alt+1", () => switchTab("editor"));
//
// On each keydown, the dispatcher reads ServiceWindow.activeWindow() and looks
// up the combo in that window's map. If found, preventDefault + invoke. If no
// window is active, or the active window has no binding for the combo, the
// event is left alone.
//
// Combo strings are normalized to "ctrl+alt+shift+<key>" (lowercase, modifiers
// in fixed order). Use single-character keys ("a", "1") or named keys lowercase
// ("enter", "tab", "escape", "arrowup"). Browser-reserved combos (Ctrl+T,
// Ctrl+W, Ctrl+1..9, Ctrl+0, etc.) cannot be intercepted from a page — the
// dispatcher will simply never fire for them.
//
// There is intentionally no "global" registration path: hotkeys without an
// active window do nothing. Add such a path only if a real use case shows up.
// There is also no unregister API; windows are created once and live for the
// page lifetime today.
// -----------------------------------------------------------------------------

/* WeakMap so registry entries are GC-able if a ServiceWindow is ever dropped.
   Map<ServiceWindow, Map<comboString, callback>> */
const _hotkeyRegistry = new WeakMap();

function _hotkeys_normalize_combo(combo) {
    const parts = String(combo).toLowerCase().split("+").map(s => s.trim());
    const mods = { ctrl: false, alt: false, shift: false };
    let key = "";
    for (const p of parts) {
        if (p === "ctrl" || p === "control") mods.ctrl = true;
        else if (p === "alt") mods.alt = true;
        else if (p === "shift") mods.shift = true;
        else key = p;
    }
    return (mods.ctrl ? "ctrl+" : "") + (mods.alt ? "alt+" : "") + (mods.shift ? "shift+" : "") + key;
}

function _hotkeys_combo_from_event(e) {
    const key = e.key.toLowerCase();
    return (e.ctrlKey ? "ctrl+" : "") + (e.altKey ? "alt+" : "") + (e.shiftKey ? "shift+" : "") + key;
}

function service_hotkeys_register(serviceWindow, combo, callback) {
    if (!serviceWindow) {
        console.warn("service_hotkeys_register: missing serviceWindow for combo", combo);
        return;
    }
    let map = _hotkeyRegistry.get(serviceWindow);
    if (!map) {
        map = new Map();
        _hotkeyRegistry.set(serviceWindow, map);
    }
    map.set(_hotkeys_normalize_combo(combo), callback);
}

/* Used by component_editor.js to gate Ctrl+Z/Y on the textarea handler:
   undo/redo should only fire when the editor window is the active one. */
function service_hotkeys_is_active(serviceWindow) {
    return ServiceWindow.activeWindow() === serviceWindow;
}

function service_hotkeys_handle_init() {
    document.addEventListener("keydown", (e) => {
        const active = ServiceWindow.activeWindow();
        if (!active) return;
        const map = _hotkeyRegistry.get(active);
        if (!map) return;
        const cb = map.get(_hotkeys_combo_from_event(e));
        if (!cb) return;
        e.preventDefault();
        cb(e);
    });
}
