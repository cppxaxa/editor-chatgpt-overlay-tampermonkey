// -----------------------------------------------------------------------------
// service_taskbar.js — KDE/Ubuntu-style desktop shell + open-windows tracker.
//
// Provides:
//   service_taskbar_init()                 — idempotent. Builds the full-screen
//                                            wallpaper, the bottom taskbar
//                                            (start button, running apps list,
//                                            system tray, up arrow, clock),
//                                            and patches ServiceWindow.show /
//                                            .hide / .defaultMinimize so any
//                                            ServiceWindow instance is tracked
//                                            in the running-apps list
//                                            automatically.
//   service_taskbar_register_app(label, onlaunch)
//                                          — append an entry to the Start menu.
//                                            Clicking the entry runs onlaunch.
//   service_taskbar_minimize_window(sw)    — minimize a tracked ServiceWindow
//                                            (used by the running-apps button).
//   service_taskbar_restore_window(sw)     — restore (un-minimize / show) a
//                                            tracked ServiceWindow.
//
// The taskbar button for a window toggles minimize/restore on click. Hidden
// windows (closed) are removed from the running-apps list automatically.
// -----------------------------------------------------------------------------

const TASKBAR_HEIGHT = 40;

let _taskbar_initialized = false;
let _taskbar_apps        = [];   // [{ label, onlaunch }]
let _taskbar_windows     = [];   // [{ sw, btn }]

let _taskbar_wallpaper_el  = null;
let _taskbar_el            = null;
let _taskbar_running_el    = null;
let _taskbar_start_btn     = null;
let _taskbar_start_menu    = null;
let _taskbar_start_search  = null;
let _taskbar_start_list    = null;
let _taskbar_tray_el       = null;
let _taskbar_clock_el      = null;
let _taskbar_clock_timer   = null;

function service_taskbar_init() {

    if (_taskbar_initialized) return;
    _taskbar_initialized = true;

    _service_taskbar_build_wallpaper();
    _service_taskbar_build_taskbar();
    _service_taskbar_build_start_menu();
    _service_taskbar_patch_service_window();
    _service_taskbar_start_clock();
    _service_taskbar_install_hotkey();

    /* Restore the "hidden shell" preference so the user's last choice
       survives a reload. */
    if (_service_taskbar_is_hidden()) {
        _service_taskbar_hide_shell();
    }

    /* Close start menu when clicking outside it. */
    document.addEventListener("mousedown", (e) => {
        if (!_taskbar_start_menu || _taskbar_start_menu.style.display === "none") return;
        if (_taskbar_start_menu.contains(e.target)) return;
        if (_taskbar_start_btn.contains(e.target)) return;
        _service_taskbar_close_start_menu();
    });
}

function service_taskbar_register_app(label, onlaunch, opts) {
    opts = opts || {};
    _taskbar_apps.push({
        label:    label,
        onlaunch: onlaunch,
        icon:     opts.icon    || null,
        title:    opts.title   || null,
        appName:  opts.appName || null   // for taskbar-icon lookup by ServiceWindow.appName
    });
    _service_taskbar_rebuild_start_list("");
}

/* Resolve a human-readable label for an app by its ServiceWindow.appName.
   Looks up tray/Start-menu registries so the taskbar shows "Calculator"
   instead of "calc" and "Code Editor" instead of "editor". Falls back to
   the appName (capitalised) when no registration matches. */
function service_taskbar_get_app_label(appName) {
    if (!appName) return "Window";

    const trayApp = _tray_apps.find(a =>
        a.appName === appName || a.label === appName);
    if (trayApp && trayApp.title) return trayApp.title;
    if (trayApp && trayApp.label) return trayApp.label;

    const startApp = _taskbar_apps.find(a =>
        a.appName === appName || a.label === appName);
    if (startApp && startApp.title) return startApp.title;
    if (startApp && startApp.label) return startApp.label;

    /* No registry entry — capitalise appName as a last resort. */
    return appName.charAt(0).toUpperCase() + appName.slice(1);
}

/* Resolve an icon (inline HTML — emoji or SVG) for an app by its
   ServiceWindow.appName. Looks up the system-tray registry first (most
   specific), then the Start-menu app registry. Returns null if no icon
   is registered under that name. Used by the taskbar's running-apps
   button renderer to give every open window a recognisable glyph. */
function service_taskbar_get_app_icon(appName) {
    if (!appName) return null;

    /* Tray-app registry — also try matching by label since some callers
       might use that instead of appName. */
    const trayApp = _tray_apps.find(a =>
        a.appName === appName || a.label === appName);
    if (trayApp && trayApp.icon) return trayApp.icon;

    /* Start-menu app registry — try appName field, then label. */
    const startApp = _taskbar_apps.find(a =>
        a.appName === appName || a.label === appName);
    if (startApp && startApp.icon) return startApp.icon;

    return null;
}

/* ---- Wallpaper ---- */

function _service_taskbar_build_wallpaper() {

    const wp = document.createElement("div");

    /* Solid/gradient fallback applied immediately so the user never sees a
       white flash. If a wallpaper file lives in the IndexedDB-backed src-fs
       store, we override the background once it loads.

       pointerEvents: "auto" so the wallpaper behaves like an OS desktop —
       it eats clicks/hovers instead of letting them fall through to the
       chatgpt.com page underneath. When the user toggles "Hide desktop
       shell" the wallpaper element gets display:none, which removes it
       from hit-testing entirely, so the underlying page becomes
       interactive again. */
    Object.assign(wp.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: "100vw",
        height: "100vh",
        zIndex: "1",
        background: "linear-gradient(135deg, #2b3a55 0%, #1d2b45 50%, #0f1a2e 100%)",
        pointerEvents: "auto"
    });

    /* Clicking the empty wallpaper closes any open start menu — mimics OS
       "click empty desktop dismisses popups" behaviour. */
    wp.addEventListener("mousedown", () => {
        _service_taskbar_close_start_menu();
    });

    document.body.appendChild(wp);
    _taskbar_wallpaper_el = wp;

    /* Try a few conventional names; first hit wins. service_fs_get returns
       null (not throws) for missing keys, so the gradient fallback persists
       cleanly when nothing matches. */
    (async () => {
        for (const name of ["wallpaper.jpg", "wallpaper.png", "wallpaper.webp", "wallpaper.jpeg"]) {
            try {
                const f = await service_fs_get(name);
                if (f && f.dataUrl) {
                    wp.style.background =
                        "center/cover no-repeat url('" + f.dataUrl + "')";
                    return;
                }
            } catch (e) { /* keep trying / fall through to gradient */ }
        }
    })();
}

/* ---- Taskbar ---- */

/* Inject the keyframes + selectors that drive the start-button icon
   animations. Idempotent — guarded by a known id on the <style> tag.
   The four panes carry different shades of white at rest:
       TL  #ffffff   (pure white)
       TR  #f0f0f0   (off-white)
       BL  #d8d8d8   (silver)
       BR  #b8b8b8   (light grey)
   On hover, an animation cycles the shades clockwise so the logo looks
   like it's rotating. On click, .tm-start-icon-clicked plays a quick
   stagger flash (TL → TR → BR → BL pulse to bright cyan-white) then
   settles. */
function _service_taskbar_inject_styles() {

    if (document.getElementById("tm-taskbar-styles")) return;

    const css =
        ".tm-pane { transition: fill 180ms ease; }" +
        ".tm-pane-tl { fill: #ffffff; }" +
        ".tm-pane-tr { fill: #f0f0f0; }" +
        ".tm-pane-bl { fill: #d8d8d8; }" +
        ".tm-pane-br { fill: #b8b8b8; }" +

        /* Hover: each pane runs the same 4-step cycle, but with staggered
           negative delays so the bright shade walks clockwise around the
           icon (TL -> TR -> BR -> BL -> TL). */
        "@keyframes tm-start-rotate {" +
            "0%   { fill: #ffffff; }" +
            "25%  { fill: #f0f0f0; }" +
            "50%  { fill: #d8d8d8; }" +
            "75%  { fill: #b8b8b8; }" +
            "100% { fill: #ffffff; }" +
        "}" +
        ".tm-start-icon:hover .tm-pane-tl,        .tm-start-btn:hover .tm-pane-tl { animation: tm-start-rotate 1.6s linear infinite;          }" +
        ".tm-start-icon:hover .tm-pane-tr,        .tm-start-btn:hover .tm-pane-tr { animation: tm-start-rotate 1.6s linear infinite -0.4s;    }" +
        ".tm-start-icon:hover .tm-pane-br,        .tm-start-btn:hover .tm-pane-br { animation: tm-start-rotate 1.6s linear infinite -0.8s;    }" +
        ".tm-start-icon:hover .tm-pane-bl,        .tm-start-btn:hover .tm-pane-bl { animation: tm-start-rotate 1.6s linear infinite -1.2s;    }" +

        /* Click: a one-shot stagger flash to bright cyan-white. Each pane
           uses the same keyframes but a different animation-delay so the
           bright peak walks TL -> TR -> BR -> BL across ~600ms. */
        "@keyframes tm-start-flash {" +
            "0%   { fill: #ffffff; }" +
            "30%  { fill: #e0f7ff; }" +
            "60%  { fill: #ffffff; }" +
            "100% { fill: #ffffff; }" +
        "}" +
        ".tm-start-icon-clicked .tm-pane-tl { animation: tm-start-flash 600ms ease-out; }" +
        ".tm-start-icon-clicked .tm-pane-tr { animation: tm-start-flash 600ms ease-out 80ms; }" +
        ".tm-start-icon-clicked .tm-pane-br { animation: tm-start-flash 600ms ease-out 160ms; }" +
        ".tm-start-icon-clicked .tm-pane-bl { animation: tm-start-flash 600ms ease-out 240ms; }";

    const style = document.createElement("style");
    style.id = "tm-taskbar-styles";
    style.textContent = css;
    document.head.appendChild(style);
}

function _service_taskbar_build_taskbar() {

    const bar = document.createElement("div");

    Object.assign(bar.style, {
        position: "fixed",
        left: "0",
        bottom: "0",
        width: "100vw",
        height: TASKBAR_HEIGHT + "px",
        zIndex: "1000000",
        background: "rgba(48, 52, 64, 0.55)",
        backdropFilter: "blur(18px) saturate(170%) brightness(115%)",
        webkitBackdropFilter: "blur(18px) saturate(170%) brightness(115%)",
        /* Top edge drawn as an inset shadow rather than a real border so child
           buttons (Start, running-apps, system-tray) with their own background
           paint over it — letting the Start button visually overlap the
           taskbar's top edge instead of being cut off by it. */
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 -2px 12px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "stretch",
        color: "white",
        fontFamily: "sans-serif",
        fontSize: "12px",
        userSelect: "none"
    });

    /* Start button (leftmost) — 4-pane white logo + "Start" label.
       Each pane uses a different shade of white at rest. On hover the panes
       cycle their shades clockwise (rotation feel). On click the panes flash
       in a stagger (TL → TR → BR → BL) before settling back. Animations are
       defined once in service_taskbar_inject_styles(). */
    _service_taskbar_inject_styles();

    const startBtn = document.createElement("button");
    startBtn.className = "tm-start-btn";
    startBtn.innerHTML =
        "<svg class='tm-start-icon' width='20' height='20' viewBox='0 0 24 24' " +
        "xmlns='http://www.w3.org/2000/svg' " +
        "style='vertical-align:middle;margin-right:8px'>" +
            "<rect class='tm-pane tm-pane-tl' x='2'  y='2'  width='9' height='9'/>" +
            "<rect class='tm-pane tm-pane-tr' x='13' y='2'  width='9' height='9'/>" +
            "<rect class='tm-pane tm-pane-bl' x='2'  y='13' width='9' height='9'/>" +
            "<rect class='tm-pane tm-pane-br' x='13' y='13' width='9' height='9'/>" +
        "</svg>" +
        "<span>Start</span>";
    /* Glossy / glass 3D look — solid blue base + a top-half white reflection
       and a hard reflection line at the midpoint. Inner top highlight + outer
       drop shadow give it physical depth. Hover and active are the same
       background recipe shifted lighter / darker. */
    const startBgRest =
        "linear-gradient(180deg," +
            "rgba(255,255,255,0.55) 0%," +
            "rgba(255,255,255,0.15) 49%," +
            "rgba(0,0,0,0.05) 50%," +
            "rgba(255,255,255,0.0) 100%)," +
        "#2196f3";
    const startBgHover =
        "linear-gradient(180deg," +
            "rgba(255,255,255,0.65) 0%," +
            "rgba(255,255,255,0.20) 49%," +
            "rgba(0,0,0,0.05) 50%," +
            "rgba(255,255,255,0.0) 100%)," +
        "#42a5f5";
    const startBgActive =
        "linear-gradient(180deg," +
            "rgba(0,0,0,0.10) 0%," +
            "rgba(255,255,255,0.10) 49%," +
            "rgba(255,255,255,0.30) 50%," +
            "rgba(255,255,255,0.0) 100%)," +
        "#1976d2";

    Object.assign(startBtn.style, {
        background: startBgRest,
        color: "white",
        textShadow: "0 1px 0 rgba(0,0,0,0.35)",
        border: "none",
        borderRight: "1px solid rgba(255,255,255,0.12)",
        padding: "0 14px",
        cursor: "pointer",
        fontWeight: "bold",
        fontSize: "13px",
        flexShrink: "0",
        display: "flex",
        alignItems: "center",
        boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.6)," +
            "0 2px 4px rgba(0,0,0,0.4)",
        transition: "background 120ms ease, transform 80ms ease"
    });
    startBtn.onmouseover = () => { startBtn.style.background = startBgHover; };
    startBtn.onmouseout  = () => {
        startBtn.style.background = startBgRest;
        startBtn.style.transform  = "none";
    };
    startBtn.onmousedown  = () => {
        startBtn.style.background = startBgActive;
        /* Tiny press: 1px down + slightly compressed shadow gives the gel a
           push-in feel without affecting layout of neighbours. */
        startBtn.style.transform = "translateY(1px)";
    };
    startBtn.onmouseup    = () => {
        startBtn.style.transform = "none";
    };
    startBtn.onclick = (e) => {
        e.stopPropagation();
        /* Re-trigger click animation: remove + force reflow + re-add. */
        const icon = startBtn.querySelector(".tm-start-icon");
        if (icon) {
            icon.classList.remove("tm-start-icon-clicked");
            void icon.offsetWidth;
            icon.classList.add("tm-start-icon-clicked");
        }
        _service_taskbar_toggle_start_menu();
    };
    bar.appendChild(startBtn);
    _taskbar_start_btn = startBtn;

    /* Running apps area */
    const running = document.createElement("div");
    Object.assign(running.style, {
        flex: "1",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "0 8px",
        overflow: "hidden"
    });
    bar.appendChild(running);
    _taskbar_running_el = running;

    /* Right-side cluster: up arrow, system tray, clock */
    const right = document.createElement("div");
    Object.assign(right.style, {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "0 10px",
        flexShrink: "0",
        borderLeft: "1px solid rgba(255,255,255,0.08)"
    });

    /* Up arrow — Windows-style thin chevron, "Show hidden icons" affordance. */
    const up = document.createElement("button");
    up.innerHTML =
        "<svg width='12' height='12' viewBox='0 0 12 12' " +
        "xmlns='http://www.w3.org/2000/svg' style='display:block'>" +
            "<polyline points='2,8 6,4 10,8' fill='none' stroke='currentColor' " +
            "stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/>" +
        "</svg>";
    Object.assign(up.style, {
        background: "transparent",
        color: "#e6e6e6",
        border: "none",
        cursor: "pointer",
        padding: "6px 8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    });
    up.title = "Show hidden icons";
    up.onmouseover = () => { up.style.background = "rgba(255,255,255,0.08)"; };
    up.onmouseout  = () => { up.style.background = "transparent"; };
    up.onclick = (e) => {
        e.stopPropagation();
        _service_taskbar_open_tray_overflow(up);
    };
    right.appendChild(up);

    /* System tray (empty) */
    const tray = document.createElement("div");
    Object.assign(tray.style, {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        minWidth: "20px",
        padding: "0 4px"
    });
    right.appendChild(tray);
    _taskbar_tray_el = tray;

    /* Clock — Windows-style: time on top, date below, both white, Segoe UI,
       equal weight + size. Two-line stack, right-aligned. */
    const clock = document.createElement("div");
    Object.assign(clock.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        justifyContent: "center",
        fontFamily: "'Segoe UI', 'Segoe UI Variable', 'Segoe UI Symbol', system-ui, sans-serif",
        fontSize: "12px",
        lineHeight: "1.25",
        color: "#f0f0f0",
        minWidth: "78px",
        padding: "0 4px",
        cursor: "default"
    });
    right.appendChild(clock);
    _taskbar_clock_el = clock;

    bar.appendChild(right);

    document.body.appendChild(bar);
    _taskbar_el = bar;
}

function _service_taskbar_start_clock() {

    const tick = () => {
        if (!_taskbar_clock_el) return;
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const mo = String(now.getMonth() + 1).padStart(2, "0");
        const yy = now.getFullYear();
        _taskbar_clock_el.innerHTML =
            "<div>" + hh + ":" + mm + "</div>" +
            "<div>" + dd + "-" + mo + "-" + yy + "</div>";
    };

    tick();
    _taskbar_clock_timer = setInterval(tick, 15000);
}

/* ---- Start menu ---- */

function _service_taskbar_build_start_menu() {

    const menu = document.createElement("div");

    Object.assign(menu.style, {
        position: "fixed",
        left: "0",
        bottom: TASKBAR_HEIGHT + "px",
        width: "320px",
        height: "420px",
        zIndex: "1000001",
        background: "rgba(56, 60, 72, 0.65)",
        backdropFilter: "blur(22px) saturate(170%) brightness(115%)",
        webkitBackdropFilter: "blur(22px) saturate(170%) brightness(115%)",
        border: "1px solid rgba(255,255,255,0.16)",
        borderBottom: "none",
        boxShadow: "0 -4px 24px rgba(0,0,0,0.45)",
        display: "none",
        flexDirection: "column",
        color: "white",
        fontFamily: "sans-serif",
        fontSize: "13px"
    });

    /* Search row: input + arrow button (opens shell options menu). */
    const searchWrap = document.createElement("div");
    Object.assign(searchWrap.style, {
        padding: "10px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        gap: "6px",
        alignItems: "center"
    });

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search apps…";
    Object.assign(search.style, {
        flex: "1",
        boxSizing: "border-box",
        background: "#15171c",
        color: "white",
        border: "1px solid #333",
        borderRadius: "4px",
        padding: "6px 8px",
        fontSize: "13px",
        outline: "none"
    });
    search.addEventListener("input", () => {
        _service_taskbar_rebuild_start_list(search.value || "");
    });
    search.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            /* Launch the first visible match. */
            const first = _taskbar_start_list.querySelector("button[data-app-entry]");
            if (first) first.click();
        } else if (e.key === "Escape") {
            _service_taskbar_close_start_menu();
        }
    });
    searchWrap.appendChild(search);
    _taskbar_start_search = search;

    /* Arrow button — opens a ServiceMenu anchored at the last pointer
       position. Currently hosts the "Hide desktop shell" toggle. */
    const arrow = document.createElement("button");
    arrow.title = "More options";
    arrow.innerHTML =
        "<svg width='12' height='12' viewBox='0 0 12 12' " +
        "xmlns='http://www.w3.org/2000/svg' style='display:block'>" +
            "<polyline points='4,2 8,6 4,10' fill='none' stroke='currentColor' " +
            "stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/>" +
        "</svg>";
    Object.assign(arrow.style, {
        background: "rgba(255,255,255,0.06)",
        color: "#e6e6e6",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "4px",
        cursor: "pointer",
        padding: "5px 7px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: "0"
    });
    arrow.onmouseover = () => { arrow.style.background = "rgba(255,255,255,0.14)"; };
    arrow.onmouseout  = () => { arrow.style.background = "rgba(255,255,255,0.06)"; };
    arrow.onclick = (e) => {
        e.stopPropagation();
        _service_taskbar_open_options_menu();
    };
    searchWrap.appendChild(arrow);

    menu.appendChild(searchWrap);

    /* Scrollable apps list */
    const list = document.createElement("div");
    Object.assign(list.style, {
        flex: "1",
        overflowY: "auto",
        padding: "6px 0"
    });
    menu.appendChild(list);
    _taskbar_start_list = list;

    document.body.appendChild(menu);
    _taskbar_start_menu = menu;
}

function _service_taskbar_rebuild_start_list(filter) {

    if (!_taskbar_start_list) return;

    const f = (filter || "").toLowerCase().trim();
    _taskbar_start_list.innerHTML = "";

    const matches = _taskbar_apps.filter(a =>
        !f || a.label.toLowerCase().includes(f)
    );

    if (matches.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "No apps found";
        Object.assign(empty.style, {
            padding: "12px",
            color: "#888",
            fontStyle: "italic"
        });
        _taskbar_start_list.appendChild(empty);
        return;
    }

    matches.forEach(app => {
        const entry = document.createElement("button");
        entry.dataset.appEntry = "1";
        if (app.title) entry.title = app.title;

        Object.assign(entry.style, {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            width: "100%",
            textAlign: "left",
            background: "transparent",
            color: "white",
            border: "none",
            padding: "8px 14px",
            cursor: "pointer",
            fontSize: "13px",
            fontFamily: "inherit"
        });

        /* Icon slot — fixed 22px square so labels align across rows whether
           or not an icon was supplied. Falls back to the first character of
           the label, styled like a tile, so registrations that didn't pass
           an icon still get a consistent look. Emoji-friendly font stack
           and a slightly larger font size since the typical icon is an
           emoji glyph. */
        const iconEl = document.createElement("span");
        Object.assign(iconEl.style, {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "22px",
            height: "22px",
            flexShrink: "0",
            fontSize: "16px",
            lineHeight: "1",
            color: "#cfd2d8",
            fontFamily: "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', system-ui, sans-serif"
        });
        if (app.icon) {
            iconEl.innerHTML = app.icon;
        } else {
            iconEl.textContent = (app.label || "?").charAt(0);
            iconEl.style.background = "rgba(255,255,255,0.10)";
            iconEl.style.borderRadius = "4px";
            iconEl.style.fontSize = "13px";
            iconEl.style.fontWeight = "bold";
        }
        entry.appendChild(iconEl);

        /* Text stack — primary label on top; if a `title` was supplied AND
           it differs from the label, show it as a dim second line for
           context (similar to Windows/KDE start-menu app summaries). */
        const textWrap = document.createElement("span");
        Object.assign(textWrap.style, {
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
            flex: "1"
        });

        const primary = document.createElement("span");
        primary.textContent = app.label;
        Object.assign(primary.style, {
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
        });
        textWrap.appendChild(primary);

        if (app.title && app.title !== app.label) {
            const secondary = document.createElement("span");
            secondary.textContent = app.title;
            Object.assign(secondary.style, {
                fontSize: "11px",
                color: "#9aa0aa",
                marginTop: "1px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
            });
            textWrap.appendChild(secondary);
        }

        entry.appendChild(textWrap);

        entry.onmouseover = () => { entry.style.background = "rgba(255,255,255,0.08)"; };
        entry.onmouseout  = () => { entry.style.background = "transparent"; };
        entry.onclick = () => {
            _service_taskbar_close_start_menu();
            try { app.onlaunch(); }
            catch (err) { console.error("taskbar launch threw:", err); }
        };
        _taskbar_start_list.appendChild(entry);
    });
}

function _service_taskbar_toggle_start_menu() {
    if (!_taskbar_start_menu) return;
    if (_taskbar_start_menu.style.display === "none") {
        _taskbar_start_menu.style.display = "flex";
        /* Always paint above whatever window currently has focus.
           ServiceWindow._zCounter is bumped on every focus, unbounded — so a
           static z-index on the menu eventually loses. Sync past the live max
           every time we open. */
        if (typeof ServiceWindow !== "undefined" && ServiceWindow._zCounter) {
            _taskbar_start_menu.style.zIndex = String(ServiceWindow._zCounter + 10);
        }
        _taskbar_start_search.value = "";
        _service_taskbar_rebuild_start_list("");
        setTimeout(() => _taskbar_start_search.focus(), 0);
    } else {
        _service_taskbar_close_start_menu();
    }
}

function _service_taskbar_close_start_menu() {
    if (_taskbar_start_menu) _taskbar_start_menu.style.display = "none";
}

/* Alt+X toggles the start menu. Alt+W closes the active window (the most
   recently shown / mousedown'd ServiceWindow — see ServiceWindow._active).
   Ctrl+1..9 launches the Nth visible system-tray app (left to right) by
   simulating a click on its tray button — same path as a real user click,
   so tray-mode windows toggle and ServiceWindow tray-anchoring still works.
   Listener attached at capture phase on window so it fires regardless of
   which textarea / button currently has focus. preventDefault +
   stopPropagation prevent the page from also reacting to the chord. */
function _service_taskbar_install_hotkey() {

    window.addEventListener("keydown", (e) => {

        /* Ctrl+1..9 — click the Nth visible tray app. Bare Ctrl only (no
           Alt/Meta/Shift) so we don't collide with browser tab-switch
           shortcuts that include other modifiers. */
        if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
            const n = parseInt(e.key, 10);
            if (n >= 1 && n <= 9) {
                if (!_taskbar_tray_el) return;
                const buttons = Array.from(_taskbar_tray_el.children)
                    .filter(b => b.offsetParent !== null);
                const target = buttons[n - 1];
                if (target) {
                    e.preventDefault();
                    e.stopPropagation();
                    target.click();
                }
            }
            return;
        }

        if (!e.altKey) return;
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;

        const k = (e.key || "").toLowerCase();

        if (k === "x") {
            e.preventDefault();
            e.stopPropagation();
            _service_taskbar_toggle_start_menu();
            return;
        }

        if (k === "w") {
            const sw = (typeof ServiceWindow !== "undefined") && ServiceWindow.activeWindow();
            if (sw) {
                e.preventDefault();
                e.stopPropagation();
                /* Use the window's own close path — this routes through the
                   default close handler, hide(), and persistState(), so the
                   taskbar entry is removed and the system_restore session
                   is updated correctly. */
                sw.defaultClose();
            }
            return;
        }
    }, true);
}

/* ---- Open-windows tracking ---- */

function _service_taskbar_patch_service_window() {

    const origShow = ServiceWindow.prototype.show;
    const origHide = ServiceWindow.prototype.hide;
    const origMin  = ServiceWindow.prototype.defaultMinimize;
    const origMax  = ServiceWindow.prototype.defaultMaximize;

    ServiceWindow.prototype.show = function () {
        origShow.call(this);
        _service_taskbar_on_show(this);
    };

    ServiceWindow.prototype.hide = function () {
        origHide.call(this);
        _service_taskbar_on_hide(this);
    };

    ServiceWindow.prototype.defaultMinimize = function () {
        origMin.call(this);
        _service_taskbar_update_button(this);
    };

    ServiceWindow.prototype.defaultMaximize = function () {
        origMax.call(this);
        _service_taskbar_update_button(this);
    };
}

function _service_taskbar_find_entry(sw) {
    return _taskbar_windows.find(w => w.sw === sw) || null;
}

function _service_taskbar_on_show(sw) {

    if (!_taskbar_running_el) return;
    /* Tray-hosted windows are represented by their tray icon, not by a
       running-apps button — skip tracking. */
    if (sw && sw._trayHandle) return;
    if (_service_taskbar_find_entry(sw)) {
        _service_taskbar_update_button(sw);
        return;
    }

    /* Resolve a label and icon for the taskbar button. Both are looked up
       by appName from the tray/Start-menu registries — apps register their
       icon/title once and every running-apps button picks it up
       automatically. So an editor window with appName="editor" shows up as
       "Code Editor" with a 📝 glyph, not raw "editor". */
    const label = service_taskbar_get_app_label(sw.appName);
    const icon  = service_taskbar_get_app_icon(sw.appName);

    const btn = document.createElement("button");
    btn.title = label;

    /* Glassy resting state. The outer + inner shadows give the pill a
       slight inset, then the top highlight + bottom accent (set in
       _update_button) read as a translucent Windows/KDE taskbar tile. */
    const restBg   = "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%)";
    const hoverBg  = "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.08) 100%)";
    const activeBg = "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)";

    Object.assign(btn.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: restBg,
        color: "#f0f0f0",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: "5px",
        padding: "5px 12px",
        height: "30px",
        boxSizing: "border-box",
        cursor: "pointer",
        fontSize: "12px",
        fontFamily: "inherit",
        maxWidth: "210px",
        flexShrink: "0",
        boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.10)," +
            "0 1px 2px rgba(0,0,0,0.25)",
        transition: "background 120ms ease, transform 80ms ease, box-shadow 120ms ease"
    });

    btn._restBg   = restBg;
    btn._hoverBg  = hoverBg;
    btn._activeBg = activeBg;

    btn.onmouseover = () => { btn.style.background = hoverBg; };
    btn.onmouseout  = () => { btn.style.background = btn._currentBg || restBg; };
    btn.onmousedown = () => {
        btn.style.background = activeBg;
        btn.style.transform  = "translateY(1px)";
        btn.style.boxShadow  = "inset 0 1px 2px rgba(0,0,0,0.35)";
    };
    btn.onmouseup   = () => {
        btn.style.transform = "none";
        btn.style.boxShadow =
            "inset 0 1px 0 rgba(255,255,255,0.10)," +
            "0 1px 2px rgba(0,0,0,0.25)";
    };

    /* Icon slot — fixed 16px so labels line up across rows. Emoji-friendly
       font stack so emoji glyphs render at full size; SVG strings render
       via innerHTML. Tile fallback (first letter) keeps alignment when no
       icon was supplied. */
    const iconEl = document.createElement("span");
    Object.assign(iconEl.style, {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        flexShrink: "0",
        fontSize: "14px",
        lineHeight: "1",
        color: "#e6e8ee",
        fontFamily: "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', system-ui, sans-serif"
    });
    if (icon) {
        iconEl.innerHTML = icon;
    } else {
        iconEl.textContent = (label || "?").charAt(0).toUpperCase();
        iconEl.style.background = "rgba(255,255,255,0.16)";
        iconEl.style.borderRadius = "3px";
        iconEl.style.fontSize = "10px";
        iconEl.style.fontWeight = "bold";
    }
    btn.appendChild(iconEl);

    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    Object.assign(labelEl.style, {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: "0",
        fontWeight: "500",
        letterSpacing: "0.1px"
    });
    btn.appendChild(labelEl);

    btn.onclick = () => {
        if (!sw.visible) {
            sw.show();
            return;
        }
        if (sw.mode === "minimized") {
            service_taskbar_restore_window(sw);
        } else {
            service_taskbar_minimize_window(sw);
        }
    };

    _taskbar_running_el.appendChild(btn);
    _taskbar_windows.push({ sw, btn });
    _service_taskbar_update_button(sw);
}

function _service_taskbar_on_hide(sw) {

    const entry = _service_taskbar_find_entry(sw);
    if (!entry) return;

    if (entry.btn.parentElement) entry.btn.parentElement.removeChild(entry.btn);
    const idx = _taskbar_windows.indexOf(entry);
    if (idx >= 0) _taskbar_windows.splice(idx, 1);
}

function _service_taskbar_update_button(sw) {

    const entry = _service_taskbar_find_entry(sw);
    if (!entry) return;

    const btn = entry.btn;
    const restBg  = btn._restBg  || "rgba(255,255,255,0.08)";
    const hoverBg = btn._hoverBg || "rgba(255,255,255,0.18)";

    if (sw.mode === "minimized") {
        /* Dim + no accent — clearly "parked". */
        btn._currentBg = restBg;
        btn.style.background = restBg;
        btn.style.color = "#9aa0aa";
        btn.style.opacity = "0.75";
        btn.style.borderBottom = "1px solid rgba(255,255,255,0.14)";
        btn.style.boxShadow =
            "inset 0 1px 0 rgba(255,255,255,0.08)," +
            "0 1px 2px rgba(0,0,0,0.20)";
    } else {
        /* Active: brighter fill + crisp 2px cyan accent at the bottom edge.
           Cache the brighter fill as the "current" background so onmouseout
           reverts to it (not the dim resting state). */
        btn._currentBg = hoverBg;
        btn.style.background = hoverBg;
        btn.style.color = "white";
        btn.style.opacity = "1";
        btn.style.borderBottom = "2px solid #4fc3f7";
        btn.style.boxShadow =
            "inset 0 1px 0 rgba(255,255,255,0.18)," +
            "0 2px 6px rgba(0,0,0,0.30)," +
            "0 0 0 1px rgba(79,195,247,0.18)";
    }
}

/* ---- System tray icons ----
   Components register a tray icon via service_taskbar_register_tray_icon.
   Returns a handle so the caller can remove the icon when its window
   closes. The button's onClick receives the button DOM node so the caller
   can compute the popup anchor (e.g. ServiceWindow tray-mode positions
   itself just above this button). */

function service_taskbar_register_tray_icon(opts) {

    service_taskbar_init();
    if (!_taskbar_tray_el) return null;

    const btn = document.createElement("button");
    /* Accept either inline HTML (e.g. an SVG) or a plain text/emoji glyph
       — innerHTML handles both. Falls back to "?" when no icon is given. */
    btn.innerHTML = opts.icon || "?";
    if (opts.title) btn.title = opts.title;

    Object.assign(btn.style, {
        background: "transparent",
        color: "#e6e6e6",
        border: "1px solid transparent",
        borderRadius: "3px",
        cursor: "pointer",
        padding: "2px 7px",
        /* 15px so emoji icons (the typical case) read clearly. Plain
           text glyphs at this size still look correct on a 26px button. */
        fontSize: "15px",
        fontWeight: "normal",
        fontFamily: "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', system-ui, sans-serif",
        lineHeight: "1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "22px",
        height: "26px"
    });

    btn.onmouseover = () => { btn.style.background = "rgba(255,255,255,0.10)"; };
    btn.onmouseout  = () => { btn.style.background = "transparent"; };
    btn.onclick = (e) => {
        e.stopPropagation();
        if (opts.onClick) opts.onClick(btn);
    };

    _taskbar_tray_el.appendChild(btn);

    return {
        button: btn,
        remove() {
            if (btn.parentElement) btn.parentElement.removeChild(btn);
        }
    };
}

/* ---- Tray app registry ----
   Higher-level than service_taskbar_register_tray_icon. Apps register once;
   the registry manages whether the icon is currently in the tray (controlled
   by the user via the up-arrow overflow popup) and persists that preference
   across reloads.

   Each registration:
     opts.appName     — REQUIRED. Stable id used as the persistence key.
     opts.label       — Human-readable name shown in the overflow popup.
     opts.icon        — Tray glyph (e.g. "C").
     opts.title       — Tooltip on the tray button.
     opts.onClick     — (btn) => void. Called when the tray icon is clicked.
                        Receives the button DOM node (caller uses it for
                        ServiceWindow tray-mode anchoring). When the user
                        re-shows a hidden app, a new button is created and
                        passed to a fresh onClick — apps that need this can
                        re-adopt via ServiceWindow._adoptTrayButton.
     opts.onAdopt     — Optional. (btn) => void called every time a fresh
                        button is created (initial registration AND each
                        unhide). Use this to rewire the click handler on
                        the new DOM node. */

const TRAY_HIDDEN_KEY = "tm_tray_hidden_apps";

let _tray_apps = [];   // [{ appName, label, icon, title, onClick, onAdopt, handle }]

function _service_taskbar_load_hidden() {
    try {
        const raw = localStorage.getItem(TRAY_HIDDEN_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function _service_taskbar_save_hidden(arr) {
    try { localStorage.setItem(TRAY_HIDDEN_KEY, JSON.stringify(arr)); }
    catch (e) {}
}

function _service_taskbar_is_app_hidden(appName) {
    return _service_taskbar_load_hidden().indexOf(appName) >= 0;
}

function _service_taskbar_set_app_hidden(appName, hidden) {
    let arr = _service_taskbar_load_hidden();
    const idx = arr.indexOf(appName);
    if (hidden && idx < 0) arr.push(appName);
    if (!hidden && idx >= 0) arr.splice(idx, 1);
    _service_taskbar_save_hidden(arr);
}

function service_taskbar_register_tray_app(opts) {

    service_taskbar_init();

    const app = {
        appName: opts.appName,
        label:   opts.label || opts.appName,
        icon:    opts.icon  || (opts.appName || "?").charAt(0).toUpperCase(),
        title:   opts.title || opts.label || opts.appName,
        onClick: opts.onClick,
        onAdopt: opts.onAdopt,
        handle:  null
    };
    _tray_apps.push(app);

    if (!_service_taskbar_is_app_hidden(app.appName)) {
        _service_taskbar_show_app(app);
    }

    return {
        /* Programmatic show/hide — same path as the user's overflow toggle. */
        setVisible(on) {
            _service_taskbar_set_app_visibility(app.appName, on);
        }
    };
}

function _service_taskbar_show_app(app) {
    if (app.handle) return;   // already shown
    app.handle = service_taskbar_register_tray_icon({
        icon:  app.icon,
        title: app.title,
        onClick: (btn) => {
            if (app.onClick) app.onClick(btn);
        }
    });
    if (app.handle && app.onAdopt) {
        try { app.onAdopt(app.handle.button); } catch (e) { console.error(e); }
    }
}

function _service_taskbar_hide_app(app) {
    if (!app.handle) return;
    app.handle.remove();
    app.handle = null;
}

function _service_taskbar_set_app_visibility(appName, on) {
    const app = _tray_apps.find(a => a.appName === appName);
    if (!app) return;
    _service_taskbar_set_app_hidden(appName, !on);
    if (on) _service_taskbar_show_app(app);
    else    _service_taskbar_hide_app(app);
}

/* Look up the live tray button for an app, if currently visible.
   Returns null if the app isn't registered or is hidden. Used by
   component_*_create paths that want to wire the ServiceWindow against
   whatever button currently exists. */
function service_taskbar_get_tray_button(appName) {
    const app = _tray_apps.find(a => a.appName === appName);
    if (!app || !app.handle) return null;
    return app.handle.button;
}

/* Read-only snapshot of the registered tray apps. Used by
   framework_orphan_cleanup to detect stale entries in the
   tm_tray_hidden_apps list. Returns shallow clones — callers must not
   mutate live registry state. */
function service_taskbar_list_tray_apps() {
    return _tray_apps.map(a => ({
        appName: a.appName,
        label:   a.label,
        icon:    a.icon
    }));
}

/* ---- Tray overflow popup ----
   Opened by clicking the up-arrow in the right-side cluster. Lists every
   registered tray app with: name, a Launch button, and a Show-in-tray
   toggle. A search box at the top filters the list by label. The popup
   styling mirrors ServiceMenu (glass panel) so it feels consistent. */

let _tray_overflow_popup = null;

function _service_taskbar_close_tray_overflow() {
    if (_tray_overflow_popup) {
        if (_tray_overflow_popup._cleanup) _tray_overflow_popup._cleanup();
        if (_tray_overflow_popup.parentNode) {
            _tray_overflow_popup.parentNode.removeChild(_tray_overflow_popup);
        }
        _tray_overflow_popup = null;
    }
}

function _service_taskbar_open_tray_overflow(anchorBtn) {

    _service_taskbar_close_tray_overflow();

    const popup = document.createElement("div");
    Object.assign(popup.style, {
        position: "fixed",
        width: "300px",
        maxHeight: "360px",
        zIndex: "1000010",
        background: "rgba(28, 30, 36, 0.78)",
        backdropFilter: "blur(22px) saturate(160%)",
        webkitBackdropFilter: "blur(22px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "6px",
        boxShadow: "0 8px 28px rgba(0,0,0,0.55)",
        color: "white",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        fontSize: "13px",
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden"
    });

    /* Search box */
    const searchWrap = document.createElement("div");
    Object.assign(searchWrap.style, {
        padding: "8px",
        borderBottom: "1px solid rgba(255,255,255,0.08)"
    });
    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search tray apps…";
    Object.assign(search.style, {
        width: "100%",
        boxSizing: "border-box",
        background: "#15171c",
        color: "white",
        border: "1px solid #333",
        borderRadius: "4px",
        padding: "6px 8px",
        fontSize: "13px",
        fontFamily: "inherit",
        outline: "none"
    });
    searchWrap.appendChild(search);
    popup.appendChild(searchWrap);

    /* Scrollable list */
    const list = document.createElement("div");
    Object.assign(list.style, {
        flex: "1",
        overflowY: "auto",
        padding: "4px 0"
    });
    popup.appendChild(list);

    const rebuild = () => {
        const f = (search.value || "").toLowerCase().trim();
        list.innerHTML = "";

        const matches = _tray_apps.filter(a =>
            !f || (a.label || "").toLowerCase().includes(f)
        );

        if (matches.length === 0) {
            const empty = document.createElement("div");
            empty.textContent = _tray_apps.length === 0
                ? "No tray apps registered"
                : "No matches";
            Object.assign(empty.style, {
                padding: "12px 14px",
                color: "#888",
                fontStyle: "italic"
            });
            list.appendChild(empty);
            return;
        }

        for (const app of matches) {
            const row = document.createElement("div");
            Object.assign(row.style, {
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 10px"
            });

            const labelEl = document.createElement("span");
            labelEl.textContent = app.label;
            Object.assign(labelEl.style, {
                flex: "1",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
            });
            row.appendChild(labelEl);

            const launchBtn = document.createElement("button");
            launchBtn.textContent = "Launch";
            Object.assign(launchBtn.style, {
                background: "#4fc3f7",
                color: "#000",
                border: "none",
                borderRadius: "3px",
                padding: "3px 10px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: "bold",
                fontFamily: "inherit",
                flexShrink: "0"
            });
            launchBtn.onclick = () => {
                /* If hidden, temporarily ensure the icon exists so onClick
                   has a button to anchor against. We don't permanently
                   re-show it — the toggle controls that. Instead we pass
                   the up-arrow as the anchor when hidden. */
                if (app.handle && app.handle.button) {
                    app.onClick(app.handle.button);
                } else {
                    app.onClick(anchorBtn);
                }
                _service_taskbar_close_tray_overflow();
            };
            row.appendChild(launchBtn);

            /* Show-in-tray toggle */
            const visible = !_service_taskbar_is_app_hidden(app.appName);
            const sw = _service_menu_make_switch(visible);
            sw.el.style.cursor = "pointer";
            sw.el.title = "Show in tray";
            sw.el.addEventListener("click", () => {
                const next = _service_taskbar_is_app_hidden(app.appName);  // toggle: hidden -> visible
                _service_taskbar_set_app_visibility(app.appName, next);
                sw.set(next);
            });
            row.appendChild(sw.el);

            list.appendChild(row);
        }
    };

    search.addEventListener("input", rebuild);
    search.addEventListener("keydown", (e) => {
        if (e.key === "Escape") _service_taskbar_close_tray_overflow();
    });

    rebuild();

    document.body.appendChild(popup);
    _tray_overflow_popup = popup;

    /* Anchor: above the up-arrow, right-aligned to its right edge. */
    requestAnimationFrame(() => {
        const r = anchorBtn.getBoundingClientRect();
        const pr = popup.getBoundingClientRect();
        let left = Math.round(r.right - pr.width);
        let top  = Math.round(r.top - pr.height - 8);
        left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
        top  = Math.max(8, top);
        popup.style.left = left + "px";
        popup.style.top  = top  + "px";
        setTimeout(() => search.focus(), 0);
    });

    /* Outside click / Escape close */
    const onDown = (e) => {
        if (popup.contains(e.target)) return;
        if (anchorBtn.contains(e.target)) return;
        _service_taskbar_close_tray_overflow();
    };
    const onKey = (e) => {
        if (e.key === "Escape") _service_taskbar_close_tray_overflow();
    };
    setTimeout(() => {
        document.addEventListener("mousedown", onDown, true);
        document.addEventListener("keydown",   onKey,  true);
    }, 0);
    popup._cleanup = () => {
        document.removeEventListener("mousedown", onDown, true);
        document.removeEventListener("keydown",   onKey,  true);
    };
}

function service_taskbar_minimize_window(sw) {
    if (!sw) return;
    if (sw.mode !== "minimized") sw.defaultMinimize();
}

function service_taskbar_restore_window(sw) {
    if (!sw) return;
    if (!sw.visible) sw.show();
    if (sw.mode === "minimized") sw.defaultMinimize();   // toggles back to normal
}

/* ---- Shell visibility ----
   "Hide" the kdeubuntu shell means: take down the wallpaper and taskbar (and
   close any open start menu / options menu), then drop a small floating
   restore button at the bottom-right corner — same general anchor the simple
   stacked launcher buttons used to live in. Clicking it brings the shell
   back. State is kept in localStorage so the user's choice survives a reload. */

const TASKBAR_HIDDEN_KEY = "tm_taskbar_shell_hidden";

let _taskbar_restore_btn  = null;
let _taskbar_options_menu = null;

function _service_taskbar_open_options_menu() {

    /* Anchor the popup at the last pointer position so it appears under the
       user's mouse / touch (the requested behaviour). The menu also clamps
       itself to the viewport, so anchoring at the arrow when the user
       arrived via Alt+X (no recent click on the arrow) still works. */
    const p = service_menu_last_pointer();

    if (_taskbar_options_menu) _taskbar_options_menu.close();
    _taskbar_options_menu = new ServiceMenu();

    _taskbar_options_menu
        .addToggle({
            label: "Hide desktop shell",
            getter: () => _service_taskbar_is_hidden(),
            setter: (on) => {
                if (on) _service_taskbar_hide_shell();
                else    _service_taskbar_show_shell();
            }
        })
        .openAt(p.x, p.y);
}

function _service_taskbar_is_hidden() {
    try { return localStorage.getItem(TASKBAR_HIDDEN_KEY) === "true"; }
    catch (e) { return false; }
}

function _service_taskbar_set_hidden(flag) {
    try { localStorage.setItem(TASKBAR_HIDDEN_KEY, flag ? "true" : "false"); }
    catch (e) {}
}

function _service_taskbar_hide_shell() {

    _service_taskbar_close_start_menu();

    if (_taskbar_wallpaper_el) _taskbar_wallpaper_el.style.display = "none";
    if (_taskbar_el)           _taskbar_el.style.display           = "none";

    _service_taskbar_set_hidden(true);
    _service_taskbar_show_restore_btn();
}

function _service_taskbar_show_shell() {

    if (_taskbar_wallpaper_el) _taskbar_wallpaper_el.style.display = "block";
    if (_taskbar_el)           _taskbar_el.style.display           = "flex";

    _service_taskbar_set_hidden(false);
    _service_taskbar_hide_restore_btn();
}

/* Floating restore button, bottom-right. Mirrors the simple-launcher anchor
   on the opposite corner so it doesn't visually clash with whatever the
   user is doing. */
function _service_taskbar_show_restore_btn() {

    if (_taskbar_restore_btn) {
        _taskbar_restore_btn.style.display = "flex";
        return;
    }

    const btn = document.createElement("button");
    btn.title = "Show desktop shell";
    btn.innerHTML =
        "<svg width='16' height='16' viewBox='0 0 24 24' " +
        "xmlns='http://www.w3.org/2000/svg'>" +
            "<rect x='2'  y='2'  width='9' height='9' fill='#ffffff'/>" +
            "<rect x='13' y='2'  width='9' height='9' fill='#f0f0f0'/>" +
            "<rect x='2'  y='13' width='9' height='9' fill='#d8d8d8'/>" +
            "<rect x='13' y='13' width='9' height='9' fill='#b8b8b8'/>" +
        "</svg>";
    Object.assign(btn.style, {
        position: "fixed",
        right: "12px",
        bottom: "12px",
        zIndex: "1000005",
        width: "32px",
        height: "32px",
        background: "#1976d2",
        color: "white",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: "6px",
        cursor: "pointer",
        boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    });
    btn.onmouseover = () => { btn.style.background = "#2196f3"; };
    btn.onmouseout  = () => { btn.style.background = "#1976d2"; };
    btn.onclick = () => {
        _service_taskbar_show_shell();
    };

    document.body.appendChild(btn);
    _taskbar_restore_btn = btn;
}

function _service_taskbar_hide_restore_btn() {
    if (_taskbar_restore_btn) _taskbar_restore_btn.style.display = "none";
}
