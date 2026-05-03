// -----------------------------------------------------------------------------
// service_menu.js — generic popup menu service.
//
// Two pieces:
//   - service_menu_last_pointer()  — global { x, y } of the last mousedown or
//                                    touchstart anywhere in the document. Use
//                                    when you want a popup to anchor at the
//                                    point the user just interacted with
//                                    (matches the "open menu under cursor"
//                                    behaviour on a desktop and "open menu at
//                                    finger" on touch).
//   - ServiceMenu class            — accumulates entries via .addItem() /
//                                    .addToggle() / .addSeparator(), then
//                                    .openAt(x, y) renders a glass popup
//                                    anchored at (x, y), clamped to viewport.
//                                    Auto-closes on outside click / Escape /
//                                    item activation.
//
// The class is intentionally light: no submenus, no icons, no keyboard nav
// beyond Escape. Toggle items render with a small switch glyph that flips
// state when clicked, then call the setter.
// -----------------------------------------------------------------------------

let _service_menu_last_x = window.innerWidth  / 2;
let _service_menu_last_y = window.innerHeight / 2;

document.addEventListener("mousedown", (e) => {
    _service_menu_last_x = e.clientX;
    _service_menu_last_y = e.clientY;
}, true);

document.addEventListener("touchstart", (e) => {
    if (e.touches && e.touches[0]) {
        _service_menu_last_x = e.touches[0].clientX;
        _service_menu_last_y = e.touches[0].clientY;
    }
}, true);

function service_menu_last_pointer() {
    return { x: _service_menu_last_x, y: _service_menu_last_y };
}

class ServiceMenu {

    constructor() {
        this._entries = [];   // [{ kind, ...payload }]
        this._popup   = null;
    }

    /* opts: { label, onClick }  — onClick is called after the menu closes. */
    addItem(opts) {
        this._entries.push({ kind: "item", label: opts.label, onClick: opts.onClick });
        return this;
    }

    /* opts: { label, getter, setter }
       - getter() returns the current bool.
       - setter(newBool) is called when the user clicks the row. */
    addToggle(opts) {
        this._entries.push({
            kind: "toggle",
            label: opts.label,
            getter: opts.getter,
            setter: opts.setter
        });
        return this;
    }

    addSeparator() {
        this._entries.push({ kind: "separator" });
        return this;
    }

    /* Render the popup at viewport (x, y). The popup is clamped to fit
       inside the viewport (so corner clicks still produce visible menus).
       Returns the popup root <div>. */
    openAt(x, y) {

        this.close();

        const popup = document.createElement("div");
        Object.assign(popup.style, {
            position: "fixed",
            left: x + "px",
            top:  y + "px",
            minWidth: "200px",
            zIndex: "1000010",
            background: "rgba(28, 30, 36, 0.78)",
            backdropFilter: "blur(22px) saturate(160%)",
            webkitBackdropFilter: "blur(22px) saturate(160%)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "6px",
            boxShadow: "0 8px 28px rgba(0,0,0,0.55)",
            padding: "4px 0",
            color: "white",
            fontFamily: "'Segoe UI', system-ui, sans-serif",
            fontSize: "13px",
            userSelect: "none"
        });

        for (const e of this._entries) {
            if (e.kind === "separator") {
                const sep = document.createElement("div");
                Object.assign(sep.style, {
                    height: "1px",
                    margin: "4px 0",
                    background: "rgba(255,255,255,0.1)"
                });
                popup.appendChild(sep);
                continue;
            }

            const row = document.createElement("button");
            Object.assign(row.style, {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                width: "100%",
                background: "transparent",
                color: "white",
                border: "none",
                padding: "8px 14px",
                cursor: "pointer",
                fontSize: "13px",
                fontFamily: "inherit",
                textAlign: "left"
            });
            row.onmouseover = () => { row.style.background = "rgba(255,255,255,0.08)"; };
            row.onmouseout  = () => { row.style.background = "transparent"; };

            const labelEl = document.createElement("span");
            labelEl.textContent = e.label;
            row.appendChild(labelEl);

            if (e.kind === "toggle") {
                const sw = _service_menu_make_switch(!!e.getter());
                row.appendChild(sw.el);
                row.onclick = () => {
                    const next = !e.getter();
                    sw.set(next);
                    try { e.setter(next); } catch (err) { console.error(err); }
                    this.close();
                };
            } else {
                row.onclick = () => {
                    this.close();
                    try { e.onClick && e.onClick(); } catch (err) { console.error(err); }
                };
            }

            popup.appendChild(row);
        }

        document.body.appendChild(popup);
        this._popup = popup;

        /* Clamp into viewport after measuring. */
        requestAnimationFrame(() => {
            if (!this._popup) return;
            const r = this._popup.getBoundingClientRect();
            if (r.right > window.innerWidth) {
                this._popup.style.left = Math.max(0, window.innerWidth - r.width - 4) + "px";
            }
            if (r.bottom > window.innerHeight) {
                this._popup.style.top = Math.max(0, window.innerHeight - r.height - 4) + "px";
            }
        });

        /* Outside click / Escape close */
        const onDown = (e) => {
            if (this._popup && !this._popup.contains(e.target)) this.close();
        };
        const onKey = (e) => {
            if (e.key === "Escape") this.close();
        };
        setTimeout(() => {
            document.addEventListener("mousedown", onDown, true);
            document.addEventListener("keydown",   onKey,  true);
        }, 0);
        this._cleanup = () => {
            document.removeEventListener("mousedown", onDown, true);
            document.removeEventListener("keydown",   onKey,  true);
        };

        return popup;
    }

    close() {
        if (this._cleanup) { this._cleanup(); this._cleanup = null; }
        if (this._popup && this._popup.parentNode) {
            this._popup.parentNode.removeChild(this._popup);
        }
        this._popup = null;
    }
}

/* ---- Internal switch widget (used by addToggle) ---- */

function _service_menu_make_switch(initial) {

    const track = document.createElement("span");
    Object.assign(track.style, {
        position: "relative",
        display: "inline-block",
        width: "30px",
        height: "16px",
        borderRadius: "8px",
        background: initial ? "#4fc3f7" : "rgba(255,255,255,0.18)",
        transition: "background 150ms ease",
        flexShrink: "0"
    });

    const knob = document.createElement("span");
    Object.assign(knob.style, {
        position: "absolute",
        top: "2px",
        left: initial ? "16px" : "2px",
        width: "12px",
        height: "12px",
        borderRadius: "50%",
        background: "white",
        transition: "left 150ms ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.4)"
    });
    track.appendChild(knob);

    return {
        el: track,
        set(on) {
            track.style.background = on ? "#4fc3f7" : "rgba(255,255,255,0.18)";
            knob.style.left = on ? "16px" : "2px";
        }
    };
}
