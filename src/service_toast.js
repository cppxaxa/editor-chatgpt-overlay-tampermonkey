// -----------------------------------------------------------------------------
// service_toast.js — Android-style notification toasts + history pane.
//
// Public API:
//
//     service_toast_show(message, opts)
//         opts = {
//             duration: 3000,           // ms, default 3000
//             title:    null,           // optional bold heading line
//             icon:     null            // optional emoji/SVG glyph
//         }
//
//     The on-screen location of all toasts is chosen by the USER from the
//     notifications pane (clock click) — callers cannot override it. The
//     selection persists in localStorage["tm_toast_location"].
//
//     service_toast_get_default_location() / _set_default_location(loc)
//         Programmatic access to the persisted picker value. Valid values:
//         top-left, top-center, top-right, bottom-left, bottom-center,
//         bottom-right.
//
//     service_toast_clear_history()
//         Wipes localStorage["tm_toast_history"].
//
// Toasts auto-dismiss after `duration` ms (or on click). They stack vertically
// at the requested screen corner with a subtle slide-in animation.
//
// History: every toast is appended to localStorage["tm_toast_history"]
// (capped at 50, newest first). Clicking the taskbar clock opens a sliding
// right-side pane listing past toasts.
//
// Init: service_toast_handle_init() must be called from framework_on_init()
// (after service_taskbar_init has built the clock element). It attaches the
// clock click handler and pre-creates the history pane (hidden).
// -----------------------------------------------------------------------------

const TOAST_HISTORY_KEY  = "tm_toast_history";
const TOAST_LOCATION_KEY = "tm_toast_location";
const TOAST_HISTORY_MAX  = 50;

const TOAST_VALID_LOCATIONS = [
    "top-left", "top-center", "top-right",
    "bottom-left", "bottom-center", "bottom-right"
];

const TOAST_DEFAULT_LOCATION = "bottom-right";

/* User-selectable default location, persisted in localStorage. Used when
   service_toast_show() is called without an explicit `location` opt — so the
   user's pick from the notifications pane controls where ALL toasts land. */
function service_toast_get_default_location() {
    try {
        const v = localStorage.getItem(TOAST_LOCATION_KEY);
        if (TOAST_VALID_LOCATIONS.indexOf(v) >= 0) return v;
    } catch (e) {}
    return TOAST_DEFAULT_LOCATION;
}

function service_toast_set_default_location(loc) {
    if (TOAST_VALID_LOCATIONS.indexOf(loc) < 0) return;
    try { localStorage.setItem(TOAST_LOCATION_KEY, loc); } catch (e) {}
    if (_toast_history_open) _service_toast_rebuild_location_picker();
}

/* One stack container per location. Lazily created on first use. Each
   container is a fixed-position div that lays out its toast children
   vertically with a small gap. */
let _toast_stacks = {};   // location -> HTMLElement

let _toast_history_pane = null;
let _toast_history_open = false;

/* ---- Styles (injected once) ---- */

function _service_toast_inject_styles() {
    if (document.getElementById("tm-toast-styles")) return;

    const css =
        "@keyframes tm-toast-in {" +
            "from { opacity: 0; transform: translateY(20px) scale(0.96); }" +
            "to   { opacity: 1; transform: translateY(0)    scale(1);    }" +
        "}" +
        "@keyframes tm-toast-out {" +
            "from { opacity: 1; transform: translateY(0)    scale(1);    }" +
            "to   { opacity: 0; transform: translateY(8px)  scale(0.97); }" +
        "}" +
        "@keyframes tm-toast-pane-in {" +
            "from { transform: translateX(100%); }" +
            "to   { transform: translateX(0);    }" +
        "}" +
        "@keyframes tm-toast-pane-out {" +
            "from { transform: translateX(0);    }" +
            "to   { transform: translateX(100%); }" +
        "}" +

        ".tm-toast {" +
            "font-family: 'Roboto', 'Segoe UI', system-ui, -apple-system, sans-serif;" +
            "font-size: 13px;" +
            "line-height: 1.4;" +
            "color: #f5f5f5;" +
            "background: linear-gradient(180deg, rgba(48,52,64,0.92) 0%, rgba(36,40,50,0.92) 100%);" +
            "backdrop-filter: blur(18px) saturate(170%);" +
            "-webkit-backdrop-filter: blur(18px) saturate(170%);" +
            "border: 1px solid rgba(255,255,255,0.10);" +
            "border-radius: 10px;" +
            "padding: 12px 14px;" +
            "min-width: 240px;" +
            "max-width: 360px;" +
            "box-shadow: 0 6px 20px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.06) inset;" +
            "cursor: pointer;" +
            "user-select: none;" +
            "animation: tm-toast-in 220ms cubic-bezier(0.2,0.7,0.2,1) both;" +
            "display: flex;" +
            "gap: 10px;" +
            "align-items: flex-start;" +
        "}" +
        ".tm-toast.dismissing {" +
            "animation: tm-toast-out 180ms ease-in both;" +
        "}" +
        ".tm-toast-icon {" +
            "flex-shrink: 0;" +
            "width: 22px;" +
            "height: 22px;" +
            "display: flex;" +
            "align-items: center;" +
            "justify-content: center;" +
            "font-size: 18px;" +
            "line-height: 1;" +
            "font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;" +
        "}" +
        ".tm-toast-text {" +
            "flex: 1;" +
            "min-width: 0;" +
            "word-break: break-word;" +
        "}" +
        ".tm-toast-title {" +
            "font-weight: 600;" +
            "font-size: 13px;" +
            "color: #ffffff;" +
            "letter-spacing: 0.1px;" +
            "margin-bottom: 2px;" +
        "}" +
        ".tm-toast-msg {" +
            "color: #e0e3ea;" +
            "font-weight: 400;" +
        "}";

    const style = document.createElement("style");
    style.id = "tm-toast-styles";
    style.textContent = css;
    document.head.appendChild(style);
}

/* ---- Stack container ---- */

function _service_toast_get_stack(location) {

    if (_toast_stacks[location]) return _toast_stacks[location];

    const stack = document.createElement("div");

    /* Base layout — fixed positioning + flex column. The exact corner is
       set per-location below. The taskbar lives at z-index 1000000; toasts
       sit just above so they overlay running-apps buttons but stay below
       modal dialogs (z>=1000020). */
    Object.assign(stack.style, {
        position:      "fixed",
        zIndex:        "1000050",
        display:       "flex",
        flexDirection: "column",
        gap:           "8px",
        pointerEvents: "none"           // children re-enable; the gutter doesn't eat clicks
    });

    /* TASKBAR_HEIGHT (40px) + 12px gutter so bottom-* toasts don't sit on
       the taskbar. Top-* keep a 12px top margin. Center variants align via
       transform. */
    const bottomOffset = "52px";
    const topOffset    = "12px";
    const sideOffset   = "16px";

    switch (location) {
        case "top-left":
            stack.style.top  = topOffset;
            stack.style.left = sideOffset;
            stack.style.alignItems = "flex-start";
            break;
        case "top-right":
            stack.style.top   = topOffset;
            stack.style.right = sideOffset;
            stack.style.alignItems = "flex-end";
            break;
        case "top-center":
            stack.style.top  = topOffset;
            stack.style.left = "50%";
            stack.style.transform  = "translateX(-50%)";
            stack.style.alignItems = "center";
            break;
        case "bottom-left":
            stack.style.bottom = bottomOffset;
            stack.style.left   = sideOffset;
            stack.style.alignItems = "flex-start";
            break;
        case "bottom-center":
            stack.style.bottom = bottomOffset;
            stack.style.left   = "50%";
            stack.style.transform  = "translateX(-50%)";
            stack.style.alignItems = "center";
            break;
        case "bottom-right":
        default:
            stack.style.bottom = bottomOffset;
            stack.style.right  = sideOffset;
            stack.style.alignItems = "flex-end";
            break;
    }

    document.body.appendChild(stack);
    _toast_stacks[location] = stack;
    return stack;
}

/* ---- Public: show ---- */

function service_toast_show(message, opts) {

    _service_toast_inject_styles();

    opts = opts || {};
    const duration = (typeof opts.duration === "number" && opts.duration > 0)
        ? opts.duration : 3000;
    const location = service_toast_get_default_location();
    const title = opts.title || null;
    const icon  = (typeof opts.icon === "string" && opts.icon.length > 0)
        ? opts.icon : "💬";

    /* Record in history before showing (so a quickly-dismissed toast still
       lands). Stored as { ts, message, title, location }. */
    _service_toast_record_history({
        ts:       Date.now(),
        message:  String(message),
        title:    title,
        location: location
    });

    /* Build DOM. */
    const stack = _service_toast_get_stack(location);
    const toast = document.createElement("div");
    toast.className = "tm-toast";
    toast.style.pointerEvents = "auto";

    const iconEl = document.createElement("span");
    iconEl.className = "tm-toast-icon";
    iconEl.textContent = icon;
    toast.appendChild(iconEl);

    const textEl = document.createElement("div");
    textEl.className = "tm-toast-text";

    if (title) {
        const tEl = document.createElement("div");
        tEl.className = "tm-toast-title";
        tEl.textContent = title;
        textEl.appendChild(tEl);
    }

    const mEl = document.createElement("div");
    mEl.className = "tm-toast-msg";
    mEl.textContent = String(message);
    textEl.appendChild(mEl);

    toast.appendChild(textEl);

    /* Click to dismiss early. Auto-dismiss after duration. */
    let dismissed = false;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        toast.classList.add("dismissing");
        setTimeout(() => {
            if (toast.parentElement) toast.parentElement.removeChild(toast);
        }, 180);
    };
    toast.addEventListener("click", dismiss);
    setTimeout(dismiss, duration);

    stack.appendChild(toast);

    return { dismiss };
}

/* ---- History ---- */

function _service_toast_load_history() {
    try {
        const raw = localStorage.getItem(TOAST_HISTORY_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function _service_toast_save_history(arr) {
    try { localStorage.setItem(TOAST_HISTORY_KEY, JSON.stringify(arr)); }
    catch (e) {}
}

function _service_toast_record_history(entry) {
    let arr = _service_toast_load_history();
    arr.unshift(entry);                              // newest first
    if (arr.length > TOAST_HISTORY_MAX) {
        arr = arr.slice(0, TOAST_HISTORY_MAX);
    }
    _service_toast_save_history(arr);

    /* If the history pane is open, refresh it live. */
    if (_toast_history_open) _service_toast_rebuild_history_list();
}

function service_toast_clear_history() {
    _service_toast_save_history([]);
    if (_toast_history_open) _service_toast_rebuild_history_list();
}

/* ---- History pane (right-side slide-in) ---- */

function _service_toast_build_history_pane() {

    if (_toast_history_pane) return _toast_history_pane;

    const pane = document.createElement("div");
    Object.assign(pane.style, {
        position:        "fixed",
        top:             "0",
        right:           "0",
        width:           "340px",
        height:          "calc(100vh - 40px)",   // sit above taskbar
        zIndex:          "1000060",
        background:      "rgba(28, 30, 36, 0.85)",
        backdropFilter:  "blur(22px) saturate(170%)",
        webkitBackdropFilter: "blur(22px) saturate(170%)",
        borderLeft:      "1px solid rgba(255,255,255,0.10)",
        boxShadow:       "-8px 0 28px rgba(0,0,0,0.50)",
        color:           "#f0f0f0",
        fontFamily:      "'Roboto', 'Segoe UI', system-ui, sans-serif",
        fontSize:        "13px",
        display:         "none",
        flexDirection:   "column",
        userSelect:      "none"
    });

    /* Header */
    const header = document.createElement("div");
    Object.assign(header.style, {
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
        padding:        "12px 14px",
        borderBottom:   "1px solid rgba(255,255,255,0.08)"
    });

    const title = document.createElement("div");
    title.textContent = "Notifications";
    Object.assign(title.style, {
        fontWeight: "600",
        fontSize:   "14px",
        letterSpacing: "0.2px"
    });
    header.appendChild(title);

    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, { display: "flex", gap: "6px" });

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear";
    Object.assign(clearBtn.style, {
        background: "rgba(255,255,255,0.08)",
        color:      "#e6e6e6",
        border:     "1px solid rgba(255,255,255,0.12)",
        borderRadius: "4px",
        padding:    "4px 10px",
        cursor:     "pointer",
        fontSize:   "12px",
        fontFamily: "inherit"
    });
    clearBtn.onmouseover = () => { clearBtn.style.background = "rgba(255,255,255,0.16)"; };
    clearBtn.onmouseout  = () => { clearBtn.style.background = "rgba(255,255,255,0.08)"; };
    clearBtn.onclick = () => service_toast_clear_history();
    btnRow.appendChild(clearBtn);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    Object.assign(closeBtn.style, {
        background: "transparent",
        color:      "#e6e6e6",
        border:     "none",
        cursor:     "pointer",
        fontSize:   "16px",
        padding:    "0 4px"
    });
    closeBtn.onclick = () => _service_toast_close_history_pane();
    btnRow.appendChild(closeBtn);

    header.appendChild(btnRow);
    pane.appendChild(header);

    /* ---- Location picker ----
       3x2 grid of corner/edge buttons mirroring the screen. The currently-
       selected slot is highlighted with the cyan accent used elsewhere in
       the shell. Clicking a slot persists the choice immediately and any
       subsequent toast lands at that anchor. */
    const pickerWrap = document.createElement("div");
    pickerWrap.className = "tm-toast-location-picker";
    Object.assign(pickerWrap.style, {
        padding:        "10px 14px 12px",
        borderBottom:   "1px solid rgba(255,255,255,0.08)"
    });

    const pickerLabel = document.createElement("div");
    pickerLabel.textContent = "Toast location";
    Object.assign(pickerLabel.style, {
        fontSize:     "11px",
        color:        "#9aa0aa",
        textTransform: "uppercase",
        letterSpacing: "0.6px",
        marginBottom: "8px"
    });
    pickerWrap.appendChild(pickerLabel);

    const grid = document.createElement("div");
    grid.className = "tm-toast-location-grid";
    Object.assign(grid.style, {
        display:             "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gridTemplateRows:    "32px 32px",
        gap:                 "6px"
    });
    pickerWrap.appendChild(grid);

    pane.appendChild(pickerWrap);

    /* ---- Scrollable list ---- */
    const list = document.createElement("div");
    list.className = "tm-toast-history-list";
    Object.assign(list.style, {
        flex:      "1",
        overflowY: "auto",
        padding:   "8px 10px"
    });
    pane.appendChild(list);

    document.body.appendChild(pane);
    _toast_history_pane = pane;
    _service_toast_rebuild_location_picker();
    return pane;
}

/* Render the 3x2 location-picker grid inside the history pane. Order
   matches screen geometry: top row = top-left, top-center, top-right;
   bottom row = bottom-left, bottom-center, bottom-right. The active
   choice carries the cyan accent + brighter background. Clicking a slot
   persists the new value and lights up the matching button. */
function _service_toast_rebuild_location_picker() {

    if (!_toast_history_pane) return;
    const grid = _toast_history_pane.querySelector(".tm-toast-location-grid");
    if (!grid) return;

    grid.innerHTML = "";
    const current = service_toast_get_default_location();

    const labels = {
        "top-left":      "↖",
        "top-center":    "↑",
        "top-right":     "↗",
        "bottom-left":   "↙",
        "bottom-center": "↓",
        "bottom-right":  "↘"
    };
    const titles = {
        "top-left":      "Top left",
        "top-center":    "Top center",
        "top-right":     "Top right",
        "bottom-left":   "Bottom left",
        "bottom-center": "Bottom center",
        "bottom-right":  "Bottom right"
    };

    /* Render in row-major screen order so the grid visually mirrors the
       screen — top row first, bottom row second. */
    const order = [
        "top-left", "top-center", "top-right",
        "bottom-left", "bottom-center", "bottom-right"
    ];

    order.forEach(loc => {
        const btn = document.createElement("button");
        const active = loc === current;

        btn.title = titles[loc];
        btn.innerHTML =
            "<span style='font-size:14px;line-height:1;'>" + labels[loc] + "</span>" +
            "<span style='font-size:9.5px;letter-spacing:0.3px;opacity:0.85;'>" +
                titles[loc].replace(" ", "·") +
            "</span>";

        Object.assign(btn.style, {
            display:        "flex",
            flexDirection:  "column",
            alignItems:     "center",
            justifyContent: "center",
            gap:            "1px",
            background:     active
                ? "rgba(79,195,247,0.20)"
                : "rgba(255,255,255,0.05)",
            color:          active ? "#ffffff" : "#dadce3",
            border:         active
                ? "1px solid rgba(79,195,247,0.55)"
                : "1px solid rgba(255,255,255,0.10)",
            borderRadius:   "5px",
            cursor:         "pointer",
            fontFamily:     "inherit",
            padding:        "0",
            boxShadow:      active
                ? "0 0 0 1px rgba(79,195,247,0.25), inset 0 1px 0 rgba(255,255,255,0.10)"
                : "none",
            transition:     "background 120ms ease"
        });

        if (!active) {
            btn.onmouseover = () => { btn.style.background = "rgba(255,255,255,0.10)"; };
            btn.onmouseout  = () => { btn.style.background = "rgba(255,255,255,0.05)"; };
        }

        btn.onclick = () => {
            service_toast_set_default_location(loc);
            /* Quick confirmation toast at the new anchor so the user sees
               where future toasts will land. */
            service_toast_show("Toasts will appear here", {
                title:    "Location",
                icon:     "📍",
                duration: 1800
            });
        };

        grid.appendChild(btn);
    });
}

function _service_toast_format_time(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    return hh + ":" + mm + " · " + dd + "-" + mo;
}

function _service_toast_rebuild_history_list() {

    if (!_toast_history_pane) return;
    const list = _toast_history_pane.querySelector(".tm-toast-history-list");
    if (!list) return;

    const entries = _service_toast_load_history();
    list.innerHTML = "";

    if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "No notifications yet";
        Object.assign(empty.style, {
            padding:    "24px 12px",
            color:      "#8a8e98",
            fontStyle:  "italic",
            textAlign:  "center"
        });
        list.appendChild(empty);
        return;
    }

    entries.forEach(e => {
        const row = document.createElement("div");
        Object.assign(row.style, {
            background:    "rgba(255,255,255,0.04)",
            border:        "1px solid rgba(255,255,255,0.06)",
            borderRadius:  "6px",
            padding:       "8px 10px",
            marginBottom:  "6px"
        });

        if (e.title) {
            const t = document.createElement("div");
            t.textContent = e.title;
            Object.assign(t.style, {
                fontWeight: "600",
                fontSize:   "12px",
                color:      "#ffffff",
                marginBottom: "2px"
            });
            row.appendChild(t);
        }

        const m = document.createElement("div");
        m.textContent = e.message;
        Object.assign(m.style, {
            color:       "#dadce3",
            wordBreak:   "break-word",
            whiteSpace:  "pre-wrap",
            fontSize:    "12.5px",
            lineHeight:  "1.4"
        });
        row.appendChild(m);

        const ts = document.createElement("div");
        ts.textContent = _service_toast_format_time(e.ts);
        Object.assign(ts.style, {
            color:    "#8a8e98",
            fontSize: "11px",
            marginTop: "4px"
        });
        row.appendChild(ts);

        list.appendChild(row);
    });
}

function _service_toast_open_history_pane() {
    const pane = _service_toast_build_history_pane();
    _service_toast_rebuild_history_list();
    _service_toast_rebuild_location_picker();
    pane.style.display = "flex";
    pane.style.animation = "tm-toast-pane-in 220ms cubic-bezier(0.2,0.7,0.2,1) both";
    _toast_history_open = true;
}

function _service_toast_close_history_pane() {
    if (!_toast_history_pane) return;
    _toast_history_pane.style.animation = "tm-toast-pane-out 180ms ease-in both";
    _toast_history_open = false;
    setTimeout(() => {
        if (_toast_history_pane && !_toast_history_open) {
            _toast_history_pane.style.display = "none";
        }
    }, 180);
}

function _service_toast_toggle_history_pane() {
    if (_toast_history_open) _service_toast_close_history_pane();
    else                     _service_toast_open_history_pane();
}

/* ---- Init: wire clock click + outside-click dismiss ---- */

function service_toast_handle_init() {

    _service_toast_inject_styles();

    /* Make the taskbar clock a click target. _taskbar_clock_el is in the
       same IIFE (service_taskbar.js). Guard for the case where the shell
       hasn't built yet. */
    if (typeof _taskbar_clock_el !== "undefined" && _taskbar_clock_el) {
        _taskbar_clock_el.style.cursor = "pointer";
        _taskbar_clock_el.title = "Show notifications";
        _taskbar_clock_el.addEventListener("click", (e) => {
            e.stopPropagation();
            _service_toast_toggle_history_pane();
        });
    }

    /* Outside-click closes the pane. The clock click is stopPropagation'd
       above so this listener doesn't see it and immediately reclose. */
    document.addEventListener("mousedown", (e) => {
        if (!_toast_history_open || !_toast_history_pane) return;
        if (_toast_history_pane.contains(e.target)) return;
        _service_toast_close_history_pane();
    }, true);
}
