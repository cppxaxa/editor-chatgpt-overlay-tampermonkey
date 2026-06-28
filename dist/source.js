// ===== src/header.js =====
// ==UserScript==
// @name         ChatGPT Floating Scratchpad
// @namespace    https://github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey
// @version      0.1.0
// @description  Floating code editor overlay for chatgpt.com with prompt automation, code review, and tabbed generated views.
// @author       cppxaxa
// @match        https://chatgpt.com/*
// @match        https://build.nvidia.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

var shell = {};

(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // ChatGPT Floating Scratchpad — entry point
    //
    // This file is the FIRST chunk concatenated by build.go. It opens the IIFE
    // and declares 'use strict'. All component_* and framework_* functions
    // declared in subsequent files share this scope. The IIFE is closed in
    // src/footer.js.
    // -------------------------------------------------------------------------

// ===== src/framework.js =====
// -----------------------------------------------------------------------------
// framework.js — framework-level shared state and lifecycle bootstrap.
//
// Component-owned state has been moved into the owning component_*.js files.
// LLM cancellation state lives inside service_llm.js (see cancelCurrentLlmJob).
// -----------------------------------------------------------------------------

/* ---- Bootstrap ---- */

function framework_register_launcher() {

    framework_launcher_register("Code Editor", component_window_launch, {
        appName: "editor",
        icon:    "📝",
        title:   "Code Editor"
    });
    framework_launcher_register("Calculator", component_calc_launch, {
        appName: "calc",
        icon:    "🧮",
        title:   "Calculator"
    });
    framework_launcher_register("Local Storage", component_localstorage_launch, {
        appName: "localstorage",
        icon:    "🗂️",
        title:   "Local Storage"
    });
    framework_launcher_register("Browser", component_browser_launch, {
        appName: "browser",
        icon:    "🌐",
        title:   "Browser"
    });
    framework_launcher_register("Session Console", component_session_console_launch, {
        appName: "session_console",
        icon:    "💻",
        title:   "Session Console"
    });

    framework_on_launcher_registered();
}

/* ---- Lifecycle hooks ----
   Each hook is a literal list of components that react to a framework-level
   moment. Components must NOT reach into framework state directly; instead
   they expose a component_<name>_handle_*() function and the hook calls it.
   To add a reactor, append one line to the relevant hook below. */

function framework_on_launcher_registered() {
    component_window_handle_launcher_registered();
}

function framework_on_window_resized() {
    component_window_handle_window_resized();
}

function framework_on_init() {
    framework_scrollbars_inject();

    service_hotkeys_handle_init();

    component_waitingui_handle_init();
    component_linecommand_handle_init();
    component_window_handle_init();
    component_calc_handle_init();
    component_console_handle_init();
    component_chat_handle_init();
    component_clock_handle_init();
    component_localstorage_handle_init();
    component_browser_handle_init();
    component_session_console_handle_init();
    service_toast_handle_init();
}

function framework_init() {
    framework_register_launcher();

    window.addEventListener("resize", framework_on_window_resized);

    framework_on_init();

    /* Expose window.shell as a live Proxy view of the registries. Done after
       framework_on_init so all built-in apps are registered, but the Proxy
       itself doesn't snapshot — late dynamic-install registrations are
       picked up automatically. */
    framework_shell_init();

    /* Sweep stale per-app localStorage entries now that every component
       has registered. Runs once per page load. */
    framework_orphan_cleanup();

    handle_kiosk();
    handle_system_restore();

    window.__tm_loaded = true;
}

// ===== src/component_browser.js =====
// -----------------------------------------------------------------------------
// component_browser.js — tabbed web browser inside a ServiceWindow.
//
// Each browser tab is an <iframe> element. The user interacts directly with
// pages inside the iframe. One iframe per tab — iframes are never shared or
// reused across tabs. Hiding the browser window (✕) does NOT destroy iframes;
// only explicit closeTab removes an iframe from the DOM. This allows the
// shell API and session console to eval() into any tab's iframe at any time,
// regardless of which tab is visually active or whether the browser is shown.
//
// Cross-origin pages load fine but JS eval will throw a SecurityError —
// surfaced as a graceful error message.
//
// Shell API: shell.browser.*
//   .newTab(url?, name?)          — create a tab, returns tabId
//   .closeTab(tabId)              — close a tab (removes iframe from DOM)
//   .listTabs()                   — [{id, name, url}]
//   .getActiveTabId()             — currently visible tab id
//   .setActiveTab(tabId)          — switch visible tab
//   .getTab(tabId)                — tab object with .eval(), .navigate(), etc.
//   .onTabClosed(callback)        — register listener for tab-close events
//
// Registered as a launcher app ("browser").
// -----------------------------------------------------------------------------

let browserServiceWindow = null;
let browserContainer     = null;

/* Tab state — one iframe per tab, all live in the viewport simultaneously */
let _browser_tabs       = [];   // [{id, name, url, iframe}]
let _browser_next_id    = 1;
let _browser_active_tab = null; // id of the active tab

/* Event listeners */
const _browser_tab_closed_listeners = [];

/* DOM refs */
let _browser_tab_bar    = null;
let _browser_url_input  = null;
let _browser_viewport   = null;
let _browser_status_el  = null;

function component_browser_launch() {
    if (!browserContainer) component_browser_create();
    browserServiceWindow.show();
}

function component_browser_create() {

    browserServiceWindow = new ServiceWindow();
    browserServiceWindow.create({
        appName: "browser",
        width:   900,
        height:  600,
        isDraggable: () => true,
        isResizable: () => true
    });

    browserServiceWindow.registerTab({ id: "browser", label: "Browser" });
    browserServiceWindow.appendControls();

    browserContainer = browserServiceWindow.container;

    /* Body — flex column, no padding */
    const body = browserServiceWindow.createBody({
        padding: "0",
        gap:     "0",
        style: {
            background: "#1e1e2e",
            color:      "#cdd6f4",
            fontFamily: "'Segoe UI', Tahoma, sans-serif",
            fontSize:   "12px"
        }
    });

    /* ---- Toolbar ---- */
    const toolbar = document.createElement("div");
    Object.assign(toolbar.style, {
        display:    "flex",
        alignItems: "center",
        gap:        "4px",
        padding:    "4px 8px",
        background: "#181825",
        borderBottom: "1px solid #313244",
        flexShrink: "0"
    });

    const makeBtn = (text, title, onclick) => {
        const b = document.createElement("button");
        b.textContent = text;
        b.title = title;
        Object.assign(b.style, {
            background: "#313244",
            color:      "#cdd6f4",
            border:     "1px solid #45475a",
            borderRadius: "4px",
            padding:    "2px 8px",
            cursor:     "pointer",
            fontSize:   "13px",
            lineHeight: "1.4"
        });
        b.onclick = onclick;
        return b;
    };

    const backBtn    = makeBtn("\u25C0", "Back",    () => _browser_go_back());
    const fwdBtn     = makeBtn("\u25B6", "Forward", () => _browser_go_forward());
    const refreshBtn = makeBtn("\u21BB", "Refresh", () => _browser_refresh());

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.placeholder = "Enter URL...";
    Object.assign(urlInput.style, {
        flex:         "1",
        background:   "#313244",
        color:        "#cdd6f4",
        border:       "1px solid #45475a",
        borderRadius: "4px",
        padding:      "4px 8px",
        fontSize:     "12px",
        outline:      "none",
        fontFamily:   "inherit"
    });
    urlInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            _browser_navigate_active(urlInput.value.trim());
        }
    });
    _browser_url_input = urlInput;

    const goBtn = makeBtn("Go", "Navigate", () => {
        _browser_navigate_active(urlInput.value.trim());
    });

    toolbar.appendChild(backBtn);
    toolbar.appendChild(fwdBtn);
    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(urlInput);
    toolbar.appendChild(goBtn);

    /* ---- Tab bar ---- */
    const tabBar = document.createElement("div");
    Object.assign(tabBar.style, {
        display:      "flex",
        alignItems:   "center",
        gap:          "0",
        padding:      "0 4px",
        background:   "#11111b",
        borderBottom: "1px solid #313244",
        flexShrink:   "0",
        overflowX:    "auto",
        minHeight:    "28px"
    });
    _browser_tab_bar = tabBar;

    /* "+" button */
    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.title = "New tab";
    Object.assign(addBtn.style, {
        background:   "transparent",
        color:        "#89b4fa",
        border:       "none",
        fontSize:     "16px",
        cursor:       "pointer",
        padding:      "2px 8px",
        lineHeight:   "1",
        flexShrink:   "0"
    });
    addBtn.onclick = () => _browser_new_tab();
    tabBar.appendChild(addBtn);

    /* ---- Viewport (holds all iframes) ---- */
    const viewport = document.createElement("div");
    Object.assign(viewport.style, {
        flex:       "1",
        position:   "relative",
        overflow:   "hidden",
        background: "#1e1e2e"
    });
    _browser_viewport = viewport;

    /* Status overlay */
    const statusEl = document.createElement("div");
    Object.assign(statusEl.style, {
        position:      "absolute",
        top: "50%", left: "50%",
        transform:     "translate(-50%, -50%)",
        color:         "#6c7086",
        fontSize:      "14px",
        textAlign:     "center",
        pointerEvents: "none",
        zIndex:        "1"
    });
    _browser_status_el = statusEl;
    viewport.appendChild(statusEl);

    body.appendChild(toolbar);
    body.appendChild(tabBar);
    body.appendChild(viewport);

    _browser_show_status("No tabs open. Click + to create one.");

    /* Restore geometry, then restore tabs */
    if (!browserServiceWindow.restoreState()) {
        service_window_center(browserContainer, 900, 600);
    }
    _browser_restore_state();
}

/* ---- Status overlay ---- */

function _browser_show_status(text) {
    if (_browser_status_el) {
        _browser_status_el.textContent = text;
        _browser_status_el.style.display = "block";
    }
}

function _browser_hide_status() {
    if (_browser_status_el) {
        _browser_status_el.style.display = "none";
    }
}

/* ---- Tab management ---- */

function _browser_new_tab(url, name) {
    if (!browserContainer) component_browser_create();

    _browser_hide_status();

    const id = _browser_next_id++;
    const tabName = name || ("Tab " + id);
    const initialUrl = url || "about:blank";

    /* Create a dedicated iframe for this tab */
    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, {
        width:    "100%",
        height:   "100%",
        border:   "none",
        position: "absolute",
        top:      "0",
        left:     "0",
        display:  "none"
    });
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    iframe.src = initialUrl;
    _browser_viewport.appendChild(iframe);

    const tab = {
        id:     id,
        name:   tabName,
        url:    initialUrl,
        iframe: iframe
    };

    /* Track navigation via load event */
    iframe.addEventListener("load", () => {
        try {
            tab.url = iframe.contentWindow.location.href;
        } catch (_) {
            /* Cross-origin — keep last known URL */
        }
        if (tab.id === _browser_active_tab && _browser_url_input) {
            _browser_url_input.value = (tab.url === "about:blank") ? "" : (tab.url || "");
        }
        _browser_render_tab_bar();
        _browser_persist_state();

        /* Hook SPA navigations (pushState/replaceState/hashchange/popstate)
           inside same-origin iframes so the URL bar stays in sync. */
        try {
            const cw = iframe.contentWindow;
            if (!cw) return;

            const syncUrl = () => {
                try {
                    const href = cw.location.href;
                    if (href && href !== tab.url) {
                        tab.url = href;
                        if (tab.id === _browser_active_tab && _browser_url_input) {
                            _browser_url_input.value = (href === "about:blank") ? "" : href;
                        }
                        _browser_persist_state();
                    }
                } catch (_) { /* cross-origin */ }
            };

            cw.addEventListener("popstate",   syncUrl);
            cw.addEventListener("hashchange", syncUrl);

            /* Monkey-patch pushState/replaceState to catch SPA navigations */
            const origPush    = cw.history.pushState;
            const origReplace = cw.history.replaceState;
            cw.history.pushState = function() {
                origPush.apply(this, arguments);
                syncUrl();
            };
            cw.history.replaceState = function() {
                origReplace.apply(this, arguments);
                syncUrl();
            };
            /* Forward modifier hotkeys (Alt+, Ctrl+) from the iframe to the
               parent document so service_hotkeys dispatches them normally. */
            cw.addEventListener("keydown", function(e) {
                if (!e.altKey && !e.ctrlKey) return;
                /* Don't forward Ctrl+C/V/X/A — let the iframe handle clipboard */
                if (e.ctrlKey && !e.altKey && /^[cvxa]$/i.test(e.key)) return;
                document.dispatchEvent(new KeyboardEvent("keydown", {
                    key: e.key, code: e.code,
                    altKey: e.altKey, ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey, metaKey: e.metaKey,
                    bubbles: true
                }));
            }, true);
        } catch (_) { /* cross-origin — load event alone is sufficient */ }
    });

    _browser_tabs.push(tab);
    _browser_render_tab_bar();
    _browser_set_active(id);
    _browser_persist_state();

    return id;
}

function _browser_close_tab(tabId) {
    const idx = _browser_tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;

    const tab = _browser_tabs[idx];

    /* Remove the iframe from the DOM */
    if (tab.iframe && tab.iframe.parentNode) {
        tab.iframe.parentNode.removeChild(tab.iframe);
    }

    _browser_tabs.splice(idx, 1);

    /* Notify listeners */
    _browser_tab_closed_listeners.forEach(cb => {
        try { cb(tabId); } catch (e) { console.error("browser onTabClosed:", e); }
    });

    /* If we closed the active tab, switch to neighbor */
    if (_browser_active_tab === tabId) {
        if (_browser_tabs.length > 0) {
            const newIdx = Math.min(idx, _browser_tabs.length - 1);
            _browser_set_active(_browser_tabs[newIdx].id);
        } else {
            _browser_active_tab = null;
            if (_browser_url_input) _browser_url_input.value = "";
            _browser_show_status("No tabs open. Click + to create one.");
        }
    }

    _browser_render_tab_bar();
    _browser_persist_state();
}

function _browser_set_active(tabId) {
    _browser_active_tab = tabId;

    /* Show only the active tab's iframe; hide all others */
    _browser_tabs.forEach(t => {
        if (t.iframe) {
            t.iframe.style.display = (t.id === tabId) ? "block" : "none";
        }
    });

    const tab = _browser_tabs.find(t => t.id === tabId);
    if (tab) {
        if (_browser_url_input) {
            _browser_url_input.value = (tab.url === "about:blank") ? "" : (tab.url || "");
        }
        _browser_hide_status();
    }

    _browser_render_tab_bar();
    _browser_persist_state();
}

function _browser_get_tab(tabId) {
    return _browser_tabs.find(t => t.id === tabId) || null;
}

/* ---- Navigation ---- */

function _browser_navigate_active(rawUrl) {
    if (!_browser_active_tab) return;
    const tab = _browser_get_tab(_browser_active_tab);
    if (!tab) return;
    _browser_navigate_tab(tab, rawUrl);
}

function _browser_navigate_tab(tab, rawUrl) {
    if (!rawUrl || !tab.iframe) return;

    /* Auto-prepend https:// if missing */
    let url = rawUrl;
    if (!/^https?:\/\//i.test(url) && !url.startsWith("about:")) {
        url = "https://" + url;
    }

    tab.url = url;
    tab.iframe.src = url;

    if (tab.id === _browser_active_tab && _browser_url_input) {
        _browser_url_input.value = url;
    }
    _browser_persist_state();
}

function _browser_go_back() {
    if (!_browser_active_tab) return;
    const tab = _browser_get_tab(_browser_active_tab);
    if (!tab || !tab.iframe) return;

    try {
        tab.iframe.contentWindow.history.back();
    } catch (e) {
        console.warn("browser back: cross-origin or unavailable:", e.message);
    }
}

function _browser_go_forward() {
    if (!_browser_active_tab) return;
    const tab = _browser_get_tab(_browser_active_tab);
    if (!tab || !tab.iframe) return;

    try {
        tab.iframe.contentWindow.history.forward();
    } catch (e) {
        console.warn("browser forward: cross-origin or unavailable:", e.message);
    }
}

function _browser_refresh() {
    if (!_browser_active_tab) return;
    const tab = _browser_get_tab(_browser_active_tab);
    if (!tab || !tab.iframe) return;

    try {
        tab.iframe.contentWindow.location.reload();
    } catch (_) {
        /* Cross-origin fallback — re-set src */
        tab.iframe.src = tab.url;
    }
}

/* ---- Tab bar rendering ---- */

function _browser_render_tab_bar() {
    if (!_browser_tab_bar) return;

    /* Keep the "+" button (last child), remove everything else */
    const addBtn = _browser_tab_bar.lastElementChild;
    while (_browser_tab_bar.firstChild !== addBtn) {
        _browser_tab_bar.removeChild(_browser_tab_bar.firstChild);
    }

    _browser_tabs.forEach(tab => {
        const el = document.createElement("div");
        Object.assign(el.style, {
            display:      "flex",
            alignItems:   "center",
            gap:          "4px",
            padding:      "4px 8px",
            cursor:       "pointer",
            whiteSpace:   "nowrap",
            fontSize:     "11px",
            borderRight:  "1px solid #313244",
            background:   tab.id === _browser_active_tab ? "#313244" : "transparent",
            color:        tab.id === _browser_active_tab ? "#89b4fa" : "#6c7086",
            maxWidth:     "160px"
        });

        const label = document.createElement("span");
        /* Show URL hostname as label if available */
        var displayName = tab.name;
        try {
            if (tab.url && tab.url !== "about:blank") {
                var u = new URL(tab.url);
                displayName = u.hostname || tab.name;
            }
        } catch (_) {}
        label.textContent = displayName;
        Object.assign(label.style, {
            overflow:     "hidden",
            textOverflow: "ellipsis",
            flex:         "1"
        });
        label.onclick = () => _browser_set_active(tab.id);

        const closeBtn = document.createElement("span");
        closeBtn.textContent = "\u00D7";
        closeBtn.title = "Close tab";
        Object.assign(closeBtn.style, {
            color:      "#6c7086",
            cursor:     "pointer",
            fontSize:   "14px",
            lineHeight: "1"
        });
        closeBtn.onmouseover = () => { closeBtn.style.color = "#f38ba8"; };
        closeBtn.onmouseout  = () => { closeBtn.style.color = "#6c7086"; };
        closeBtn.onclick = (ev) => {
            ev.stopPropagation();
            _browser_close_tab(tab.id);
        };

        el.appendChild(label);
        el.appendChild(closeBtn);
        _browser_tab_bar.insertBefore(el, addBtn);
    });
}

/* ---- Eval via iframe contentWindow ---- */

async function _browser_eval_in_tab(tabId, js) {
    const tab = _browser_get_tab(tabId);
    if (!tab) return { result: undefined, error: "Tab " + tabId + " not found" };
    if (!tab.iframe) return { result: undefined, error: "Tab " + tabId + " has no iframe" };

    try {
        const win = tab.iframe.contentWindow;
        const doc = tab.iframe.contentDocument;
        if (!win || !doc) {
            return { result: undefined, error: "Tab " + tabId + ": iframe contentWindow not accessible" };
        }

        /* CSP-safe eval: inject a <script nonce="..."> tag instead of
           calling eval(), which CSP blocks on most sites. Falls back to
           direct eval when no nonce is present (permissive CSP). */
        const nonceEl = doc.querySelector("script[nonce]");
        const nonce   = nonceEl ? (nonceEl.nonce || nonceEl.getAttribute("nonce")) : null;

        let result;
        if (!nonce) {
            result = win.eval(js);
        } else {
            const key  = "__tm_beval_" + Math.random().toString(36).slice(2);
            const rKey = key + "_r";
            const eKey = key + "_e";
            const sKey = key + "_s";

            const run = (body) => {
                const s = doc.createElement("script");
                s.setAttribute("nonce", nonce);
                s.textContent = body;
                (doc.head || doc.documentElement).appendChild(s);
                s.remove();
            };

            /* Attempt 1: expression form — captures return value */
            run(
                "try { window[" + JSON.stringify(rKey) + "] = (\n" + js + "\n);" +
                " window[" + JSON.stringify(sKey) + "] = 1; }" +
                " catch (e) { window[" + JSON.stringify(eKey) + "] = e;" +
                " window[" + JSON.stringify(sKey) + "] = 0; }"
            );

            result     = win[rKey];
            const error = win[eKey];
            const ok    = win[sKey];
            delete win[rKey]; delete win[eKey]; delete win[sKey];

            if (ok !== 1) {
                /* Attempt 2: statement form (var/let/function/loops) */
                if (error && error.name === "SyntaxError") {
                    run(
                        "try { " + js + " }" +
                        " catch (e) { window[" + JSON.stringify(eKey) + "] = e; }"
                    );
                    const err2 = win[eKey];
                    delete win[eKey];
                    if (err2) return { result: undefined, error: String(err2) };
                    return { result: undefined, error: null };
                }
                return { result: undefined, error: String(error) };
            }
        }

        /* Resolve promises via same-realm .then() + parent-side polling.
           Cross-realm `await` can hang when the iframe's SPA context shifts
           (React re-renders, pushState navigations). Instead we register a
           .then() callback *inside* the iframe realm that writes the resolved
           value to a window global, then poll that global from the parent. */
        if (result && typeof result === "object" && typeof result.then === "function") {
            const pollKey = "__tm_poll_" + Math.random().toString(36).slice(2);

            /* Store promise back on iframe window so the same-realm script
               can reference it, then register .then() inside the iframe. */
            win[pollKey + "_p"] = result;
            const thenScript =
                "window[" + JSON.stringify(pollKey + "_p") + "].then(" +
                "function(v){ window[" + JSON.stringify(pollKey) + "] = { value: v }; }," +
                "function(e){ window[" + JSON.stringify(pollKey) + "] = { error: String(e) }; }" +
                "); delete window[" + JSON.stringify(pollKey + "_p") + "];";

            if (nonce) {
                const s2 = doc.createElement("script");
                s2.setAttribute("nonce", nonce);
                s2.textContent = thenScript;
                (doc.head || doc.documentElement).appendChild(s2);
                s2.remove();
            } else {
                win.eval(thenScript);
            }

            /* Poll for the result — 150ms interval, up to 6 minutes.
               The browsergpt automation can legitimately wait through a long
               generation (its own internal ceiling is ~5min); keep this
               above that so a slow-but-valid response isn't cut short. */
            const pollMs  = 150;
            const maxWait = 360000;
            const t0 = Date.now();

            while (Date.now() - t0 < maxWait) {
                await new Promise(r => setTimeout(r, pollMs));
                try {
                    const cw = tab.iframe.contentWindow; // re-read each tick
                    if (!cw) return { result: undefined, error: "iframe became inaccessible" };
                    const pr = cw[pollKey];
                    if (pr !== undefined) {
                        delete cw[pollKey];
                        if (pr.error) return { result: undefined, error: pr.error };
                        return { result: pr.value, error: null };
                    }
                } catch (_) {
                    return { result: undefined, error: "iframe became inaccessible during async execution" };
                }
            }

            /* Timeout — clean up */
            try { delete tab.iframe.contentWindow[pollKey]; } catch (_) {}
            return { result: undefined, error: "async eval timed out after 180s" };
        }

        return { result: result, error: null };
    } catch (e) {
        if (e.name === "SecurityError" || (e.message && e.message.indexOf("cross-origin") !== -1)) {
            return { result: undefined, error: "Cross-origin: cannot access this page's DOM. Only same-origin pages support JS execution." };
        }
        return { result: undefined, error: String(e) };
    }
}

/* ---- Persistence ---- */

function _browser_persist_state() {
    const data = _browser_tabs.map(t => ({
        id:   t.id,
        name: t.name,
        url:  t.url
    }));
    localStorage.setItem("tm_browser_tabs", JSON.stringify(data));
    localStorage.setItem("tm_browser_active_tab", String(_browser_active_tab || ""));
    localStorage.setItem("tm_browser_next_id", String(_browser_next_id));
}

function _browser_restore_state() {
    try {
        const nextId = parseInt(localStorage.getItem("tm_browser_next_id"), 10);
        if (nextId > 0) _browser_next_id = nextId;

        const raw = localStorage.getItem("tm_browser_tabs");
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!Array.isArray(saved) || saved.length === 0) return;

        saved.forEach(s => {
            if (s.url && s.url !== "about:blank") {
                const newId = _browser_new_tab(s.url, s.name);
                /* Restore the original tab id so session console bindings
                   and other cross-component references survive restarts. */
                const tab = _browser_get_tab(newId);
                if (tab && s.id !== undefined && s.id !== newId) {
                    tab.id = s.id;
                    if (s.id >= _browser_next_id) _browser_next_id = s.id + 1;
                    /* Fix active tab reference if it pointed at the old id */
                    if (_browser_active_tab === newId) _browser_active_tab = s.id;
                }
            }
        });

        const savedActive = parseInt(localStorage.getItem("tm_browser_active_tab"), 10);
        if (savedActive && _browser_tabs.find(t => t.id === savedActive)) {
            _browser_set_active(savedActive);
        }
    } catch (e) {
        console.error("browser restore state:", e);
    }
}

/* ---- Shell API builder ---- */

function _browser_build_tab_api(tabId) {
    return {
        eval(js)       { return _browser_eval_in_tab(tabId, js); },
        navigate(url)  { var t = _browser_get_tab(tabId); if (t) return _browser_navigate_tab(t, url); },
        getUrl()       { var t = _browser_get_tab(tabId); return t ? t.url : null; },
        back()         { return _browser_go_back(); },
        forward()      { return _browser_go_forward(); },
        reload()       { return _browser_refresh(); },
        getName()      { var t = _browser_get_tab(tabId); return t ? t.name : null; },
        setName(name)  { var t = _browser_get_tab(tabId); if (t) { t.name = name; _browser_render_tab_bar(); _browser_persist_state(); } }
    };
}

function _browser_build_shell_api() {
    return {
        help() {
            return "shell.browser — Browser tab management\n\n" +
                "Methods:\n" +
                "  newTab(url, name?)      — Open a new browser tab. Returns tab ID (number).\n" +
                "  closeTab(tabId)         — Close a browser tab by ID.\n" +
                "  listTabs()              — Returns [{id, name, url}] for all open tabs.\n" +
                "  getActiveTabId()        — Returns the currently active tab's ID.\n" +
                "  setActiveTab(tabId)     — Switch to a tab by ID.\n" +
                "  getTab(tabId)           — Returns a tab API object (or null).\n" +
                "  onTabClosed(callback)   — Register a listener for tab close events.\n\n" +
                "Recipes:\n" +
                "  // Open a page and get its tab ID:\n" +
                "  var tabId = shell.browser.newTab('https://example.com', 'My Page')\n\n" +
                "  // Find an existing tab:\n" +
                "  shell.browser.listTabs()  // → [{id: 28, name: 'Tab 1', url: '...'}]\n\n" +
                "  // To run JS inside a browser tab, attach a session console tab to it.\n" +
                "  // See shell.sessionConsole.help() for the full workflow.";
        },
        newTab(url, name)       { if (!browserContainer) component_browser_create(); return _browser_new_tab(url, name); },
        closeTab(tabId)         { return _browser_close_tab(tabId); },
        listTabs()              { return _browser_tabs.map(t => ({ id: t.id, name: t.name, url: t.url })); },
        getActiveTabId()        { return _browser_active_tab; },
        setActiveTab(tabId)     { _browser_set_active(tabId); },
        getTab(tabId)           { var t = _browser_get_tab(tabId); return t ? _browser_build_tab_api(tabId) : null; },
        onTabClosed(callback)   { if (typeof callback === "function") _browser_tab_closed_listeners.push(callback); }
    };
}

/* ---- Framework lifecycle ---- */

function component_browser_handle_init() {
    ServiceWindow.registerApp("browser", component_browser_launch);
    /* Eagerly create the browser DOM + restore tabs so that _browser_tabs
       is populated at boot. Other components (session console, browsergpt)
       may reference browser tabs before the user opens the browser window. */
    if (!browserContainer) component_browser_create();
}

// ===== src/component_calc.js =====
// -----------------------------------------------------------------------------
// component_calc.js — minimal demo app showing how to build a window with
// ServiceWindow. Two number inputs, a Sum button, and a result label.
//
// Registered as a normal Start-menu app (not a tray app). Lazily creates
// the window on first launch.
// -----------------------------------------------------------------------------

let calcServiceWindow = null;
let calcContainer     = null;

function component_calc_launch() {
    if (!calcContainer) component_calc_create();
    calcServiceWindow.show();
}

function component_calc_create() {

    calcServiceWindow = new ServiceWindow();
    calcServiceWindow.create({
        appName: "calc",
        width:  320,
        height: 200,
        shell:  shell,
        isDraggable: () => true,
        isResizable: () => true
    });

    calcServiceWindow.registerTab({ id: "calc", label: "Calc" });

    /* Min/max/close cluster — defaults from ServiceWindow are fine for a
       minimal demo (close hides the container; max toggles fullscreen; min
       collapses to header height). No wiring needed here. */
    calcServiceWindow.appendControls();

    calcContainer = calcServiceWindow.container;

    /* Body */
    const body = calcServiceWindow.createBody();

    const inputA = calcServiceWindow.createTextbox("a", "operand1");
    inputA.type = "number";

    const inputB = calcServiceWindow.createTextbox("b", "operand2");
    inputB.type = "number";

    const resultLabel = calcServiceWindow.createLabel("Result: —", "result");

    const sumBtn = calcServiceWindow.createPrimaryButton("Sum", "sum");

    sumBtn.onclick = () => {
        const a = parseFloat(inputA.value) || 0;
        const b = parseFloat(inputB.value) || 0;
        resultLabel.textContent = "Result: " + (a + b);
    };

    body.appendChild(inputA);
    body.appendChild(inputB);
    body.appendChild(sumBtn);
    body.appendChild(resultLabel);

    /* Shell API needs a rescan — body elements were added after appendControls. */
    calcServiceWindow.refreshShellAPI();

    /* Restore previously saved geometry/mode; otherwise center. */
    if (!calcServiceWindow.restoreState()) {
        service_window_center(calcContainer, 320, 200);
    }
}

/* Framework lifecycle reactor — registers calc with the system-restore
   registry so framework_system_restore.js can re-open this window at boot
   if it was visible in the last session. */
function component_calc_handle_init() {
    ServiceWindow.registerApp("calc", component_calc_launch);
}

// ===== src/component_chat.js =====
// -----------------------------------------------------------------------------
// component_chat.js — IM-style chat app. Text input at the bottom, scrollable
// message log above. Sends prompts via submitMessage (service_llm.js) and
// displays responses inline. Shows a waiting indicator while the LLM streams.
// -----------------------------------------------------------------------------

let chatServiceWindow = null;
let chatContainer      = null;

/* Inline SVG chat bubble: 14x14 viewBox, currentColor strokes so it inherits
   whatever container's text colour (tray button, taskbar running-app
   button, hover state). A rounded speech bubble with a small triangular
   tail at the bottom-left, plus three dots indicating conversation. */
const CHAT_ICON_SVG =
    "<svg width='14' height='14' viewBox='0 0 14 14' " +
    "xmlns='http://www.w3.org/2000/svg' style='display:block'>" +
        "<path d='M2 1.5 h10 a1.5 1.5 0 0 1 1.5 1.5 v6 " +
        "a1.5 1.5 0 0 1 -1.5 1.5 h-6.5 l-2.5 2.5 v-2.5 " +
        "h-1 a1.5 1.5 0 0 1 -1.5 -1.5 v-6 " +
        "a1.5 1.5 0 0 1 1.5 -1.5 z' " +
        "fill='none' stroke='currentColor' stroke-width='1'/>" +
        "<circle cx='4.5' cy='5.8' r='0.7' fill='currentColor'/>" +
        "<circle cx='7'   cy='5.8' r='0.7' fill='currentColor'/>" +
        "<circle cx='9.5' cy='5.8' r='0.7' fill='currentColor'/>" +
    "</svg>";

// DOM refs
let _chat_log       = null;   // scrollable message history
let _chat_input     = null;   // prompt textarea
let _chat_sendBtn   = null;   // send button
let _chat_waiting   = false;  // true while an LLM job is in flight

function component_chat_launch() {
    if (!chatContainer) component_chat_create();
    chatServiceWindow.show();
}

function component_chat_create() {

    const trayBtn = framework_taskbar_get_tray_button("chat");

    chatServiceWindow = new ServiceWindow();
    chatServiceWindow.create({
        appName:     "chat",
        width:       480,
        height:      400,
        shell:  shell,
        isDraggable: () => true,
        isResizable: () => true,
        trayButton:  trayBtn
    });

    chatServiceWindow.registerTab({ id: "chat", label: "Chat" });
    chatServiceWindow.appendControls();

    chatContainer = chatServiceWindow.container;

    /* Body — flex column, no padding so we control spacing ourselves. */
    const body = chatServiceWindow.createBody({ padding: "0", gap: "0" });

    /* ---- Message log ---- */
    _chat_log = document.createElement("div");
    Object.assign(_chat_log.style, {
        flex:       "1",
        overflowY:  "auto",
        padding:    "8px",
        fontSize:   "13px",
        fontFamily: "Consolas, monospace",
        color:      "white"
    });
    body.appendChild(_chat_log);

    /* ---- Input bar (textarea + send button) ---- */
    const inputBar = document.createElement("div");
    Object.assign(inputBar.style, {
        display:       "flex",
        gap:           "4px",
        padding:       "6px 8px",
        borderTop:     "1px solid #333",
        background:    "#252525",
        alignItems:    "flex-end"
    });

    _chat_input = document.createElement("textarea");
    _chat_input.placeholder = "Enter prompt...";
    _chat_input.rows = 2;
    Object.assign(_chat_input.style, {
        flex:        "1",
        background:  "#2a2a2a",
        color:       "white",
        border:      "1px solid #444",
        borderRadius: "4px",
        padding:     "6px",
        fontSize:    "13px",
        fontFamily:  "Consolas, monospace",
        resize:      "none",
        lineHeight:  "1.4"
    });

    /* Enter sends (Shift+Enter for newline). */
    _chat_input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            _chat_do_send();
        }
    });

    _chat_sendBtn = document.createElement("button");
    _chat_sendBtn.textContent = "Send";
    Object.assign(_chat_sendBtn.style, {
        background:   "#4fc3f7",
        color:        "#000",
        border:       "none",
        borderRadius: "4px",
        padding:      "6px 14px",
        cursor:       "pointer",
        fontWeight:   "bold",
        fontSize:     "13px",
        alignSelf:    "stretch"
    });
    _chat_sendBtn.onclick = () => _chat_do_send();

    inputBar.appendChild(_chat_input);
    inputBar.appendChild(_chat_sendBtn);
    body.appendChild(inputBar);

    /* Restore geometry or center. */
    if (!chatServiceWindow.restoreState()) {
        service_window_center(chatContainer, 480, 400);
    }
}

/* ---- Send logic ---- */

function _chat_do_send() {
    if (_chat_waiting) return;
    const prompt = (_chat_input.value || "").trim();
    if (!prompt) return;

    /* Append user message to log. */
    _chat_append_message("You", prompt);

    _chat_input.value = "";

    /* Show waiting indicator. */
    const waitEl = _chat_append_waiting();

    _chat_waiting = true;
    _chat_sendBtn.textContent = "...";
    _chat_sendBtn.style.opacity = "0.5";
    _chat_input.readOnly = true;

    submitMessage(
        prompt,
        /* onstart */ null,
        /* onend   */ (ctx) => {
            _chat_waiting = false;
            _chat_sendBtn.textContent = "Send";
            _chat_sendBtn.style.opacity = "1";
            _chat_input.readOnly = false;

            /* Remove waiting indicator. */
            if (waitEl && waitEl.parentElement) waitEl.parentElement.removeChild(waitEl);

            if (ctx.cancelled) {
                _chat_append_message("System", "(cancelled)");
            } else if (ctx.error) {
                _chat_append_message("System", "Error: " + ctx.error);
            } else {
                _chat_append_message("Assistant", ctx.result || "(empty response)");

                /* If the chat window isn't actively visible to the user
                   (closed, hidden, or minimized to the taskbar), surface
                   the response as a toast notification. The first 60 chars
                   of the result preview the body; full text is recorded in
                   the toast history pane. */
                const chatVisible =
                    chatServiceWindow &&
                    chatServiceWindow.visible &&
                    chatServiceWindow.mode !== "minimized";

                if (!chatVisible) {
                    const raw = (ctx.result || "").trim();
                    const preview = raw.length > 60
                        ? raw.slice(0, 60) + "…"
                        : (raw || "(empty response)");
                    service_toast_show(preview, {
                        title:    "LLM",
                        icon:     "💬",
                        duration: 3000
                    });
                }
            }

            _chat_input.focus();
        }
    );
}

/* ---- DOM helpers ---- */

function _chat_append_message(role, text) {
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
        marginBottom: "8px",
        whiteSpace:   "pre-wrap",
        wordBreak:    "break-word",
        lineHeight:   "1.4"
    });

    const label = document.createElement("span");
    label.textContent = role + ": ";
    Object.assign(label.style, {
        fontWeight: "bold",
        color: role === "You" ? "#4fc3f7" : role === "Assistant" ? "#a5d6a7" : "#ffcc80"
    });

    const content = document.createElement("span");
    content.textContent = text;
    content.style.color = "#ddd";

    wrapper.appendChild(label);
    wrapper.appendChild(content);
    _chat_log.appendChild(wrapper);

    /* Auto-scroll to bottom. */
    _chat_log.scrollTop = _chat_log.scrollHeight;

    return wrapper;
}

function _chat_append_waiting() {
    const el = document.createElement("div");
    Object.assign(el.style, {
        marginBottom: "8px",
        color:        "#888",
        fontSize:     "13px"
    });
    el.textContent = "Waiting";

    let dots = 0;
    const tid = setInterval(() => {
        dots = (dots + 1) % 4;
        el.textContent = "Waiting" + ".".repeat(dots);
    }, 400);

    /* Stash the interval id so cleanup can stop it. */
    el._chatWaitTid = tid;

    /* Patch removeChild to auto-clear the interval. */
    const origRemove = el.remove.bind(el);
    el.remove = () => { clearInterval(tid); origRemove(); };

    _chat_log.appendChild(el);
    _chat_log.scrollTop = _chat_log.scrollHeight;

    return el;
}

/* ---- Framework lifecycle ---- */

function component_chat_handle_init() {
    ServiceWindow.registerApp("chat", component_chat_launch);

    framework_taskbar_register_tray_app({
        appName: "chat",
        label:   "Chat",
        icon:    CHAT_ICON_SVG,
        title:   "Chat",
        onClick: (btn) => {
            if (!chatContainer) component_chat_create();
            chatServiceWindow._toggleFromTray(btn);
        },
        onAdopt: (btn) => {
            if (chatServiceWindow) {
                chatServiceWindow._adoptTrayButton(btn, null);
            }
        }
    });
}

// ===== src/component_clock.js =====
// -----------------------------------------------------------------------------
// component_clock.js — Clock app with 4 tabs: Clock, Alarm, Stopwatch, Timer.
//
// Registered as a system-tray app. Alarms and timers persist in localStorage;
// stopwatch is session-only. Fires toasts + audio on alarm/timer events.
// Shell API exposes dynamic sub-objects (shell.clock.alarm1, .timer1, etc.).
// -----------------------------------------------------------------------------

let clockServiceWindow = null;
let clockContainer     = null;
let clockActiveTab     = "clock";
let clockIntervalId    = null;       // single 1s setInterval drives clock/alarm/timer

// Alarm state — persisted in localStorage["tm_clock_alarms"]
let clockAlarms       = [];   // [{ id, time:"HH:MM", message:"", enabled:true, firedAt:null }]
let clockAlarmNextId  = 1;

// Stopwatch state — session only
let clockSwRunning   = false;
let clockSwStartTime = 0;
let clockSwElapsed   = 0;     // ms accumulated before last pause
let clockSwLaps      = [];
let clockSwRafId     = null;  // rAF loop for centisecond display

// Timer state — persisted in localStorage["tm_clock_timers"]
let clockTimers       = [];   // [{ id, hours, minutes, seconds, message, remainingMs, running, fired }]
let clockTimerNextId  = 1;

// Audio cache
let _clockAudioCache = null;

// DOM refs for tab panels
let _clock_panelClock = null;
let _clock_panelAlarm = null;
let _clock_panelSw    = null;
let _clock_panelTimer = null;

// Clock display refs
let _clock_timeEl = null;
let _clock_dateEl = null;

// Stopwatch display refs
let _clock_swDisplay  = null;
let _clock_swStartBtn = null;
let _clock_swLapBtn   = null;
let _clock_swResetBtn = null;
let _clock_swLapList  = null;

// Alarm/Timer list containers
let _clock_alarmList = null;
let _clock_timerList = null;

/* Inline SVG clock icon: 14x14 viewBox. */
const CLOCK_ICON_SVG =
    "<svg width='14' height='14' viewBox='0 0 14 14' " +
    "xmlns='http://www.w3.org/2000/svg' style='display:block'>" +
        "<circle cx='7' cy='7' r='5.5' fill='none' stroke='currentColor' stroke-width='1'/>" +
        "<line x1='7' y1='7' x2='7' y2='3.5' stroke='currentColor' stroke-width='1' stroke-linecap='round'/>" +
        "<line x1='7' y1='7' x2='9.5' y2='8' stroke='currentColor' stroke-width='0.8' stroke-linecap='round'/>" +
        "<circle cx='7' cy='7' r='0.5' fill='currentColor'/>" +
    "</svg>";

// ─── Launch / Create ─────────────────────────────────────────────────────────

function component_clock_launch() {
    if (!clockContainer) component_clock_create();
    clockServiceWindow.show();
}

function component_clock_create() {

    const trayBtn = framework_taskbar_get_tray_button("clock_app");

    clockServiceWindow = new ServiceWindow();
    clockServiceWindow.create({
        appName:     "clock_app",
        width:       560,
        height:      380,
        isDraggable: () => true,
        isResizable: () => true,
        trayButton:  trayBtn
    });

    // Register tabs
    clockServiceWindow.registerTab({ id: "clock",     label: "Clock",     onClick: _clock_switch_tab });
    clockServiceWindow.registerTab({ id: "alarm",     label: "Alarm",     onClick: _clock_switch_tab });
    clockServiceWindow.registerTab({ id: "stopwatch", label: "Stopwatch", onClick: _clock_switch_tab });
    clockServiceWindow.registerTab({ id: "timer",     label: "Timer",     onClick: _clock_switch_tab });

    clockServiceWindow.appendControls();
    clockContainer = clockServiceWindow.container;

    /* Window-scoped hotkeys — only fire when this window is active. */
    service_hotkeys_register(clockServiceWindow, "alt+1", () => _clock_switch_tab("clock"));
    service_hotkeys_register(clockServiceWindow, "alt+2", () => _clock_switch_tab("alarm"));
    service_hotkeys_register(clockServiceWindow, "alt+3", () => _clock_switch_tab("stopwatch"));
    service_hotkeys_register(clockServiceWindow, "alt+4", () => _clock_switch_tab("timer"));

    // Build tab panels
    _clock_build_clock_panel();
    _clock_build_alarm_panel();
    _clock_build_stopwatch_panel();
    _clock_build_timer_panel();

    // Load persisted alarms and timers
    _clock_load_alarms();
    _clock_load_timers();

    // Start the 1s interval
    clockIntervalId = setInterval(_clock_tick, 1000);
    _clock_tick(); // immediate first tick

    // Show initial tab
    _clock_switch_tab("clock");

    // Build shell API
    _clock_rebuild_shell();

    // Restore geometry or center
    if (!clockServiceWindow.restoreState()) {
        service_window_center(clockContainer, 560, 380);
    }
}

// ─── Tab Switching ───────────────────────────────────────────────────────────

function _clock_switch_tab(id) {
    clockActiveTab = id;
    clockServiceWindow.setActiveTabHighlight(id);

    _clock_panelClock.style.display     = id === "clock"     ? "flex" : "none";
    _clock_panelAlarm.style.display     = id === "alarm"     ? "flex" : "none";
    _clock_panelSw.style.display        = id === "stopwatch" ? "flex" : "none";
    _clock_panelTimer.style.display     = id === "timer"     ? "flex" : "none";
}

// ─── Clock Panel ─────────────────────────────────────────────────────────────

function _clock_build_clock_panel() {
    _clock_panelClock = document.createElement("div");
    Object.assign(_clock_panelClock.style, {
        flex: "1", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        color: "white", padding: "12px", gap: "8px"
    });

    _clock_timeEl = document.createElement("div");
    Object.assign(_clock_timeEl.style, {
        fontSize: "48px", fontWeight: "bold", fontFamily: "monospace",
        letterSpacing: "2px"
    });

    _clock_dateEl = document.createElement("div");
    Object.assign(_clock_dateEl.style, {
        fontSize: "14px", color: "#aaa"
    });

    _clock_panelClock.appendChild(_clock_timeEl);
    _clock_panelClock.appendChild(_clock_dateEl);
    clockContainer.appendChild(_clock_panelClock);
}

// ─── Alarm Panel ─────────────────────────────────────────────────────────────

function _clock_build_alarm_panel() {
    _clock_panelAlarm = document.createElement("div");
    Object.assign(_clock_panelAlarm.style, {
        flex: "1", display: "none", flexDirection: "column",
        color: "white", padding: "12px", gap: "8px", overflow: "hidden"
    });

    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add Alarm";
    Object.assign(addBtn.style, {
        background: "#4fc3f7", color: "#000", border: "none",
        borderRadius: "4px", padding: "6px 10px", cursor: "pointer",
        fontWeight: "bold", alignSelf: "flex-start"
    });
    addBtn.onclick = function () {
        _clock_add_alarm();
    };

    _clock_alarmList = document.createElement("div");
    Object.assign(_clock_alarmList.style, {
        flex: "1", overflowY: "auto", display: "flex",
        flexDirection: "column", gap: "6px"
    });

    _clock_panelAlarm.appendChild(addBtn);
    _clock_panelAlarm.appendChild(_clock_alarmList);
    clockContainer.appendChild(_clock_panelAlarm);
}

function _clock_add_alarm(time, message, enabled) {
    const alarm = {
        id:      clockAlarmNextId++,
        time:    time || "",
        message: message || "",
        enabled: enabled !== undefined ? enabled : true,
        firedAt: null
    };
    clockAlarms.push(alarm);
    _clock_render_alarm(alarm);
    _clock_save_alarms();
    _clock_rebuild_shell();
}

function _clock_render_alarm(alarm) {
    const row = document.createElement("div");
    row.dataset.alarmId = alarm.id;
    Object.assign(row.style, {
        display: "flex", alignItems: "center", gap: "6px",
        background: "#2a2a2a", borderRadius: "4px", padding: "6px 8px"
    });

    const timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.value = alarm.time;
    Object.assign(timeInput.style, {
        background: "#1e1e1e", color: "white", border: "1px solid #444",
        borderRadius: "4px", padding: "2px 4px", fontSize: "13px", width: "90px"
    });
    timeInput.onchange = function () {
        alarm.time = timeInput.value;
        alarm.firedAt = null;
        _clock_save_alarms();
    };

    const msgInput = document.createElement("input");
    msgInput.type = "text";
    msgInput.placeholder = "Message";
    msgInput.value = alarm.message;
    Object.assign(msgInput.style, {
        background: "#1e1e1e", color: "white", border: "1px solid #444",
        borderRadius: "4px", padding: "2px 4px", fontSize: "13px",
        flex: "1", minWidth: "0"
    });
    msgInput.onchange = function () {
        alarm.message = msgInput.value;
        _clock_save_alarms();
    };

    const enableCb = document.createElement("input");
    enableCb.type = "checkbox";
    enableCb.checked = alarm.enabled;
    enableCb.title = "Enabled";
    enableCb.onchange = function () {
        alarm.enabled = enableCb.checked;
        alarm.firedAt = null;
        _clock_save_alarms();
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "×";
    Object.assign(delBtn.style, {
        background: "#555", color: "white", border: "none",
        borderRadius: "4px", width: "22px", height: "22px",
        cursor: "pointer", fontSize: "14px", lineHeight: "1"
    });
    delBtn.onclick = function () {
        clockAlarms = clockAlarms.filter(function (a) { return a.id !== alarm.id; });
        row.remove();
        _clock_save_alarms();
        _clock_rebuild_shell();
    };

    row.appendChild(timeInput);
    row.appendChild(msgInput);
    row.appendChild(enableCb);
    row.appendChild(delBtn);

    // Store DOM refs on alarm for shell API access
    alarm._timeInput = timeInput;
    alarm._msgInput  = msgInput;
    alarm._enableCb  = enableCb;

    _clock_alarmList.appendChild(row);
}

function _clock_save_alarms() {
    const data = clockAlarms.map(function (a) {
        return { id: a.id, time: a.time, message: a.message, enabled: a.enabled, firedAt: a.firedAt };
    });
    localStorage.setItem("tm_clock_alarms", JSON.stringify(data));
}

function _clock_load_alarms() {
    try {
        const raw = localStorage.getItem("tm_clock_alarms");
        if (!raw) return;
        const data = JSON.parse(raw);
        data.forEach(function (a) {
            if (a.id >= clockAlarmNextId) clockAlarmNextId = a.id + 1;
            _clock_add_alarm(a.time, a.message, a.enabled);
            // Restore firedAt so we don't re-fire on page load
            const last = clockAlarms[clockAlarms.length - 1];
            if (last) last.firedAt = a.firedAt || null;
        });
    } catch (e) {
        // ignore corrupt data
    }
}

// ─── Stopwatch Panel ─────────────────────────────────────────────────────────

function _clock_build_stopwatch_panel() {
    _clock_panelSw = document.createElement("div");
    Object.assign(_clock_panelSw.style, {
        flex: "1", display: "none", flexDirection: "column",
        color: "white", padding: "12px", gap: "8px", overflow: "hidden"
    });

    _clock_swDisplay = document.createElement("div");
    Object.assign(_clock_swDisplay.style, {
        fontSize: "40px", fontWeight: "bold", fontFamily: "monospace",
        textAlign: "center", letterSpacing: "2px", padding: "8px 0"
    });
    _clock_swDisplay.textContent = "00:00.00";

    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, {
        display: "flex", gap: "8px", justifyContent: "center"
    });

    _clock_swStartBtn = document.createElement("button");
    _clock_swStartBtn.textContent = "Start";
    Object.assign(_clock_swStartBtn.style, {
        background: "#4fc3f7", color: "#000", border: "none",
        borderRadius: "4px", padding: "6px 14px", cursor: "pointer",
        fontWeight: "bold"
    });
    _clock_swStartBtn.onclick = _clock_sw_toggle;

    _clock_swLapBtn = document.createElement("button");
    _clock_swLapBtn.textContent = "Lap";
    Object.assign(_clock_swLapBtn.style, {
        background: "#555", color: "white", border: "none",
        borderRadius: "4px", padding: "6px 14px", cursor: "pointer"
    });
    _clock_swLapBtn.onclick = _clock_sw_lap;

    _clock_swResetBtn = document.createElement("button");
    _clock_swResetBtn.textContent = "Reset";
    Object.assign(_clock_swResetBtn.style, {
        background: "#555", color: "white", border: "none",
        borderRadius: "4px", padding: "6px 14px", cursor: "pointer"
    });
    _clock_swResetBtn.onclick = _clock_sw_reset;

    btnRow.appendChild(_clock_swStartBtn);
    btnRow.appendChild(_clock_swLapBtn);
    btnRow.appendChild(_clock_swResetBtn);

    _clock_swLapList = document.createElement("div");
    Object.assign(_clock_swLapList.style, {
        flex: "1", overflowY: "auto", display: "flex",
        flexDirection: "column", gap: "2px", fontSize: "12px",
        fontFamily: "monospace", color: "#aaa"
    });

    _clock_panelSw.appendChild(_clock_swDisplay);
    _clock_panelSw.appendChild(btnRow);
    _clock_panelSw.appendChild(_clock_swLapList);
    clockContainer.appendChild(_clock_panelSw);
}

function _clock_sw_toggle() {
    if (clockSwRunning) {
        // Stop
        clockSwRunning = false;
        clockSwElapsed += (performance.now() - clockSwStartTime);
        if (clockSwRafId) { cancelAnimationFrame(clockSwRafId); clockSwRafId = null; }
        _clock_swStartBtn.textContent = "Start";
        _clock_swStartBtn.style.background = "#4fc3f7";
    } else {
        // Start
        clockSwRunning = true;
        clockSwStartTime = performance.now();
        _clock_swStartBtn.textContent = "Stop";
        _clock_swStartBtn.style.background = "#ef5350";
        _clock_sw_raf_loop();
    }
}

function _clock_sw_lap() {
    if (!clockSwRunning) return;
    const total = clockSwElapsed + (performance.now() - clockSwStartTime);
    clockSwLaps.push(total);
    const lapEl = document.createElement("div");
    lapEl.textContent = "Lap " + clockSwLaps.length + ": " + _clock_format_sw(total);
    _clock_swLapList.insertBefore(lapEl, _clock_swLapList.firstChild);
}

function _clock_sw_reset() {
    clockSwRunning = false;
    clockSwElapsed = 0;
    clockSwStartTime = 0;
    clockSwLaps = [];
    if (clockSwRafId) { cancelAnimationFrame(clockSwRafId); clockSwRafId = null; }
    _clock_swDisplay.textContent = "00:00.00";
    _clock_swStartBtn.textContent = "Start";
    _clock_swStartBtn.style.background = "#4fc3f7";
    _clock_swLapList.innerHTML = "";
}

function _clock_sw_raf_loop() {
    if (!clockSwRunning) return;
    const total = clockSwElapsed + (performance.now() - clockSwStartTime);
    _clock_swDisplay.textContent = _clock_format_sw(total);
    clockSwRafId = requestAnimationFrame(_clock_sw_raf_loop);
}

function _clock_format_sw(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const cs = Math.floor((ms % 1000) / 10);
    return String(m).padStart(2, "0") + ":" +
           String(s).padStart(2, "0") + "." +
           String(cs).padStart(2, "0");
}

// ─── Timer Panel ─────────────────────────────────────────────────────────────

function _clock_build_timer_panel() {
    _clock_panelTimer = document.createElement("div");
    Object.assign(_clock_panelTimer.style, {
        flex: "1", display: "none", flexDirection: "column",
        color: "white", padding: "12px", gap: "8px", overflow: "hidden"
    });

    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add Timer";
    Object.assign(addBtn.style, {
        background: "#4fc3f7", color: "#000", border: "none",
        borderRadius: "4px", padding: "6px 10px", cursor: "pointer",
        fontWeight: "bold", alignSelf: "flex-start"
    });
    addBtn.onclick = function () {
        _clock_add_timer();
    };

    _clock_timerList = document.createElement("div");
    Object.assign(_clock_timerList.style, {
        flex: "1", overflowY: "auto", display: "flex",
        flexDirection: "column", gap: "6px"
    });

    _clock_panelTimer.appendChild(addBtn);
    _clock_panelTimer.appendChild(_clock_timerList);
    clockContainer.appendChild(_clock_panelTimer);
}

function _clock_add_timer(hours, minutes, seconds, message) {
    const timer = {
        id:          clockTimerNextId++,
        hours:       hours   || 0,
        minutes:     minutes || 0,
        seconds:     seconds || 0,
        message:     message || "",
        remainingMs: 0,
        running:     false,
        fired:       false
    };
    timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
    clockTimers.push(timer);
    _clock_render_timer(timer);
    _clock_save_timers();
    _clock_rebuild_shell();
}

function _clock_render_timer(timer) {
    const row = document.createElement("div");
    row.dataset.timerId = timer.id;
    Object.assign(row.style, {
        display: "flex", alignItems: "center", gap: "6px",
        background: "#2a2a2a", borderRadius: "4px", padding: "6px 8px",
        flexWrap: "wrap"
    });

    // Time inputs row
    const timeRow = document.createElement("div");
    Object.assign(timeRow.style, { display: "flex", alignItems: "center", gap: "2px" });

    const hInput = _clock_make_num_input(2, "h");
    hInput.value = timer.hours;
    hInput.onchange = function () {
        timer.hours = parseInt(hInput.value) || 0;
        if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
        _clock_save_timers();
    };

    const sep1 = document.createElement("span");
    sep1.textContent = ":";
    sep1.style.color = "#888";

    const mInput = _clock_make_num_input(2, "m");
    mInput.value = timer.minutes;
    mInput.onchange = function () {
        timer.minutes = parseInt(mInput.value) || 0;
        if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
        _clock_save_timers();
    };

    const sep2 = document.createElement("span");
    sep2.textContent = ":";
    sep2.style.color = "#888";

    const sInput = _clock_make_num_input(2, "s");
    sInput.value = timer.seconds;
    sInput.onchange = function () {
        timer.seconds = parseInt(sInput.value) || 0;
        if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
        _clock_save_timers();
    };

    timeRow.appendChild(hInput);
    timeRow.appendChild(sep1);
    timeRow.appendChild(mInput);
    timeRow.appendChild(sep2);
    timeRow.appendChild(sInput);

    const msgInput = document.createElement("input");
    msgInput.type = "text";
    msgInput.placeholder = "Message";
    msgInput.value = timer.message;
    Object.assign(msgInput.style, {
        background: "#1e1e1e", color: "white", border: "1px solid #444",
        borderRadius: "4px", padding: "2px 4px", fontSize: "12px",
        flex: "1", minWidth: "0"
    });
    msgInput.onchange = function () {
        timer.message = msgInput.value;
        _clock_save_timers();
    };

    const remainLabel = document.createElement("span");
    Object.assign(remainLabel.style, {
        fontFamily: "monospace", fontSize: "13px", color: "#4fc3f7",
        minWidth: "60px", textAlign: "right"
    });
    remainLabel.textContent = _clock_format_timer_ms(timer.remainingMs);

    const startBtn = document.createElement("button");
    startBtn.textContent = "Start";
    Object.assign(startBtn.style, {
        background: "#4fc3f7", color: "#000", border: "none",
        borderRadius: "4px", padding: "3px 8px", cursor: "pointer",
        fontSize: "12px", fontWeight: "bold"
    });
    startBtn.onclick = function () {
        if (timer.running) {
            timer.running = false;
            startBtn.textContent = "Start";
            startBtn.style.background = "#4fc3f7";
        } else {
            if (timer.remainingMs <= 0) {
                timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
            }
            if (timer.remainingMs <= 0) return;
            timer.running = true;
            timer.fired = false;
            startBtn.textContent = "Pause";
            startBtn.style.background = "#ef5350";
        }
        _clock_save_timers();
    };

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "↻";
    Object.assign(resetBtn.style, {
        background: "#555", color: "white", border: "none",
        borderRadius: "4px", width: "22px", height: "22px",
        cursor: "pointer", fontSize: "13px"
    });
    resetBtn.onclick = function () {
        timer.running = false;
        timer.fired = false;
        timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
        remainLabel.textContent = _clock_format_timer_ms(timer.remainingMs);
        startBtn.textContent = "Start";
        startBtn.style.background = "#4fc3f7";
        _clock_save_timers();
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "×";
    Object.assign(delBtn.style, {
        background: "#555", color: "white", border: "none",
        borderRadius: "4px", width: "22px", height: "22px",
        cursor: "pointer", fontSize: "14px", lineHeight: "1"
    });
    delBtn.onclick = function () {
        clockTimers = clockTimers.filter(function (t) { return t.id !== timer.id; });
        row.remove();
        _clock_save_timers();
        _clock_rebuild_shell();
    };

    row.appendChild(timeRow);
    row.appendChild(msgInput);
    row.appendChild(remainLabel);
    row.appendChild(startBtn);
    row.appendChild(resetBtn);
    row.appendChild(delBtn);

    // Store DOM refs on timer for shell/tick access
    timer._remainLabel = remainLabel;
    timer._startBtn    = startBtn;
    timer._hInput      = hInput;
    timer._mInput      = mInput;
    timer._sInput      = sInput;
    timer._msgInput    = msgInput;

    _clock_timerList.appendChild(row);
}

function _clock_make_num_input(width, label) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "0";
    inp.placeholder = label;
    Object.assign(inp.style, {
        background: "#1e1e1e", color: "white", border: "1px solid #444",
        borderRadius: "4px", padding: "2px 4px", fontSize: "12px",
        width: (width * 16) + "px", textAlign: "center"
    });
    return inp;
}

function _clock_format_timer_ms(ms) {
    if (ms <= 0) return "00:00:00";
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return String(h).padStart(2, "0") + ":" +
           String(m).padStart(2, "0") + ":" +
           String(s).padStart(2, "0");
}

function _clock_save_timers() {
    const data = clockTimers.map(function (t) {
        return {
            id: t.id, hours: t.hours, minutes: t.minutes, seconds: t.seconds,
            message: t.message, remainingMs: t.remainingMs,
            running: t.running, fired: t.fired
        };
    });
    localStorage.setItem("tm_clock_timers", JSON.stringify(data));
}

function _clock_load_timers() {
    try {
        const raw = localStorage.getItem("tm_clock_timers");
        if (!raw) return;
        const data = JSON.parse(raw);
        data.forEach(function (t) {
            if (t.id >= clockTimerNextId) clockTimerNextId = t.id + 1;
            _clock_add_timer(t.hours, t.minutes, t.seconds, t.message);
            // Restore runtime state
            const last = clockTimers[clockTimers.length - 1];
            if (last) {
                last.remainingMs = t.remainingMs || 0;
                last.running = t.running || false;
                last.fired = t.fired || false;
                if (last._remainLabel) last._remainLabel.textContent = _clock_format_timer_ms(last.remainingMs);
                if (last.running && last._startBtn) {
                    last._startBtn.textContent = "Pause";
                    last._startBtn.style.background = "#ef5350";
                }
            }
        });
    } catch (e) {
        // ignore corrupt data
    }
}

// ─── 1s Tick ─────────────────────────────────────────────────────────────────

function _clock_tick() {
    const now = new Date();

    // Clock tab
    if (_clock_timeEl) {
        _clock_timeEl.textContent =
            String(now.getHours()).padStart(2, "0") + ":" +
            String(now.getMinutes()).padStart(2, "0") + ":" +
            String(now.getSeconds()).padStart(2, "0");
    }
    if (_clock_dateEl) {
        _clock_dateEl.textContent = now.toLocaleDateString(undefined, {
            weekday: "long", year: "numeric", month: "long", day: "numeric"
        });
    }

    // Alarm check
    const hhmm = String(now.getHours()).padStart(2, "0") + ":" +
                 String(now.getMinutes()).padStart(2, "0");
    const minuteKey = now.getFullYear() + "-" + now.getMonth() + "-" +
                      now.getDate() + "-" + now.getHours() + "-" + now.getMinutes();

    for (let i = 0; i < clockAlarms.length; i++) {
        const a = clockAlarms[i];
        if (a.enabled && a.time === hhmm && a.firedAt !== minuteKey) {
            a.firedAt = minuteKey;
            _clock_save_alarms();
            _clock_fire_notification("Alarm", a.message || ("Alarm " + a.id));
        }
    }

    // Timer countdown
    let _timerDirty = false;
    for (let i = 0; i < clockTimers.length; i++) {
        const t = clockTimers[i];
        if (!t.running || t.fired) continue;
        _timerDirty = true;
        t.remainingMs -= 1000;
        if (t.remainingMs <= 0) {
            t.remainingMs = 0;
            t.running = false;
            t.fired = true;
            if (t._startBtn) {
                t._startBtn.textContent = "Start";
                t._startBtn.style.background = "#4fc3f7";
            }
            _clock_fire_notification("Timer", t.message || ("Timer " + t.id));
        }
        if (t._remainLabel) {
            t._remainLabel.textContent = _clock_format_timer_ms(t.remainingMs);
        }
    }
    if (_timerDirty) _clock_save_timers();
}

// ─── Notifications ───────────────────────────────────────────────────────────

function _clock_fire_notification(type, message) {
    service_toast_show(message, {
        title: type,
        icon: type === "Alarm" ? "⏰" : "⏱️",
        duration: 5000
    });
    _clock_play_alarm();
}

async function _clock_play_alarm() {
    try {
        if (!_clockAudioCache) {
            if (typeof service_fs_get === "function") {
                const file = await service_fs_get("alarm.wav");
                if (file) _clockAudioCache = file.dataUrl;
            }
        }
        if (_clockAudioCache) {
            const audio = new Audio(_clockAudioCache);
            audio.play();
            setTimeout(function () { audio.pause(); audio.currentTime = 0; }, 5000);
        }
    } catch (e) {
        // Silently fail if audio unavailable
    }
}

// ─── Shell API ───────────────────────────────────────────────────────────────

function _clock_rebuild_shell() {
    if (typeof shell === "undefined") return;

    var ns = {};

    ns.help = function () {
        return "shell.clock — Clock, alarms, timers, stopwatch\n\n" +
            "Methods:\n" +
            "  show() / hide() / isVisible()    — Window controls.\n" +
            "  addAlarm()                        — Add a new alarm.\n" +
            "  removeAlarm('alarm1')             — Remove alarm by name.\n" +
            "  addTimer()                        — Add a new countdown timer.\n" +
            "  removeTimer('timer1')             — Remove timer by name.\n" +
            "  startStopwatch() / stopStopwatch() / resetStopwatch() / lapStopwatch()\n" +
            "  getStopwatchElapsed()             — Elapsed ms.\n\n" +
            "Dynamic sub-objects (after adding):\n" +
            "  shell.clock.alarm1.setTime('14:30')\n" +
            "  shell.clock.alarm1.setMessage('Meeting')\n" +
            "  shell.clock.alarm1.setEnabled(true)\n" +
            "  shell.clock.timer1.setMinutes(5)\n" +
            "  shell.clock.timer1.start() / pause() / reset()\n" +
            "  shell.clock.timer1.getRemaining()  — remaining ms\n\n" +
            "Recipes:\n" +
            "  // Set a 5-minute timer:\n" +
            "  shell.clock.addTimer()\n" +
            "  // Then inspect: console.dir(shell.clock) to find timer1\n" +
            "  shell.clock.timer1.setMinutes(5)\n" +
            "  shell.clock.timer1.start()";
    };

    // Window controls
    ns.show      = function () { component_clock_launch(); };
    ns.hide      = function () { if (clockServiceWindow) clockServiceWindow.hide(); };
    ns.isVisible = function () { return clockServiceWindow ? clockServiceWindow.visible : false; };

    // Alarm management
    ns.addAlarm = function () {
        _clock_add_alarm();
    };
    ns.removeAlarm = function (name) {
        var m = String(name).match(/^alarm(\d+)$/);
        if (!m) return;
        var idx = parseInt(m[1], 10) - 1;
        if (idx < 0 || idx >= clockAlarms.length) return;
        var alarm = clockAlarms[idx];
        clockAlarms.splice(idx, 1);
        var row = _clock_alarmList.querySelector("[data-alarm-id='" + alarm.id + "']");
        if (row) row.remove();
        _clock_save_alarms();
        _clock_rebuild_shell();
    };

    // Dynamic alarm sub-objects
    for (var ai = 0; ai < clockAlarms.length; ai++) {
        (function (alarm, idx) {
            ns["alarm" + (idx + 1)] = {
                getTime:    function ()  { return alarm.time; },
                setTime:    function (v) { alarm.time = v; if (alarm._timeInput) alarm._timeInput.value = v; alarm.firedAt = null; _clock_save_alarms(); },
                getMessage: function ()  { return alarm.message; },
                setMessage: function (v) { alarm.message = v; if (alarm._msgInput) alarm._msgInput.value = v; _clock_save_alarms(); },
                isEnabled:  function ()  { return alarm.enabled; },
                setEnabled: function (b) { alarm.enabled = !!b; if (alarm._enableCb) alarm._enableCb.checked = !!b; alarm.firedAt = null; _clock_save_alarms(); }
            };
        })(clockAlarms[ai], ai);
    }

    // Stopwatch
    ns.startStopwatch = function () {
        if (!clockSwRunning) _clock_sw_toggle();
    };
    ns.stopStopwatch = function () {
        if (clockSwRunning) _clock_sw_toggle();
    };
    ns.resetStopwatch = function () {
        _clock_sw_reset();
    };
    ns.lapStopwatch = function () {
        _clock_sw_lap();
    };
    ns.getStopwatchElapsed = function () {
        if (clockSwRunning) return clockSwElapsed + (performance.now() - clockSwStartTime);
        return clockSwElapsed;
    };

    // Timer management
    ns.addTimer = function () {
        _clock_add_timer();
    };
    ns.removeTimer = function (name) {
        var m = String(name).match(/^timer(\d+)$/);
        if (!m) return;
        var idx = parseInt(m[1], 10) - 1;
        if (idx < 0 || idx >= clockTimers.length) return;
        var timer = clockTimers[idx];
        clockTimers.splice(idx, 1);
        var row = _clock_timerList.querySelector("[data-timer-id='" + timer.id + "']");
        if (row) row.remove();
        _clock_save_timers();
        _clock_rebuild_shell();
    };

    // Dynamic timer sub-objects
    for (var ti = 0; ti < clockTimers.length; ti++) {
        (function (timer, idx) {
            ns["timer" + (idx + 1)] = {
                getHours:     function ()  { return timer.hours; },
                setHours:     function (v) { timer.hours = parseInt(v) || 0; if (timer._hInput) timer._hInput.value = timer.hours; if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000; },
                getMinutes:   function ()  { return timer.minutes; },
                setMinutes:   function (v) { timer.minutes = parseInt(v) || 0; if (timer._mInput) timer._mInput.value = timer.minutes; if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000; },
                getSeconds:   function ()  { return timer.seconds; },
                setSeconds:   function (v) { timer.seconds = parseInt(v) || 0; if (timer._sInput) timer._sInput.value = timer.seconds; if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000; },
                getMessage:   function ()  { return timer.message; },
                setMessage:   function (v) { timer.message = v; if (timer._msgInput) timer._msgInput.value = v; },
                start:        function ()  { if (!timer.running) { if (timer.remainingMs <= 0) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000; if (timer.remainingMs > 0) { timer.running = true; timer.fired = false; if (timer._startBtn) { timer._startBtn.textContent = "Pause"; timer._startBtn.style.background = "#ef5350"; } } } },
                pause:        function ()  { if (timer.running) { timer.running = false; if (timer._startBtn) { timer._startBtn.textContent = "Start"; timer._startBtn.style.background = "#4fc3f7"; } } },
                reset:        function ()  { timer.running = false; timer.fired = false; timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000; if (timer._remainLabel) timer._remainLabel.textContent = _clock_format_timer_ms(timer.remainingMs); if (timer._startBtn) { timer._startBtn.textContent = "Start"; timer._startBtn.style.background = "#4fc3f7"; } },
                getRemaining: function ()  { return timer.remainingMs; }
            };
        })(clockTimers[ti], ti);
    }

    shell.clock = ns;
}

// ─── Framework Lifecycle ─────────────────────────────────────────────────────

function component_clock_handle_init() {
    ServiceWindow.registerApp("clock_app", component_clock_launch);

    framework_taskbar_register_tray_app({
        appName: "clock_app",
        label:   "Clock",
        icon:    CLOCK_ICON_SVG,
        title:   "Clock",
        onClick: function (btn) {
            if (!clockContainer) component_clock_create();
            clockServiceWindow._toggleFromTray(btn);
        },
        onAdopt: function (btn) {
            if (clockServiceWindow) {
                clockServiceWindow._adoptTrayButton(btn, null);
            }
        }
    });
}

// ===== src/component_codecheck.js =====
// -----------------------------------------------------------------------------
// component_codecheck.js — code review via ChatGPT with structured-JSON
// response parsing and ⭐ marker insertion.
// -----------------------------------------------------------------------------

/* ---- Codecheck-owned state ---- */

const MARKER_CHAR = "⭐";
let checkCache = { hash: null, parsed: null, body: "" };

const CODE_CHECK_PROMPT = `Review the following code. Respond ONLY with a JSON object (no markdown, no fences, no extra text) in this exact format:

{
  "correct": true or false,
  "solves_problem": true or false,
  "summary": "one-line description of what the code does",
  "issues": ["issue 1", "issue 2"] or [] if none,
  "suggestions": ["suggestion 1"] or [] if none,
  "markers": [{"line": 1, "fixed": "corrected line content", "issue": "short reason"}] or [] if none
}

markers: for each issue you can pinpoint to a specific line, include:
- "line": the 1-based line number (use the "N> " prefix numbers shown below)
- "fixed": the corrected version of that line (just the code, without the "N> " prefix). Make minimal changes — only fix what is wrong.
- "issue": a short description of the problem

Each line in the code below is prefixed with its line number as "N> " (e.g. "1> ", "2> "). Use these numbers directly for the "line" field. The "fixed" field must NOT include the line number prefix.

Here is the code:
\`\`\`
`;

function insertMarkers(ta, markers) {

    if (!markers || !markers.length) return;

    const valid = markers.filter(m => m.line && typeof m.fixed === "string");
    if (!valid.length) return;

    const lines = ta.value.split("\n");

    valid.forEach(m => {

        const lineIdx = m.line - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) return;

        const original = lines[lineIdx];
        const fixed = m.fixed;

        const origTrimmed = original.replace(/^[ \t]*/, "");
        const fixedTrimmed = fixed.replace(/^[ \t]*/, "");
        const indent = original.length - origTrimmed.length;

        let diffPos = 0;
        while (diffPos < origTrimmed.length && diffPos < fixedTrimmed.length && origTrimmed[diffPos] === fixedTrimmed[diffPos]) {
            diffPos++;
        }

        if (diffPos === origTrimmed.length && diffPos === fixedTrimmed.length) return;

        const insertAt = indent + diffPos;
        lines[lineIdx] = original.substring(0, insertAt) + MARKER_CHAR + original.substring(insertAt);
    });

    ta.value = lines.join("\n");
    ta.dispatchEvent(new Event("input"));
}

function removeMarkerAtCursor(ta) {

    const val = ta.value;
    const cur = ta.selectionStart;

    if (val[cur] === MARKER_CHAR) {
        ta.value = val.substring(0, cur) + val.substring(cur + 1);
        ta.selectionStart = ta.selectionEnd = cur;
        ta.dispatchEvent(new Event("input"));
        return true;
    }

    if (cur > 0 && val[cur - 1] === MARKER_CHAR) {
        ta.value = val.substring(0, cur - 1) + val.substring(cur);
        ta.selectionStart = ta.selectionEnd = cur - 1;
        ta.dispatchEvent(new Event("input"));
        return true;
    }

    return false;
}

function clearAllMarkers(ta) {

    if (ta.value.indexOf(MARKER_CHAR) === -1) return;
    const cur = ta.selectionStart;
    ta.value = ta.value.split(MARKER_CHAR).join("");
    ta.selectionStart = ta.selectionEnd = Math.min(cur, ta.value.length);
    ta.dispatchEvent(new Event("input"));
}

function handleCodeCheck() {

    if (!textarea) return;

    const activeTA = document.activeElement;
    const isEditor = (activeTA === textarea || activeTA === leftTA || activeTA === rightTA);
    if (!isEditor && !lastFocusedTA) return;

    if (editorServiceWindow.mode === "maximized") {
        clearAllMarkers(leftTA);
        clearAllMarkers(rightTA);
        redistributeColumns();
    } else {
        clearAllMarkers(textarea);
    }

    const code = editorServiceWindow.mode === "maximized"
        ? mergeColumnContent().trim()
        : textarea.value.trim();

    if (!code) {
        alert("Editor is empty — nothing to check.");
        return;
    }

    const hash = simpleHash(code);

    if (hash === checkCache.hash && checkCache.parsed) {
        showResultDialog("Code Check Result (cached)", checkCache.body);
        if (checkCache.parsed.markers && checkCache.parsed.markers.length) {
            if (editorServiceWindow.mode === "maximized") {
                textarea.value = mergeColumnContent();
                insertMarkers(textarea, checkCache.parsed.markers);
                const lines = textarea.value.split("\n");
                const lpc = getLinesPerCol();
                leftTA.value = lines.slice(0, lpc).join("\n");
                rightTA.value = lines.slice(lpc).join("\n");
                saveMergedContent();
            } else {
                insertMarkers(textarea, checkCache.parsed.markers);
            }
        }
        return;
    }

    const numberedCode = code.split("\n").map((line, i) => (i + 1) + "> " + line).join("\n");

    const onstart = (ctx) => {
        showWaitingUI();
    };

    const onend = (ctx) => {
        hideWaitingUI();

        if (ctx.cancelled || ctx.error) return;

        const response = ctx.result;
        if (!response) return;

        let parsed = null;

        try {

            const cleaned = response
                .replace(/^```[\w]*\n?/gm, "")
                .replace(/```\s*$/gm, "")
                .trim();

            parsed = JSON.parse(cleaned);

        } catch (e) {

            showResultDialog("Code Check — Raw Response", response);
            return;
        }

        const correct = parsed.correct ? "✅ Yes" : "❌ No";
        const solves = parsed.solves_problem ? "✅ Yes" : "❌ No";

        const issueList = parsed.issues && parsed.issues.length
            ? parsed.issues.map((s, i) => "  " + (i + 1) + ". " + s).join("\n")
            : "  None";

        const suggestionList = parsed.suggestions && parsed.suggestions.length
            ? parsed.suggestions.map((s, i) => "  " + (i + 1) + ". " + s).join("\n")
            : "  None";

        const body =
            "Correct: " + correct + "\n" +
            "Solves the problem: " + solves + "\n\n" +
            "Summary:\n  " + parsed.summary + "\n\n" +
            "Issues:\n" + issueList + "\n\n" +
            "Suggestions:\n" + suggestionList;

        checkCache = { hash: hash, parsed: parsed, body: body };

        showResultDialog("Code Check Result", body);

        if (parsed.markers && parsed.markers.length) {

            if (editorServiceWindow.mode === "maximized") {
                textarea.value = mergeColumnContent();
                insertMarkers(textarea, parsed.markers);
                const lines = textarea.value.split("\n");
                const lpc = getLinesPerCol();
                leftTA.value = lines.slice(0, lpc).join("\n");
                rightTA.value = lines.slice(lpc).join("\n");
                saveMergedContent();
            } else {
                insertMarkers(textarea, parsed.markers);
            }
        }
    };

    submitMessage(CODE_CHECK_PROMPT + numberedCode + "\n```", onstart, onend);
}

// ===== src/component_columns.js =====
// -----------------------------------------------------------------------------
// component_columns.js — two-column layout (maximized mode).
// -----------------------------------------------------------------------------

/* ---- Column-owned state ----
   Constructed by createEditor() in component_window.js, but the redistribute /
   merge / sync logic lives here, so the declarations belong here. */

let columnContainer;  // flex wrapper for the two column textareas
let leftTA;           // left textarea
let rightTA;          // right textarea
let syncing = false;  // guard against recursive input during redistribution

function getLinesPerCol() {
    const containerH = container.offsetHeight - headerEl.offsetHeight;
    return Math.max(1, Math.floor((containerH - 20) / 18));
}

function mergeColumnContent() {
    if (!rightTA.value) return leftTA.value;
    return leftTA.value + "\n" + rightTA.value;
}

function saveMergedContent() {
    const merged = mergeColumnContent();
    textarea.value = merged;
    localStorage.setItem("tm_editor_content", merged);
}

function redistributeColumns() {

    if (syncing) return;
    syncing = true;

    const focused = document.activeElement;
    const focusedIsLeft = (focused === leftTA);
    const focusedIsRight = (focused === rightTA);
    const savedCursor = focused ? focused.selectionStart : 0;
    const savedSelEnd = focused ? focused.selectionEnd : 0;

    const all = mergeColumnContent();
    const lines = all.split("\n");
    const lpc = getLinesPerCol();

    const leftText = lines.slice(0, lpc).join("\n");
    const rightText = lines.slice(lpc).join("\n");

    if (leftTA.value !== leftText) leftTA.value = leftText;
    if (rightTA.value !== rightText) rightTA.value = rightText;

    if (focusedIsLeft) {
        leftTA.selectionStart = Math.min(savedCursor, leftTA.value.length);
        leftTA.selectionEnd = Math.min(savedSelEnd, leftTA.value.length);
    } else if (focusedIsRight) {
        rightTA.selectionStart = Math.min(savedCursor, rightTA.value.length);
        rightTA.selectionEnd = Math.min(savedSelEnd, rightTA.value.length);
    }

    saveMergedContent();
    syncing = false;
}

function enterMaximizedColumnLayout() {

    textarea.style.display = "none";

    const lines = textarea.value.split("\n");
    const lpc = getLinesPerCol();

    leftTA.value = lines.slice(0, lpc).join("\n");
    rightTA.value = lines.slice(lpc).join("\n");

    columnContainer.style.display = "flex";
    leftTA.focus();
}

function exitMaximizedColumnLayout() {

    textarea.value = mergeColumnContent();
    localStorage.setItem("tm_editor_content", textarea.value);

    columnContainer.style.display = "none";
    textarea.style.display = "block";
}

// ===== src/component_console.js =====
// -----------------------------------------------------------------------------
// component_console.js — terminal-style REPL window. Black background, mono
// font, colored output. Each line is eval'd at page scope (indirect eval, so
// it runs in global scope — has access to window, localStorage, etc.).
//
// Features:
//   - Command history (Up / Down).
//   - Captured console.log / .info / .warn / .error / .dir during eval, each
//     rendered in a distinct color.
//   - Return value of the expression is shown in cyan (REPL-style).
//   - Thrown errors shown in red with stack.
//   - `clear` / `cls` clears the buffer. Ctrl+L also clears.
//
// Registered as a tray app ("console"), modeled on component_calc.js.
// -----------------------------------------------------------------------------

let consoleServiceWindow = null;
let consoleContainer     = null;
let consoleOutputEl      = null;
let consoleInputEl       = null;
let consoleHistory       = [];
let consoleHistoryIdx    = -1;
let consoleAiMode        = false;
let consoleAiRunning     = false;

/* DOM refs for the AI control bar */
let _console_aiSpinner   = null;
let _console_aiCancelBtn = null;
let _console_aiAbort     = null;   // AbortController for the current AI job

/* Terminal-ish SVG: monitor with a `>_` prompt. */
const CONSOLE_ICON_SVG =
    "<svg width='14' height='14' viewBox='0 0 14 14' " +
    "xmlns='http://www.w3.org/2000/svg' style='display:block'>" +
        "<rect x='1' y='2' width='12' height='9' rx='1' " +
        "fill='none' stroke='currentColor' stroke-width='1'/>" +
        "<path d='M3.2 5.2 L5.2 6.6 L3.2 8' " +
        "fill='none' stroke='currentColor' stroke-width='1.1' " +
        "stroke-linecap='round' stroke-linejoin='round'/>" +
        "<rect x='6' y='8' width='4' height='1' fill='currentColor'/>" +
    "</svg>";

function component_console_launch() {
    if (!consoleContainer) component_console_create();
    consoleServiceWindow.show();
    /* Focus input on launch for a true terminal feel. */
    setTimeout(() => { if (consoleInputEl) consoleInputEl.focus(); }, 0);
}

function component_console_create() {

    const trayBtn = framework_taskbar_get_tray_button("console");

    consoleServiceWindow = new ServiceWindow();
    consoleServiceWindow.create({
        appName: "console",
        width:  560,
        height: 360,
        isDraggable: () => true,
        isResizable: () => true,
        trayButton: trayBtn
    });

    consoleServiceWindow.registerTab({ id: "console", label: "Console" });
    consoleServiceWindow.appendControls();

    consoleContainer = consoleServiceWindow.container;

    /* Body — flex column, no padding, full bleed black. */
    const body = consoleServiceWindow.createBody({
        padding: "0",
        gap: "0",
        style: {
            background: "#000",
            color: "#d0d0d0",
            fontFamily: "Consolas, 'Courier New', monospace",
            fontSize: "12.5px"
        }
    });

    /* Output area — scrollable, fills remaining height. */
    const out = document.createElement("div");
    Object.assign(out.style, {
        flex: "1",
        overflowY: "auto",
        padding: "8px 10px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        lineHeight: "1.4"
    });
    consoleOutputEl = out;

    /* Input row — `>` prompt + textbox. */
    const inputRow = document.createElement("div");
    Object.assign(inputRow.style, {
        display: "flex",
        alignItems: "center",
        borderTop: "1px solid #222",
        background: "#0a0a0a",
        padding: "4px 8px"
    });

    const prompt = document.createElement("span");
    prompt.textContent = "> ";
    Object.assign(prompt.style, {
        color: "#4fc3f7",
        marginRight: "4px",
        fontFamily: "inherit",
        fontWeight: "bold"
    });

    /* Textarea so multi-line input (paste / Shift+Enter) just works. Enter
       submits, Shift+Enter inserts a newline. Auto-grows up to ~8 lines. */
    const input = document.createElement("textarea");
    input.spellcheck = false;
    input.autocomplete = "off";
    input.rows = 1;
    Object.assign(input.style, {
        flex: "1",
        background: "transparent",
        color: "#e0e0e0",
        border: "none",
        outline: "none",
        resize: "none",
        fontFamily: "inherit",
        fontSize: "inherit",
        padding: "2px 0",
        lineHeight: "1.4",
        maxHeight: "8.4em",
        overflowY: "auto"
    });
    consoleInputEl = input;

    /* Auto-resize the textarea as the user types/pastes multi-line text. */
    const autosize = () => {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 8 * 17) + "px";
    };
    input.addEventListener("input", autosize);

    inputRow.appendChild(prompt);
    inputRow.appendChild(input);

    /* ---- Control bar (between output and input) ---- */
    const controlBar = document.createElement("div");
    Object.assign(controlBar.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        borderTop: "1px solid #222",
        background: "#0a0a0a",
        padding: "3px 8px",
        fontSize: "11px"
    });

    /* AI-mode toggle — slide switch matching the desktop shell toggle style */
    const aiLabel = document.createElement("label");
    Object.assign(aiLabel.style, {
        display: "flex", alignItems: "center", gap: "6px",
        color: "#999", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none"
    });

    const aiInitial = localStorage.getItem("tm_console_ai_mode") === "true";
    consoleAiMode = aiInitial;

    /* Track */
    const aiTrack = document.createElement("span");
    Object.assign(aiTrack.style, {
        position: "relative",
        display: "inline-block",
        width: "30px",
        height: "16px",
        borderRadius: "8px",
        background: aiInitial ? "#4fc3f7" : "rgba(255,255,255,0.18)",
        transition: "background 150ms ease",
        flexShrink: "0"
    });

    /* Knob */
    const aiKnob = document.createElement("span");
    Object.assign(aiKnob.style, {
        position: "absolute",
        top: "2px",
        left: aiInitial ? "16px" : "2px",
        width: "12px",
        height: "12px",
        borderRadius: "50%",
        background: "white",
        transition: "left 150ms ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.4)"
    });
    aiTrack.appendChild(aiKnob);

    aiLabel.title = "Send input to AI — responds with JS commands to execute (Alt+A)";
    const _console_toggle_ai_mode = () => {
        consoleAiMode = !consoleAiMode;
        aiTrack.style.background = consoleAiMode ? "#4fc3f7" : "rgba(255,255,255,0.18)";
        aiKnob.style.left = consoleAiMode ? "16px" : "2px";
        localStorage.setItem("tm_console_ai_mode", consoleAiMode ? "true" : "false");
    };
    aiLabel.onclick = function (e) {
        e.preventDefault();
        _console_toggle_ai_mode();
    };
    service_hotkeys_register(consoleServiceWindow, "alt+a", _console_toggle_ai_mode);

    const aiText = document.createElement("span");
    aiText.textContent = "AI mode";
    aiLabel.appendChild(aiTrack);
    aiLabel.appendChild(aiText);
    controlBar.appendChild(aiLabel);

    /* Spinner — hidden by default */
    const aiSpinner = document.createElement("span");
    aiSpinner.textContent = "";
    Object.assign(aiSpinner.style, {
        color: "#c5a5ff",
        display: "none",
        fontSize: "11px"
    });
    _console_aiSpinner = aiSpinner;
    controlBar.appendChild(aiSpinner);

    /* Cancel button — hidden by default */
    const aiCancelBtn = document.createElement("button");
    aiCancelBtn.textContent = "Cancel";
    Object.assign(aiCancelBtn.style, {
        background: "#333",
        color: "#ff6b6b",
        border: "1px solid #555",
        borderRadius: "3px",
        padding: "1px 8px",
        cursor: "pointer",
        fontSize: "11px",
        display: "none"
    });
    aiCancelBtn.onclick = function () {
        if (_console_aiAbort) {
            _console_aiAbort.abort();
        }
        flushLlmQueue();
    };
    _console_aiCancelBtn = aiCancelBtn;
    controlBar.appendChild(aiCancelBtn);

    body.appendChild(out);
    body.appendChild(controlBar);
    body.appendChild(inputRow);

    /* Keydown — Enter submits (Shift+Enter inserts newline), Up/Down
       navigates history when input is single-line, Ctrl+L clears. */
    input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            const cmd = input.value;
            input.value = "";
            autosize();
            if (cmd.trim().length === 0) return;
            consoleHistory.push(cmd);
            consoleHistoryIdx = consoleHistory.length;
            if (consoleAiMode) {
                _component_console_ai_submit(cmd);
            } else {
                /* Route through the queue so textbox-typed commands and
                   programmatic submitConsoleMessage() calls share one FIFO. */
                submitConsoleMessage(cmd);
            }
        } else if (ev.key === "ArrowUp" && !input.value.includes("\n")) {
            if (consoleHistory.length === 0) return;
            ev.preventDefault();
            consoleHistoryIdx = Math.max(0, consoleHistoryIdx - 1);
            input.value = consoleHistory[consoleHistoryIdx] || "";
            autosize();
            setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
        } else if (ev.key === "ArrowDown" && !input.value.includes("\n")) {
            if (consoleHistory.length === 0) return;
            ev.preventDefault();
            consoleHistoryIdx = Math.min(consoleHistory.length, consoleHistoryIdx + 1);
            input.value = consoleHistory[consoleHistoryIdx] || "";
            autosize();
        } else if (ev.key === "l" && ev.ctrlKey) {
            ev.preventDefault();
            consoleOutputEl.innerHTML = "";
        }
    });

    /* Clicking anywhere in the output focuses the input (terminal feel). */
    out.addEventListener("click", () => {
        const sel = window.getSelection();
        /* Don't steal focus if user is selecting text. */
        if (sel && sel.toString().length === 0) input.focus();
    });

    /* Restore previously saved geometry/mode; otherwise center. */
    if (!consoleServiceWindow.restoreState()) {
        service_window_center(consoleContainer, 560, 360);
    }
}

/* Append a colored line to the output buffer and auto-scroll to bottom. */
function component_console_print(text, color) {
    if (!consoleOutputEl) return;
    const line = document.createElement("div");
    line.textContent = text;
    if (color) line.style.color = color;
    consoleOutputEl.appendChild(line);
    consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight;
}

/* Best-effort stringify — handles circular refs, DOM nodes, functions. */
function component_console_format(val) {
    if (val === undefined) return "undefined";
    if (val === null) return "null";
    const t = typeof val;
    if (t === "string") return val;
    if (t === "number" || t === "boolean" || t === "bigint" || t === "symbol")
        return String(val);
    if (t === "function") return val.toString();
    if (val instanceof Error) return val.stack || (val.name + ": " + val.message);
    if (val instanceof Node) return "<" + (val.nodeName || "node").toLowerCase() + ">";
    /* Object / array: JSON with circular guard. */
    try {
        const seen = new WeakSet();
        return JSON.stringify(val, (k, v) => {
            if (typeof v === "object" && v !== null) {
                if (seen.has(v)) return "[Circular]";
                seen.add(v);
            }
            if (typeof v === "function") return "[Function]";
            return v;
        }, 2);
    } catch (e) {
        try { return String(val); } catch (_) { return "[unprintable]"; }
    }
}

/* CSP-safe evaluator. chatgpt.com's CSP has no 'unsafe-eval', so eval()
   and new Function() throw EvalError. CSP DOES allow <script> elements
   whose nonce attribute matches the page's per-load nonce — so we steal
   the nonce off any existing script tag and inject a fresh <script>
   carrying the user's command. Result and error are smuggled out via
   globals on a unique key, then deleted.

   Tries expression-eval first (`__r = (cmd);`) so bare expressions like
   `1+2` produce a return value. If that's a syntax error (e.g. `var x=1`,
   `function f(){}`), retries with the raw command (statement form) — no
   return value, but console.* output and side-effects still happen.

   Falls back to direct eval if no nonce is found (i.e. CSP doesn't
   require one), preserving the previous behaviour outside chatgpt.com. */
function component_console_eval(cmd) {

    const nonceEl = document.querySelector("script[nonce]");
    const nonce   = nonceEl ? (nonceEl.nonce || nonceEl.getAttribute("nonce")) : null;

    if (!nonce) {
        const indirectEval = eval;
        return indirectEval(cmd);
    }

    const key   = "__tm_console_" + Math.random().toString(36).slice(2);
    const rKey  = key + "_r";
    const eKey  = key + "_e";
    const sKey  = key + "_s";   // 1 = expression form succeeded, 0 = had to fall back

    const run = (body) => {
        const s = document.createElement("script");
        s.setAttribute("nonce", nonce);
        s.textContent = body;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
    };

    /* Attempt 1: expression form — captures return value. */
    run(
        "try { window[" + JSON.stringify(rKey) + "] = (\n" + cmd + "\n);" +
        " window[" + JSON.stringify(sKey) + "] = 1; }" +
        " catch (e) { window[" + JSON.stringify(eKey) + "] = e;" +
        " window[" + JSON.stringify(sKey) + "] = 0; }"
    );

    let result = window[rKey];
    let error  = window[eKey];
    const ok   = window[sKey];

    delete window[rKey];
    delete window[eKey];
    delete window[sKey];

    if (ok === 1) return result;

    /* Attempt 2: if the expression form failed with a SyntaxError, the
       command is probably statements (var/let/function/loops). Re-run as
       a statement block — no return value, but side-effects + console.*
       still work. Non-syntax errors propagate from attempt 1. */
    if (error && error.name === "SyntaxError") {
        run(
            "try { " + cmd + " }" +
            " catch (e) { window[" + JSON.stringify(eKey) + "] = e; }"
        );
        const err2 = window[eKey];
        delete window[eKey];
        if (err2) throw err2;
        return undefined;
    }

    throw error;
}

/* Run a command: capture console.* during eval, print result/errors.
   Returns { result, error } so callers (service_console.js) can observe
   the outcome. The function ALWAYS prints the input echo and any
   output/result/error directly into the console window — caller does not
   need to print anything. Lazy-creates the window if it doesn't exist yet
   so output is visible. */
function component_console_execute(cmd) {

    /* Lazy-create the window so programmatic submitConsoleMessage() calls
       still produce visible output even if the user has never opened it. */
    if (!consoleContainer) component_console_create();

    /* Echo input — preserve newlines exactly (textContent on a div with
       white-space: pre-wrap renders \n as line breaks). Prefix only the
       first line with "> " and indent continuation lines with two spaces
       so the visual block-structure of multi-line commands is obvious. */
    const echoLines = cmd.split("\n");
    const echoText  = echoLines
        .map((line, i) => (i === 0 ? "> " : "  ") + line)
        .join("\n");
    component_console_print(echoText, "#4fc3f7");

    /* Built-in shortcuts (only meaningful for single-line commands). */
    const trimmed = cmd.trim();
    if (trimmed === "clear" || trimmed === "cls") {
        consoleOutputEl.innerHTML = "";
        return { result: undefined, error: null };
    }

    /* Patch console methods so we can color-route their output. */
    const origLog   = console.log;
    const origInfo  = console.info;
    const origWarn  = console.warn;
    const origError = console.error;
    const origDir   = console.dir;

    const fmtArgs = (args) =>
        Array.prototype.map.call(args, component_console_format).join(" ");

    console.log   = function () { component_console_print(fmtArgs(arguments), "#d0d0d0"); origLog.apply(console, arguments); };
    console.info  = function () { component_console_print(fmtArgs(arguments), "#9ecbff"); origInfo.apply(console, arguments); };
    console.warn  = function () { component_console_print(fmtArgs(arguments), "#f0c674"); origWarn.apply(console, arguments); };
    console.error = function () { component_console_print(fmtArgs(arguments), "#ff6b6b"); origError.apply(console, arguments); };
    console.dir   = function () { component_console_print(fmtArgs(arguments), "#c5e478"); origDir.apply(console, arguments); };

    let result, threw = false, err;
    try {
        result = component_console_eval(cmd);
    } catch (e) {
        threw = true;
        err = e;
    } finally {
        console.log   = origLog;
        console.info  = origInfo;
        console.warn  = origWarn;
        console.error = origError;
        console.dir   = origDir;
    }

    if (threw) {
        const msg = (err && err.stack) ? err.stack : String(err);
        component_console_print(msg, "#ff6b6b");
        return { result: undefined, error: err };
    }

    /* Show return value (skip for plain undefined to keep things quiet, like
       browser devtools does for statements). */
    if (result !== undefined) {
        component_console_print(component_console_format(result), "#7ee787");
    }

    return { result, error: null };
}

/* ---- Shell introspection for AI context ---- */

/* Walk an object and produce a compact description of its API surface.
   maxDepth prevents infinite recursion on circular refs. */
function _console_describe_obj(obj, depth, maxDepth) {
    if (depth >= maxDepth) return "...";
    if (obj === null || obj === undefined) return String(obj);
    var t = typeof obj;
    if (t === "function") return "function()";
    if (t !== "object") return t;

    var keys = [];
    try { keys = Object.keys(obj); } catch (e) { return "{...}"; }
    if (keys.length === 0) return "{}";

    var parts = [];
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k.charAt(0) === "_") continue;  // skip private
        var v;
        try { v = obj[k]; } catch (e) { v = "[error]"; }
        parts.push(k + ": " + _console_describe_obj(v, depth + 1, maxDepth));
    }
    return "{ " + parts.join(", ") + " }";
}

function _console_get_shell_description() {
    if (typeof shell === "undefined") return "(shell object not available)";
    return _console_describe_obj(shell, 0, 3);
}

/* ---- Agentic AI loop ---- */

const _CONSOLE_AI_MAX_TURNS = 20;

/* Execute a single command, capturing console.* output as strings.
   Returns { result, error, logs[] }. */
function _console_ai_exec_capturing(cmd) {
    var logs = [];

    var origLog   = console.log;
    var origInfo  = console.info;
    var origWarn  = console.warn;
    var origError = console.error;
    var origDir   = console.dir;

    var fmtArgs = function (args) {
        return Array.prototype.map.call(args, component_console_format).join(" ");
    };

    console.log   = function () { var s = fmtArgs(arguments); logs.push(s); component_console_print(s, "#d0d0d0"); origLog.apply(console, arguments); };
    console.info  = function () { var s = fmtArgs(arguments); logs.push(s); component_console_print(s, "#9ecbff"); origInfo.apply(console, arguments); };
    console.warn  = function () { var s = fmtArgs(arguments); logs.push(s); component_console_print(s, "#f0c674"); origWarn.apply(console, arguments); };
    console.error = function () { var s = fmtArgs(arguments); logs.push(s); component_console_print(s, "#ff6b6b"); origError.apply(console, arguments); };
    console.dir   = function () { var s = fmtArgs(arguments); logs.push(s); component_console_print(s, "#c5e478"); origDir.apply(console, arguments); };

    var result, threw = false, err;
    try {
        result = component_console_eval(cmd);
    } catch (e) {
        threw = true;
        err = e;
    } finally {
        console.log   = origLog;
        console.info  = origInfo;
        console.warn  = origWarn;
        console.error = origError;
        console.dir   = origDir;
    }

    if (threw) {
        var msg = (err && err.stack) ? err.stack : String(err);
        component_console_print(msg, "#ff6b6b");
        logs.push("ERROR: " + msg);
        return { result: undefined, error: err, logs: logs };
    }

    if (result !== undefined) {
        var formatted = component_console_format(result);
        component_console_print(formatted, "#7ee787");
        logs.push("=> " + formatted);
    }

    return { result: result, error: null, logs: logs };
}

/* AI mode — agentic loop. Sends user request to ChatGPT with shell context.
   AI responds with JSON { commands, isFinal }. Commands are executed, output
   is fed back if isFinal is false. Loops up to _CONSOLE_AI_MAX_TURNS. */
function _component_console_ai_submit(userText) {
    if (consoleAiRunning) {
        component_console_print("[AI] Already waiting for a response…", "#f0c674");
        return;
    }

    if (!consoleContainer) component_console_create();

    component_console_print("[AI] " + userText, "#c5a5ff");
    consoleAiRunning = true;
    _console_ai_show_waiting(true);

    /* Spinner animation */
    var frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
    var frameIdx = 0;
    var spinTimer = setInterval(function () {
        if (_console_aiSpinner) {
            _console_aiSpinner.textContent = frames[frameIdx] + " Thinking…";
        }
        frameIdx = (frameIdx + 1) % frames.length;
    }, 80);

    _console_aiAbort = new AbortController();
    var cancelled = false;

    /* Listen for abort */
    _console_aiAbort.signal.addEventListener("abort", function () {
        cancelled = true;
    });

    var shellDesc = _console_get_shell_description();

    var systemPrompt =
        "You are a JS console agent. The user describes a task in plain English. " +
        "You respond ONLY with a JSON object wrapped in a ```json code fence:\n" +
        '```json\n{"commands": ["cmd1", "cmd2"], "isFinal": true}\n```\n\n' +
        "Rules:\n" +
        "- commands: array of JavaScript expressions to eval in the browser console.\n" +
        "- CRITICAL VARIABLE RULE: Each command runs in its own fresh scope. Variables (const/let/var) " +
        "declared in one command DO NOT EXIST in subsequent commands. NEVER declare variables.\n" +
        "  BAD:  {\"commands\": [\"const id = shell.browser.newTab('https://x.com','X')\", \"shell.sessionConsole.getTabById(1).attachToBrowserTab(id)\"]}\n" +
        "  GOOD: {\"commands\": [\"shell.browser.newTab('https://x.com','X')\"], \"isFinal\": false}  → read output (e.g. 42) → " +
        "{\"commands\": [\"shell.sessionConsole.getTabById(1).attachToBrowserTab(42)\"], \"isFinal\": true}\n" +
        "  ALSO GOOD: nested calls — shell.sessionConsole.getTabById(shell.sessionConsole.newTab('X')).attachToBrowserTab(shell.browser.newTab('https://x.com','X'))\n" +
        "- isFinal: true if the task is done after these commands. false if you need to see the output to decide next steps.\n" +
        "- Do NOT use semicolons at the end of statements.\n" +
        "- Use console.log() for output the user should see.\n" +
        "- NEVER put multiple statements separated by newlines in a single command string.\n" +
        "\nStrict command syntax rules:\n" +
        "- Every entry in commands MUST be valid standalone JavaScript when eval'd.\n" +
        "- Before responding, mentally verify that every command parses as valid JS independently.\n" +
        "- String literals inside commands must be properly quoted and escaped for JSON encoding.\n" +
        "- Prefer single quotes or escaped double quotes inside command strings since the commands array uses double-quote JSON strings.\n" +
        "- Template literals (backticks) work well inside JSON strings and are preferred for interpolation.\n" +
        '  e.g. {"commands":["console.log(`Result: ${1+2}`)"],"isFinal":true}\n' +
        "- Do NOT produce commands that would be a syntax error in isolation (e.g. dangling brackets, unclosed strings).\n" +
        "- Each command is eval'd separately — do NOT split a single statement across multiple commands.\n" +
        "\nShell & discovery:\n" +
        "- CRITICAL: Before using any shell namespace, call its help() method first (e.g. shell.browser.help(), " +
        "shell.sessionConsole.help()) to learn available methods and recipes. Call shell.help() for an overview of all namespaces.\n" +
        "- CRITICAL: If you do not know the exact signature of a function (e.g. addAlarm(), addTimer(), setTime()), " +
        "you MUST inspect it first with console.dir(<fn>) before invoking it. " +
        "All functions, if not used with the correct arguments, can produce unintended or disastrous side effects. " +
        "Never guess parameters — always discover first, then invoke.\n" +
        "- IMPORTANT: When you are unsure about an object's API, use console.dir(obj) to inspect it first (with isFinal: false) before calling methods. " +
        "For example, console.dir(shell.clock) will show you all available methods and sub-objects. " +
        "This is especially useful for dynamically-built namespaces where the exact method signatures may vary.\n" +
        "- The page has a global `shell` object for app automation.\n" +
        "- Current shell API:\n" + shellDesc + "\n\n" +
        "- Each app namespace (e.g. shell.clock, shell.calc) is built dynamically by the app. " +
        "Use shell.list() to see available apps. Use console.dir(shell.<appName>) to discover the full API of any app before using it.\n" +
        "- The shell object populates dynamically. Launching an app (e.g. shell.launcher.calc(), shell.clock.show()) " +
        "causes that app to build its namespace on shell — new keys and sub-objects appear that did not exist before the launch. " +
        "Similarly, mutating state (e.g. addAlarm(), addTimer()) creates new sub-objects (shell.clock.alarm1, shell.clock.timer1). " +
        "After launching an app or mutating state, always re-inspect with console.dir() to discover the newly available API.\n" +
        "\nBrowser + Session Console workflow:\n" +
        "- To execute JS on a webpage, follow these steps:\n" +
        "  1. shell.browser.newTab('https://example.com', 'My Tab') → returns a browser tab ID (number)\n" +
        "  2. shell.sessionConsole.newTab('My Session') → returns a session console tab ID (number)\n" +
        "  3. Find the browser tab ID: shell.browser.listTabs() → [{id, name, url}]\n" +
        "  4. Attach: shell.sessionConsole.getTabById(<consoleTabId>).attachToBrowserTab(<browserTabId>)\n" +
        "  5. Now shell.sessionConsole.submit(<consoleTabId>, 'document.title') executes inside that page's iframe\n" +
        "- To attach to an existing browser tab, use shell.browser.listTabs() to find its ID first.\n" +
        "- After attaching, all submit() calls on that console tab run inside the browser tab's iframe DOM.\n" +
        "- Maximum " + _CONSOLE_AI_MAX_TURNS + " turns allowed.\n";

    var conversation = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
    ];

    _console_ai_loop(conversation, 0, spinTimer, cancelled);
}

function _console_ai_loop(conversation, turn, spinTimer, cancelled) {

    if (cancelled) {
        _console_ai_finish(spinTimer, "Cancelled.");
        return;
    }

    if (turn >= _CONSOLE_AI_MAX_TURNS) {
        _console_ai_finish(spinTimer, "Reached max " + _CONSOLE_AI_MAX_TURNS + " turns.");
        return;
    }

    /* Build the prompt from conversation history. For the LLM service
       (which is ChatGPT DOM automation), we flatten the conversation
       into a single prompt string. */
    var prompt = "";
    for (var i = 0; i < conversation.length; i++) {
        var msg = conversation[i];
        if (msg.role === "system") {
            prompt += msg.content + "\n\n";
        } else if (msg.role === "user") {
            prompt += "User: " + msg.content + "\n\n";
        } else if (msg.role === "assistant") {
            prompt += "Assistant: " + msg.content + "\n\n";
        } else if (msg.role === "output") {
            prompt += "Command output:\n" + msg.content + "\n\n";
        }
    }

    component_console_print("[AI] Turn " + (turn + 1) + "/" + _CONSOLE_AI_MAX_TURNS + "…", "#888");

    submitMessage(
        prompt,
        function () { /* onstart */ },
        function (ctx) {
            if (_console_aiAbort && _console_aiAbort.signal.aborted) {
                _console_ai_finish(spinTimer, "Cancelled.");
                return;
            }

            if (ctx.cancelled) {
                _console_ai_finish(spinTimer, "Cancelled.");
                return;
            }
            if (ctx.error) {
                _console_ai_finish(spinTimer, "Error: " + String(ctx.error));
                return;
            }

            var raw = (ctx.result || "").trim();
            if (!raw) {
                _console_ai_finish(spinTimer, "Empty response.");
                return;
            }

            /* Strip markdown fences if present */
            raw = raw.replace(/^```(?:json|javascript|js)?\s*\n?/i, "")
                     .replace(/\n?```\s*$/, "")
                     .trim();

            /* Parse JSON response */
            var parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                /* If not valid JSON, try to execute as raw JS (fallback) */
                component_console_print("[AI] Response (not JSON, executing as JS):", "#f0c674");
                component_console_print(raw, "#9ecbff");
                submitConsoleMessage(raw);
                _console_ai_finish(spinTimer, "Done (fallback mode).");
                return;
            }

            var commands = parsed.commands || [];
            var isFinal  = parsed.isFinal !== false;  // default true if missing

            /* Add assistant message to conversation */
            conversation.push({ role: "assistant", content: raw });

            if (commands.length === 0) {
                _console_ai_finish(spinTimer, "Done (no commands).");
                return;
            }

            /* Execute commands and collect output */
            var allLogs = [];
            for (var ci = 0; ci < commands.length; ci++) {
                var cmd = commands[ci];
                component_console_print("[AI cmd " + (ci + 1) + "] " + cmd, "#c5a5ff");
                var out = _console_ai_exec_capturing(cmd);
                if (out.logs.length > 0) {
                    allLogs = allLogs.concat(out.logs);
                }
            }

            if (isFinal) {
                _console_ai_finish(spinTimer, "Done.");
                return;
            }

            /* Feed output back to AI for next turn */
            var outputText = allLogs.length > 0
                ? allLogs.join("\n")
                : "(no output)";
            conversation.push({ role: "output", content: outputText });

            /* Continue the loop asynchronously */
            setTimeout(function () {
                _console_ai_loop(conversation, turn + 1, spinTimer,
                    _console_aiAbort && _console_aiAbort.signal.aborted);
            }, 0);
        }
    );
}

function _console_ai_finish(spinTimer, message) {
    clearInterval(spinTimer);
    consoleAiRunning = false;
    _console_aiAbort = null;
    _console_ai_show_waiting(false);
    component_console_print("[AI] " + message, "#f0c674");
}

/* Show/hide the spinner and cancel button in the control bar. */
function _console_ai_show_waiting(show) {
    if (_console_aiSpinner)   _console_aiSpinner.style.display   = show ? "inline" : "none";
    if (_console_aiCancelBtn) _console_aiCancelBtn.style.display = show ? "inline-block" : "none";
}

function component_console_handle_init() {
    ServiceWindow.registerApp("console", component_console_launch);

    framework_taskbar_register_tray_app({
        appName: "console",
        label:   "Console",
        icon:    CONSOLE_ICON_SVG,
        title:   "JS Console",
        onClick: (btn) => {
            if (!consoleContainer) component_console_create();
            consoleServiceWindow._toggleFromTray(btn);
            setTimeout(() => { if (consoleInputEl) consoleInputEl.focus(); }, 0);
        },
        onAdopt: (btn) => {
            if (consoleServiceWindow) {
                consoleServiceWindow._adoptTrayButton(btn, null);
            }
        }
    });
}

// ===== src/component_editor.js =====
// -----------------------------------------------------------------------------
// component_editor.js — shared editor textarea keydown handling
// (auto-indent on Enter, Tab/Shift+Tab indent, Ctrl+Z/Y dispatch,
// marker cleanup on cursor movement). Used for the main textarea AND for
// both column textareas.
// -----------------------------------------------------------------------------

/* ---- Editor-owned state ---- */

let lastFocusedTA = null; // track last focused textarea for button clicks

function attachEditorKeydown(ta) {

    ta.addEventListener("focus", () => { lastFocusedTA = ta; });

    ta.addEventListener("keyup", (e) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            removeMarkerAtCursor(ta);
        }
    });

    ta.addEventListener("mouseup", () => {
        removeMarkerAtCursor(ta);
    });

    ta.addEventListener("keydown", (e) => {

        const isEditorTA = (ta === textarea || ta === leftTA || ta === rightTA);
        if (isEditorTA && e.ctrlKey && !e.shiftKey && !e.altKey
            && service_hotkeys_is_active(editorServiceWindow)) {
            if (e.key.toLowerCase() === "z") {
                e.preventDefault();
                editorUndoRedoStack.doUndo(textarea);
                if (editorServiceWindow.mode === "maximized") {
                    const lines = textarea.value.split("\n");
                    const lpc = getLinesPerCol();
                    syncing = true;
                    leftTA.value = lines.slice(0, lpc).join("\n");
                    rightTA.value = lines.slice(lpc).join("\n");
                    syncing = false;
                }
                return;
            }
            if (e.key.toLowerCase() === "y") {
                e.preventDefault();
                editorUndoRedoStack.doRedo(textarea);
                if (editorServiceWindow.mode === "maximized") {
                    const lines = textarea.value.split("\n");
                    const lpc = getLinesPerCol();
                    syncing = true;
                    leftTA.value = lines.slice(0, lpc).join("\n");
                    rightTA.value = lines.slice(lpc).join("\n");
                    syncing = false;
                }
                return;
            }
        }

        const val = ta.value;
        const cur = ta.selectionStart;
        const sel = ta.selectionEnd;

        /* Enter — auto-indent to match current line */
        if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {

            e.preventDefault();

            const lineStart = val.lastIndexOf("\n", cur - 1) + 1;
            const lineText = val.substring(lineStart, cur);
            const indent = lineText.match(/^[ ]*/)[0];

            const before = val.substring(0, cur);
            const after = val.substring(sel);

            ta.value = before + "\n" + indent + after;

            const newPos = cur + 1 + indent.length;
            ta.selectionStart = ta.selectionEnd = newPos;

            ta.dispatchEvent(new Event("input"));
            return;
        }

        /* Tab — insert 4 spaces */
        if (e.key === "Tab" && !e.shiftKey) {

            e.preventDefault();

            const before = val.substring(0, cur);
            const after = val.substring(sel);

            ta.value = before + "    " + after;
            ta.selectionStart = ta.selectionEnd = cur + 4;

            ta.dispatchEvent(new Event("input"));
            return;
        }

        /* Shift+Tab — remove up to 4 leading spaces */
        if (e.key === "Tab" && e.shiftKey) {

            e.preventDefault();

            const lineStart = val.lastIndexOf("\n", cur - 1) + 1;
            const lineText = val.substring(lineStart);
            const leadingSpaces = lineText.match(/^[ ]*/)[0].length;
            const remove = Math.min(4, leadingSpaces);

            if (remove > 0) {

                const before = val.substring(0, lineStart);
                const after = val.substring(lineStart + remove);

                ta.value = before + after;

                const newPos = Math.max(lineStart, cur - remove);
                ta.selectionStart = ta.selectionEnd = newPos;

                ta.dispatchEvent(new Event("input"));
            }

            return;
        }
    });
}

// ===== src/component_kiosk.js =====
// -----------------------------------------------------------------------------
// component_kiosk.js — kiosk-mode UI behaviour. Invoked by handle_kiosk()
// in framework_kiosk.js when localStorage["kiosk"] === "true". Opens the
// floating editor and forces it into maximized mode so the app behaves
// like a kiosk-style single-window experience.
// -----------------------------------------------------------------------------

function component_kiosk() {

    /* 1. Open the editor dialog (lazy-create on first use, just like the
          launcher button does). */
    component_window_launch();

    /* 2. Maximize it if it isn't already. The maximize button is not held
          in a global ref, so locate it by text content within the header.
          Falls back to inlining the same state transitions performed by
          maxBtn.onclick in component_window.js if the button can't be
          found (e.g. future markup changes). */
    if (editorServiceWindow.mode !== "maximized") {
        const maxBtn = container.querySelector
            ? Array.from(container.querySelectorAll("button"))
                .find(b => b.textContent === "□")
            : null;

        if (maxBtn) {
            maxBtn.click();
        } else {
            editorServiceWindow.previousBounds = {
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
            editorServiceWindow.mode = "maximized";
            if (activeTab === "editor") enterMaximizedColumnLayout();
        }
    }

    /* If we ended up maximized (just now or already), re-split the columns
       since the launcher path does the same when restoring. */
    if (editorServiceWindow.mode === "maximized") redistributeColumns();
}

// ===== src/component_linecommand.js =====
// -----------------------------------------------------------------------------
// component_linecommand.js — inline `/p` and `/r` command execution and the
// global hotkey dispatcher (Alt+I, Alt+C, Alt+1..5, Alt+R).
// -----------------------------------------------------------------------------

function applyIndent(response, indent) {
    const lines = response.split("\n");
    let minLead = Infinity;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim().length === 0) continue;
        const lead = lines[i].match(/^[ ]*/)[0].length;
        if (lead < minLead) minLead = lead;
    }
    if (!isFinite(minLead)) minLead = 0;

    return lines.map((l, i) => {
        if (l.trim().length === 0) return indent;
        if (i === 0) return indent + l;
        return indent + l.substring(minLead);
    }).join("\n");
}

function handleLineAction() {

    if (!textarea) return;

    const activeTA = document.activeElement;
    const isEditor = (activeTA === textarea || activeTA === leftTA || activeTA === rightTA);
    const editorTA = isEditor ? activeTA : lastFocusedTA;
    if (!editorTA) return;

    const ta = (editorServiceWindow.mode === "maximized") ? editorTA : textarea;

    const cursor = ta.selectionStart;
    const text = ta.value;

    const start = text.lastIndexOf("\n", cursor - 1) + 1;
    const end = text.indexOf("\n", cursor);

    const lineEnd = end === -1 ? text.length : end;
    const line = text.substring(start, lineEnd);

    const indent = line.match(/^[ ]*/)[0];
    const trimmed = line.trimStart();

    const replaceLineWithResponse = (response) => {

        const indented = applyIndent(response, indent);

        ta.value =
            text.substring(0, start) +
            indented +
            text.substring(lineEnd);

        ta.dispatchEvent(new Event("input"));
        localStorage.setItem("tm_editor_content",
            editorServiceWindow.mode === "maximized" ? mergeColumnContent() : textarea.value);
    };

    const onstart = (ctx) => {
        showWaitingUI();
    };

    const onend = (ctx) => {
        hideWaitingUI();

        if (ctx.cancelled || ctx.error) return;
        if (ctx.result) replaceLineWithResponse(ctx.result);
    };

    if (trimmed.startsWith("/p ")) {

        const prompt = trimmed.substring(3);

        const fullContent = editorServiceWindow.mode === "maximized"
            ? mergeColumnContent()
            : textarea.value;

        const allLines = fullContent.split("\n");

        let cmdLineIdx = text.substring(0, start).split("\n").length - 1;
        if (editorServiceWindow.mode === "maximized" && ta === rightTA) {
            cmdLineIdx += leftTA.value.split("\n").length;
        }
        const cmdLineNum = cmdLineIdx + 1;

        const numberedContext = allLines.map((l, i) => {
            const num = i + 1;
            const prefix = num + "> ";
            if (num === cmdLineNum) return prefix + l + "  ◄◄◄ COMMAND LINE";
            return prefix + l;
        }).join("\n");

        const contextualPrompt =
            `You are an inline code assistant. The user has a file open in their editor and has placed a command on line ${cmdLineNum}.

The command is: ${prompt}

Respond ONLY with the text that should replace the command line. No explanations, no markdown fences, no extra text. Your response will be pasted directly into the editor at line ${cmdLineNum}, replacing the command line. The response can be multiline. If your response should have indentation, respond back with \`\`\` encapsulation.

Here is the full editor content for context (line numbers are prefixed as "N> "):
\`\`\`
${numberedContext}
\`\`\``;

        submitMessage(contextualPrompt, onstart, onend);
        return;
    }

    if (trimmed.startsWith("/r ")) {

        const prompt = trimmed.substring(3);
        submitMessage(prompt, onstart, onend);
        return;
    }

    alert(line + "\n\n— Tip: /r {prompt} = raw prompt | /p {prompt} = prompt with context\n— Tabs: Alt+1 Editor | Alt+2 Ascii | Alt+3 Question | Alt+4 Snippets | Alt+5 S-Preview\n— Alt+I = Execute command | Alt+C = Code check | Alt+R = Regenerate tab\n— More: github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey");
}

function component_linecommand_handle_init() {
    /* Hotkey wiring lives in component_window.js (service_hotkeys_register
       calls inside createEditor) so each combo is bound to the editor's
       ServiceWindow and only fires while that window is active. */
}

// ===== src/component_localstorage.js =====
// component_localstorage.js — localStorage viewer app. Shows all localStorage
// entries in a two-column key/value table. JSON values are expandable into a
// nested grid. Search filters across both keys and values.
//
// Registered with the framework launcher as "L". Lazily creates the window on
// first launch.

let lsServiceWindow = null;
let lsContainer     = null;
let lsBody          = null;
let lsSearchInput   = null;
let lsTableWrap     = null;

function component_localstorage_launch() {
    if (!lsContainer) component_localstorage_create();
    lsServiceWindow.show();
    component_localstorage_refresh();
}

function component_localstorage_create() {

    lsServiceWindow = new ServiceWindow();
    lsServiceWindow.create({
        appName:  "localstorage",
        width:  700,
        height: 500,
        shell:  shell,
        isDraggable: () => true,
        isResizable: () => true,
        minWidth: 400,
        minHeight: 250
    });

    lsServiceWindow.registerTab({ id: "ls", label: "LocalStorage" });

    lsServiceWindow.registerAction({
        label: "↻",
        title: "Refresh",
        onClick: component_localstorage_refresh
    });

    lsServiceWindow.appendControls();

    lsContainer = lsServiceWindow.container;

    /* Body */
    lsBody = lsServiceWindow.createBody({ padding: "8px", gap: "6px" });

    /* Search bar */
    lsSearchInput = lsServiceWindow.createTextbox("Search keys and values…");
    lsSearchInput.addEventListener("input", component_localstorage_refresh);
    lsBody.appendChild(lsSearchInput);

    /* Table wrapper */
    lsTableWrap = document.createElement("div");
    Object.assign(lsTableWrap.style, {
        flex: "1",
        overflow: "auto",
        border: "1px solid #333",
        borderRadius: "4px"
    });
    lsBody.appendChild(lsTableWrap);

    /* Restore previously saved geometry/mode; otherwise center. */
    if (!lsServiceWindow.restoreState()) {
        service_window_center(lsContainer, 700, 500);
    }
}

/* ---- Refresh / render ---- */

function component_localstorage_refresh() {
    if (!lsTableWrap) return;

    const filter = (lsSearchInput ? lsSearchInput.value : "").toLowerCase();

    /* Gather entries */
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        if (filter) {
            if (key.toLowerCase().indexOf(filter) === -1 &&
                val.toLowerCase().indexOf(filter) === -1) continue;
        }
        entries.push({ key, val });
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));

    /* Clear */
    lsTableWrap.innerHTML = "";

    /* Build table */
    const table = document.createElement("table");
    Object.assign(table.style, {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "12px",
        fontFamily: "Consolas, monospace",
        tableLayout: "fixed"
    });

    /* Header row */
    const thead = document.createElement("thead");
    const hrow = document.createElement("tr");
    const thKey = document.createElement("th");
    thKey.textContent = "Key";
    const thVal = document.createElement("th");
    thVal.textContent = "Value";
    [thKey, thVal].forEach((th, i) => {
        Object.assign(th.style, {
            textAlign: "left",
            padding: "6px 8px",
            borderBottom: "1px solid #444",
            background: "#2a2a2a",
            color: "#aaa",
            position: "sticky",
            top: "0",
            zIndex: "1",
            width: i === 0 ? "30%" : "70%"
        });
    });
    hrow.appendChild(thKey);
    hrow.appendChild(thVal);
    thead.appendChild(hrow);
    table.appendChild(thead);

    /* Body rows */
    const tbody = document.createElement("tbody");
    for (const entry of entries) {
        const tr = document.createElement("tr");

        /* Key cell */
        const tdKey = document.createElement("td");
        tdKey.textContent = entry.key;
        Object.assign(tdKey.style, {
            padding: "4px 8px",
            borderBottom: "1px solid #2a2a2a",
            color: "#6fc",
            verticalAlign: "top",
            wordBreak: "break-all",
            width: "30%"
        });

        /* Value cell */
        const tdVal = document.createElement("td");
        Object.assign(tdVal.style, {
            padding: "4px 8px",
            borderBottom: "1px solid #2a2a2a",
            color: "#ddd",
            verticalAlign: "top",
            width: "70%"
        });

        const parsed = _ls_try_parse_json(entry.val);
        if (parsed !== null && typeof parsed === "object") {
            tdVal.appendChild(_ls_render_json_toggle(parsed, entry.val));
        } else {
            tdVal.appendChild(_ls_render_primitive(entry.val));
        }

        tr.appendChild(tdKey);
        tr.appendChild(tdVal);

        /* Hover */
        tr.addEventListener("mouseenter", () => { tr.style.background = "#2a2a2a"; });
        tr.addEventListener("mouseleave", () => { tr.style.background = ""; });

        tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    /* Empty state */
    if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = filter ? "No matches." : "localStorage is empty.";
        Object.assign(empty.style, { color: "#666", padding: "20px", textAlign: "center" });
        lsTableWrap.appendChild(empty);
    } else {
        lsTableWrap.appendChild(table);
    }
}

/* ---- JSON helpers ---- */

function _ls_try_parse_json(str) {
    if (!str || str.length < 2) return null;
    const c = str[0];
    if (c !== "{" && c !== "[" && c !== "\"") return null;
    try { return JSON.parse(str); } catch (e) { return null; }
}

/* Render a primitive value as a colored span */
function _ls_render_primitive(val) {
    const span = document.createElement("span");
    span.style.wordBreak = "break-all";

    if (val === "true" || val === "false") {
        span.textContent = val;
        span.style.color = "#f9a825";
    } else if (val !== "" && !isNaN(val)) {
        span.textContent = val;
        span.style.color = "#ce93d8";
    } else {
        span.textContent = val;
        span.style.color = "#ddd";
    }
    return span;
}

/* Render a JSON value with a toggle: collapsed (raw string) or expanded (grid) */
function _ls_render_json_toggle(parsed, rawStr) {
    const wrap = document.createElement("div");

    const toggle = document.createElement("span");
    toggle.textContent = "▶ JSON";
    Object.assign(toggle.style, {
        color: "#4fc3f7",
        cursor: "pointer",
        fontSize: "11px",
        marginRight: "6px",
        userSelect: "none"
    });

    const preview = document.createElement("span");
    const previewText = rawStr.length > 80 ? rawStr.substring(0, 80) + "…" : rawStr;
    preview.textContent = previewText;
    Object.assign(preview.style, {
        color: "#888",
        fontSize: "11px",
        wordBreak: "break-all"
    });

    const detail = document.createElement("div");
    detail.style.display = "none";
    Object.assign(detail.style, {
        marginTop: "4px",
        maxHeight: "300px",
        overflow: "auto"
    });

    let expanded = false;
    let built = false;

    toggle.addEventListener("click", () => {
        expanded = !expanded;
        if (expanded) {
            toggle.textContent = "▼ JSON";
            preview.style.display = "none";
            detail.style.display = "block";
            if (!built) {
                detail.appendChild(_ls_render_json_value(parsed, 0));
                built = true;
            }
        } else {
            toggle.textContent = "▶ JSON";
            preview.style.display = "";
            detail.style.display = "none";
        }
    });

    wrap.appendChild(toggle);
    wrap.appendChild(preview);
    wrap.appendChild(detail);
    return wrap;
}

/* Recursively render a JSON value as a nested grid */
function _ls_render_json_value(val, depth) {

    if (val === null) {
        const s = document.createElement("span");
        s.textContent = "null";
        s.style.color = "#f44336";
        return s;
    }

    if (typeof val === "boolean") {
        const s = document.createElement("span");
        s.textContent = String(val);
        s.style.color = "#f9a825";
        return s;
    }

    if (typeof val === "number") {
        const s = document.createElement("span");
        s.textContent = String(val);
        s.style.color = "#ce93d8";
        return s;
    }

    if (typeof val === "string") {
        const s = document.createElement("span");
        s.textContent = "\"" + val + "\"";
        s.style.color = "#a5d6a7";
        s.style.wordBreak = "break-all";
        return s;
    }

    if (Array.isArray(val)) {
        if (val.length === 0) {
            const s = document.createElement("span");
            s.textContent = "[]";
            s.style.color = "#888";
            return s;
        }
        return _ls_render_json_table(val, depth, true);
    }

    if (typeof val === "object") {
        const keys = Object.keys(val);
        if (keys.length === 0) {
            const s = document.createElement("span");
            s.textContent = "{}";
            s.style.color = "#888";
            return s;
        }
        return _ls_render_json_table(val, depth, false);
    }

    const s = document.createElement("span");
    s.textContent = String(val);
    return s;
}

/* Render an object or array as a key/value grid */
function _ls_render_json_table(obj, depth, isArray) {
    const tbl = document.createElement("table");
    Object.assign(tbl.style, {
        borderCollapse: "collapse",
        fontSize: "11px",
        fontFamily: "Consolas, monospace",
        width: "100%",
        marginLeft: depth > 0 ? "0" : "0"
    });

    const borderColor = depth % 2 === 0 ? "#333" : "#3a3a3a";

    const entries = isArray
        ? obj.map((v, i) => [i, v])
        : Object.entries(obj);

    for (const [k, v] of entries) {
        const tr = document.createElement("tr");

        const tdK = document.createElement("td");
        tdK.textContent = isArray ? "[" + k + "]" : k;
        Object.assign(tdK.style, {
            padding: "2px 6px",
            borderBottom: "1px solid " + borderColor,
            color: isArray ? "#ce93d8" : "#6fc",
            verticalAlign: "top",
            whiteSpace: "nowrap",
            width: "1%"
        });

        const tdV = document.createElement("td");
        Object.assign(tdV.style, {
            padding: "2px 6px",
            borderBottom: "1px solid " + borderColor,
            verticalAlign: "top"
        });
        tdV.appendChild(_ls_render_json_value(v, depth + 1));

        tr.appendChild(tdK);
        tr.appendChild(tdV);
        tbl.appendChild(tr);
    }

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
        border: "1px solid " + borderColor,
        borderRadius: "3px",
        overflow: "hidden"
    });
    wrapper.appendChild(tbl);
    return wrapper;
}

/* Framework lifecycle reactor */
function component_localstorage_handle_init() {
    ServiceWindow.registerApp("localstorage", component_localstorage_launch);
}

// ===== src/component_session_console.js =====
// -----------------------------------------------------------------------------
// component_session_console.js — tabbed JS console with browser-tab binding.
//
// Each console tab is an independent REPL. In standalone mode, commands are
// eval'd at desktop/page scope (identical to the tray console). After
// startSession(tabId, url?) is called, the tab's scope shifts to the bound
// browser tab's iframe — all commands execute inside iframe.contentWindow.
//
// AI mode (50 turns) uses the same JSON format as the tray console:
//   {"commands": ["cmd1", "cmd2"], "isFinal": true}
//
// Shell API: shell.sessionConsole.*
//   .newTab(name?)                 — create tab, returns tabId
//   .closeTab(tabId)               — end session + remove tab
//   .listTabs()                    — [{id, name, hasSession, aiMode, browserTabId}]
//   .submit(tabId, command)        — execute in tab's current scope
//   .setAiMode(tabId, bool)        — toggle AI mode
//   .startSession(tabId, url?)     — open browser tab, bind scope
//   .endSession(tabId)             — close session console tab
//   .getOutput(tabId)              — output log array
//
// Registered as a launcher app ("session_console").
// -----------------------------------------------------------------------------

let sessionConsoleServiceWindow = null;
let sessionConsoleContainer     = null;

/* Tab state */
let _sc_tabs       = [];    // [{id, name, aiMode, browserTabId, outputEl, inputEl, controlBar, history[], historyIdx, outputLog[], aiRunning, aiAbort, aiSpinner, aiCancelBtn}]
let _sc_next_id    = 1;
let _sc_active_tab = null;  // id of the visible console tab

/* DOM refs */
let _sc_tab_bar    = null;
let _sc_body       = null;

const _SC_AI_MAX_TURNS = 50;

function component_session_console_launch() {
    if (!sessionConsoleContainer) component_session_console_create();
    sessionConsoleServiceWindow.show();
}

function component_session_console_create() {

    sessionConsoleServiceWindow = new ServiceWindow();
    sessionConsoleServiceWindow.create({
        appName: "session_console",
        width:   640,
        height:  420,
        isDraggable: () => true,
        isResizable: () => true
    });

    sessionConsoleServiceWindow.registerTab({ id: "session_console", label: "Session Console" });
    sessionConsoleServiceWindow.appendControls();

    sessionConsoleContainer = sessionConsoleServiceWindow.container;

    /* Body — flex column */
    const body = sessionConsoleServiceWindow.createBody({
        padding: "0",
        gap:     "0",
        style: {
            background: "#000",
            color:      "#d0d0d0",
            fontFamily: "Consolas, 'Courier New', monospace",
            fontSize:   "12.5px"
        }
    });
    _sc_body = body;

    /* ---- Internal tab bar ---- */
    const tabBar = document.createElement("div");
    Object.assign(tabBar.style, {
        display:      "flex",
        alignItems:   "center",
        gap:          "0",
        padding:      "0 4px",
        background:   "#0a0a0a",
        borderBottom: "1px solid #222",
        flexShrink:   "0",
        overflowX:    "auto",
        minHeight:    "26px"
    });
    _sc_tab_bar = tabBar;

    /* "+" button */
    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.title = "New console tab";
    Object.assign(addBtn.style, {
        background: "transparent",
        color:      "#4fc3f7",
        border:     "none",
        fontSize:   "16px",
        cursor:     "pointer",
        padding:    "2px 8px",
        lineHeight: "1",
        flexShrink: "0"
    });
    addBtn.onclick = () => _sc_new_tab();
    tabBar.appendChild(addBtn);

    body.appendChild(tabBar);

    /* Restore state or create a default tab */
    _sc_restore_state();
    if (_sc_tabs.length === 0) {
        _sc_new_tab();
    }

    /* Listen for browser tab closures to detect orphaned sessions */
    if (typeof _browser_tab_closed_listeners !== "undefined") {
        _browser_tab_closed_listeners.push((browserTabId) => {
            _sc_tabs.forEach(tab => {
                if (tab.browserTabId === browserTabId) {
                    _sc_print_to_tab(tab, "Browser tab closed \u2014 session ended.", "#f0c674");
                    tab.browserTabId = null;
                    _sc_render_tab_bar();
                    _sc_persist_state();
                }
            });
        });
    }

    /* Restore geometry or center */
    if (!sessionConsoleServiceWindow.restoreState()) {
        service_window_center(sessionConsoleContainer, 640, 420);
    }

    /* ---- Hotkeys ---- */

    /* Alt+A — toggle AI mode on active tab */
    service_hotkeys_register(sessionConsoleServiceWindow, "alt+a", () => {
        const tab = _sc_tabs.find(t => t.id === _sc_active_tab);
        if (!tab) return;
        tab.aiMode = !tab.aiMode;
        tab.aiTrack.style.background = tab.aiMode ? "#4fc3f7" : "rgba(255,255,255,0.18)";
        tab.aiKnob.style.left = tab.aiMode ? "16px" : "2px";
        _sc_persist_state();
    });

    /* Alt+1..9 — switch to console tab by position */
    for (let n = 1; n <= 9; n++) {
        service_hotkeys_register(sessionConsoleServiceWindow, "alt+" + n, ((idx) => () => {
            if (idx < _sc_tabs.length) _sc_set_active(_sc_tabs[idx].id);
        })(n - 1));
    }
}

/* ---- Tab management ---- */

function _sc_new_tab(name) {
    if (!sessionConsoleContainer) component_session_console_create();

    const id = _sc_next_id++;
    const tabName = name || ("Console " + id);

    /* Output area */
    const outputEl = document.createElement("div");
    Object.assign(outputEl.style, {
        flex:       "1",
        overflowY:  "auto",
        padding:    "8px 10px",
        whiteSpace: "pre-wrap",
        wordBreak:  "break-word",
        lineHeight: "1.4",
        display:    "none"
    });

    /* Control bar */
    const controlBar = document.createElement("div");
    Object.assign(controlBar.style, {
        display:    "none",
        alignItems: "center",
        gap:        "8px",
        borderTop:  "1px solid #222",
        background: "#0a0a0a",
        padding:    "3px 8px",
        fontSize:   "11px"
    });

    /* AI toggle */
    const aiLabel = document.createElement("label");
    Object.assign(aiLabel.style, {
        display: "flex", alignItems: "center", gap: "6px",
        color: "#999", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none"
    });

    const aiTrack = document.createElement("span");
    Object.assign(aiTrack.style, {
        position: "relative", display: "inline-block",
        width: "30px", height: "16px", borderRadius: "8px",
        background: "rgba(255,255,255,0.18)", transition: "background 150ms ease",
        flexShrink: "0"
    });
    const aiKnob = document.createElement("span");
    Object.assign(aiKnob.style, {
        position: "absolute", top: "2px", left: "2px",
        width: "12px", height: "12px", borderRadius: "50%",
        background: "white", transition: "left 150ms ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.4)"
    });
    aiTrack.appendChild(aiKnob);

    const aiText = document.createElement("span");
    aiText.textContent = "AI mode";
    aiLabel.appendChild(aiTrack);
    aiLabel.appendChild(aiText);

    /* Session badge */
    const sessionBadge = document.createElement("span");
    Object.assign(sessionBadge.style, {
        color:      "#888",
        fontSize:   "10px",
        marginLeft: "auto"
    });

    /* Spinner */
    const aiSpinner = document.createElement("span");
    aiSpinner.textContent = "";
    Object.assign(aiSpinner.style, { color: "#c5a5ff", display: "none", fontSize: "11px" });

    /* Cancel button */
    const aiCancelBtn = document.createElement("button");
    aiCancelBtn.textContent = "Cancel";
    Object.assign(aiCancelBtn.style, {
        background: "#333", color: "#ff6b6b", border: "1px solid #555",
        borderRadius: "3px", padding: "1px 8px", cursor: "pointer",
        fontSize: "11px", display: "none"
    });

    controlBar.appendChild(aiLabel);
    controlBar.appendChild(sessionBadge);
    controlBar.appendChild(aiSpinner);
    controlBar.appendChild(aiCancelBtn);

    /* Input row */
    const inputRow = document.createElement("div");
    Object.assign(inputRow.style, {
        display:    "none",
        alignItems: "center",
        borderTop:  "1px solid #222",
        background: "#0a0a0a",
        padding:    "4px 8px"
    });

    const prompt = document.createElement("span");
    prompt.textContent = "> ";
    Object.assign(prompt.style, {
        color: "#4fc3f7", marginRight: "4px",
        fontFamily: "inherit", fontWeight: "bold"
    });

    const inputEl = document.createElement("textarea");
    inputEl.spellcheck = false;
    inputEl.autocomplete = "off";
    inputEl.rows = 1;
    Object.assign(inputEl.style, {
        flex: "1", background: "transparent", color: "#e0e0e0",
        border: "none", outline: "none", resize: "none",
        fontFamily: "inherit", fontSize: "inherit",
        padding: "2px 0", lineHeight: "1.4",
        maxHeight: "8.4em", overflowY: "auto"
    });

    const autosize = () => {
        inputEl.style.height = "auto";
        inputEl.style.height = Math.min(inputEl.scrollHeight, 8 * 17) + "px";
    };
    inputEl.addEventListener("input", autosize);

    inputRow.appendChild(prompt);
    inputRow.appendChild(inputEl);

    const tab = {
        id:            id,
        name:          tabName,
        aiMode:        false,
        browserTabId:  null,
        outputEl:      outputEl,
        inputEl:       inputEl,
        inputRow:      inputRow,
        controlBar:    controlBar,
        sessionBadge:  sessionBadge,
        aiTrack:       aiTrack,
        aiKnob:        aiKnob,
        aiSpinner:     aiSpinner,
        aiCancelBtn:   aiCancelBtn,
        history:       [],
        historyIdx:    -1,
        outputLog:     [],
        aiRunning:     false,
        aiAbort:       null
    };

    /* Wire AI toggle */
    const toggleAi = () => {
        tab.aiMode = !tab.aiMode;
        aiTrack.style.background = tab.aiMode ? "#4fc3f7" : "rgba(255,255,255,0.18)";
        aiKnob.style.left = tab.aiMode ? "16px" : "2px";
        _sc_persist_state();
    };
    aiLabel.onclick = (e) => { e.preventDefault(); toggleAi(); };

    /* Wire cancel */
    aiCancelBtn.onclick = () => {
        if (tab.aiAbort) tab.aiAbort.abort();
        flushLlmQueue();
    };

    /* Wire keydown */
    inputEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            const cmd = inputEl.value;
            inputEl.value = "";
            autosize();
            if (cmd.trim().length === 0) return;
            tab.history.push(cmd);
            tab.historyIdx = tab.history.length;
            if (tab.aiMode) {
                _sc_ai_submit(tab, cmd);
            } else {
                submitSessionConsoleMessage(tab.id, cmd);
            }
        } else if (ev.key === "ArrowUp" && !inputEl.value.includes("\n")) {
            if (tab.history.length === 0) return;
            ev.preventDefault();
            tab.historyIdx = Math.max(0, tab.historyIdx - 1);
            inputEl.value = tab.history[tab.historyIdx] || "";
            autosize();
            setTimeout(() => inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length), 0);
        } else if (ev.key === "ArrowDown" && !inputEl.value.includes("\n")) {
            if (tab.history.length === 0) return;
            ev.preventDefault();
            tab.historyIdx = Math.min(tab.history.length, tab.historyIdx + 1);
            inputEl.value = tab.history[tab.historyIdx] || "";
            autosize();
        } else if (ev.key === "l" && ev.ctrlKey) {
            ev.preventDefault();
            outputEl.innerHTML = "";
        }
    });

    /* Click-to-focus */
    outputEl.addEventListener("click", () => {
        const sel = window.getSelection();
        if (sel && sel.toString().length === 0) inputEl.focus();
    });

    /* Add elements to body (after tab bar) */
    _sc_body.appendChild(outputEl);
    _sc_body.appendChild(controlBar);
    _sc_body.appendChild(inputRow);

    _sc_tabs.push(tab);
    _sc_render_tab_bar();
    _sc_set_active(id);
    _sc_persist_state();

    return id;
}

function _sc_close_tab(tabId) {
    const idx = _sc_tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;

    const tab = _sc_tabs[idx];

    /* Cancel any running AI */
    if (tab.aiAbort) tab.aiAbort.abort();
    flushSessionConsoleQueue(tabId);

    /* Remove DOM elements */
    if (tab.outputEl.parentNode) tab.outputEl.parentNode.removeChild(tab.outputEl);
    if (tab.controlBar.parentNode) tab.controlBar.parentNode.removeChild(tab.controlBar);
    if (tab.inputRow.parentNode) tab.inputRow.parentNode.removeChild(tab.inputRow);

    _sc_tabs.splice(idx, 1);

    /* Switch to neighbor */
    if (_sc_active_tab === tabId) {
        if (_sc_tabs.length > 0) {
            const newIdx = Math.min(idx, _sc_tabs.length - 1);
            _sc_set_active(_sc_tabs[newIdx].id);
        } else {
            _sc_active_tab = null;
        }
    }

    _sc_render_tab_bar();
    _sc_persist_state();
}

function _sc_set_active(tabId) {
    _sc_active_tab = tabId;

    _sc_tabs.forEach(t => {
        const isActive = t.id === tabId;
        t.outputEl.style.display   = isActive ? "block" : "none";
        t.controlBar.style.display = isActive ? "flex"  : "none";
        t.inputRow.style.display   = isActive ? "flex"  : "none";
    });

    _sc_render_tab_bar();

    /* Focus input */
    const tab = _sc_tabs.find(t => t.id === tabId);
    if (tab) setTimeout(() => tab.inputEl.focus(), 0);

    _sc_persist_state();
}

/* ---- Tab bar rendering ---- */

function _sc_render_tab_bar() {
    if (!_sc_tab_bar) return;

    const addBtn = _sc_tab_bar.lastElementChild;
    while (_sc_tab_bar.firstChild !== addBtn) {
        _sc_tab_bar.removeChild(_sc_tab_bar.firstChild);
    }

    _sc_tabs.forEach(tab => {
        const el = document.createElement("div");
        Object.assign(el.style, {
            display:      "flex",
            alignItems:   "center",
            gap:          "4px",
            padding:      "3px 8px",
            cursor:       "pointer",
            whiteSpace:   "nowrap",
            fontSize:     "11px",
            borderRight:  "1px solid #222",
            background:   tab.id === _sc_active_tab ? "#1a1a1a" : "transparent",
            color:        tab.id === _sc_active_tab ? "#4fc3f7" : "#666",
            maxWidth:     "180px"
        });

        const label = document.createElement("span");
        let displayName = tab.name;
        if (tab.browserTabId !== null) {
            displayName += " [session]";
        }
        label.textContent = displayName;
        Object.assign(label.style, {
            overflow:     "hidden",
            textOverflow: "ellipsis",
            flex:         "1"
        });
        label.onclick = () => _sc_set_active(tab.id);

        const closeBtn = document.createElement("span");
        closeBtn.textContent = "\u00D7";
        closeBtn.title = "Close tab";
        Object.assign(closeBtn.style, {
            color: "#666", cursor: "pointer", fontSize: "14px", lineHeight: "1"
        });
        closeBtn.onmouseover = () => { closeBtn.style.color = "#ff6b6b"; };
        closeBtn.onmouseout  = () => { closeBtn.style.color = "#666"; };
        closeBtn.onclick = (ev) => {
            ev.stopPropagation();
            _sc_close_tab(tab.id);
        };

        el.appendChild(label);
        el.appendChild(closeBtn);
        _sc_tab_bar.insertBefore(el, addBtn);
    });
}

/* ---- Output helpers ---- */

function _sc_print_to_tab(tab, text, color) {
    if (!tab || !tab.outputEl) return;
    const line = document.createElement("div");
    line.textContent = text;
    if (color) line.style.color = color;
    tab.outputEl.appendChild(line);
    tab.outputEl.scrollTop = tab.outputEl.scrollHeight;
    tab.outputLog.push(text);
}

/* ---- Command execution ---- */

/* Execute a command in the given tab's scope. Returns { result, error }.
   This is the function called by service_session_console.js drain loop. */
async function component_session_console_execute(tabId, cmd) {
    const tab = _sc_tabs.find(t => t.id === tabId);
    if (!tab) return { result: undefined, error: "Tab " + tabId + " not found" };

    /* Lazy-create window */
    if (!sessionConsoleContainer) component_session_console_create();

    /* Echo input */
    const echoLines = cmd.split("\n");
    const echoText = echoLines.map((l, i) => (i === 0 ? "> " : "  ") + l).join("\n");
    _sc_print_to_tab(tab, echoText, "#4fc3f7");

    /* Built-in shortcuts */
    const trimmed = cmd.trim();
    if (trimmed === "clear" || trimmed === "cls") {
        tab.outputEl.innerHTML = "";
        tab.outputLog = [];
        return { result: undefined, error: null };
    }

    /* Route eval based on session state */
    const hasSession = tab.browserTabId !== null;

    /* Patch console methods to capture output */
    const origLog   = console.log;
    const origInfo  = console.info;
    const origWarn  = console.warn;
    const origError = console.error;
    const origDir   = console.dir;

    const fmtArgs = (args) =>
        Array.prototype.map.call(args, component_console_format).join(" ");

    console.log   = function () { _sc_print_to_tab(tab, fmtArgs(arguments), "#d0d0d0"); origLog.apply(console, arguments); };
    console.info  = function () { _sc_print_to_tab(tab, fmtArgs(arguments), "#9ecbff"); origInfo.apply(console, arguments); };
    console.warn  = function () { _sc_print_to_tab(tab, fmtArgs(arguments), "#f0c674"); origWarn.apply(console, arguments); };
    console.error = function () { _sc_print_to_tab(tab, fmtArgs(arguments), "#ff6b6b"); origError.apply(console, arguments); };
    console.dir   = function () { _sc_print_to_tab(tab, fmtArgs(arguments), "#c5e478"); origDir.apply(console, arguments); };

    let result, threw = false, err;
    try {
        if (hasSession) {
            const out = await _browser_eval_in_tab(tab.browserTabId, cmd);
            if (out.error) {
                threw = true;
                err = out.error;
            } else {
                result = out.result;
            }
        } else {
            result = component_console_eval(cmd);
        }
    } catch (e) {
        threw = true;
        err = e;
    } finally {
        console.log   = origLog;
        console.info  = origInfo;
        console.warn  = origWarn;
        console.error = origError;
        console.dir   = origDir;
    }

    if (threw) {
        const msg = (err && err.stack) ? err.stack : String(err);
        _sc_print_to_tab(tab, msg, "#ff6b6b");
        return { result: undefined, error: err };
    }

    if (result !== undefined) {
        _sc_print_to_tab(tab, component_console_format(result), "#7ee787");
    }

    return { result, error: null };
}

/* Execute command and capture console output as logs (for AI loop). */
async function _sc_ai_exec_capturing(tab, cmd) {
    var logs = [];

    var origLog   = console.log;
    var origInfo  = console.info;
    var origWarn  = console.warn;
    var origError = console.error;
    var origDir   = console.dir;

    var fmtArgs = function (args) {
        return Array.prototype.map.call(args, component_console_format).join(" ");
    };

    console.log   = function () { var s = fmtArgs(arguments); logs.push(s); _sc_print_to_tab(tab, s, "#d0d0d0"); origLog.apply(console, arguments); };
    console.info  = function () { var s = fmtArgs(arguments); logs.push(s); _sc_print_to_tab(tab, s, "#9ecbff"); origInfo.apply(console, arguments); };
    console.warn  = function () { var s = fmtArgs(arguments); logs.push(s); _sc_print_to_tab(tab, s, "#f0c674"); origWarn.apply(console, arguments); };
    console.error = function () { var s = fmtArgs(arguments); logs.push(s); _sc_print_to_tab(tab, s, "#ff6b6b"); origError.apply(console, arguments); };
    console.dir   = function () { var s = fmtArgs(arguments); logs.push(s); _sc_print_to_tab(tab, s, "#c5e478"); origDir.apply(console, arguments); };

    var hasSession = tab.browserTabId !== null;
    var result, threw = false, err;
    try {
        if (hasSession) {
            var out = await _browser_eval_in_tab(tab.browserTabId, cmd);
            if (out.error) { threw = true; err = out.error; }
            else { result = out.result; }
        } else {
            result = component_console_eval(cmd);
        }
    } catch (e) {
        threw = true;
        err = e;
    } finally {
        console.log   = origLog;
        console.info  = origInfo;
        console.warn  = origWarn;
        console.error = origError;
        console.dir   = origDir;
    }

    if (threw) {
        var msg = (err && err.stack) ? err.stack : String(err);
        _sc_print_to_tab(tab, msg, "#ff6b6b");
        logs.push("ERROR: " + msg);
        return { result: undefined, error: err, logs: logs };
    }

    if (result !== undefined) {
        var formatted = component_console_format(result);
        _sc_print_to_tab(tab, formatted, "#7ee787");
        logs.push("=> " + formatted);
    }

    return { result: result, error: null, logs: logs };
}

/* ---- Session management ---- */

function _sc_start_session(tabId, url) {
    if (!sessionConsoleContainer) component_session_console_create();

    const tab = _sc_tabs.find(t => t.id === tabId);
    if (!tab) return { error: "Session console tab " + tabId + " not found" };

    /* Check if browser tab is already bound by another session tab */
    /* We need a browser tab first — create one */
    if (!browserContainer) component_browser_create();

    const browserTabId = _browser_new_tab(url, tab.name);

    /* Check 1:1 constraint */
    const existing = _sc_tabs.find(t => t.id !== tabId && t.browserTabId === browserTabId);
    if (existing) {
        _browser_close_tab(browserTabId);
        return { error: "Browser tab " + browserTabId + " is already bound to session tab " + existing.id };
    }

    tab.browserTabId = browserTabId;

    /* Update badge */
    tab.sessionBadge.textContent = "session: browser tab #" + browserTabId;
    tab.sessionBadge.style.color = "#4fc3f7";

    _sc_print_to_tab(tab, "Session started: bound to browser tab #" + browserTabId, "#7ee787");
    _sc_render_tab_bar();
    _sc_persist_state();

    return { browserTabId: browserTabId };
}

function _sc_end_session(tabId) {
    _sc_close_tab(tabId);
}

/* ---- AI mode ---- */

function _sc_ai_submit(tab, userText) {
    if (tab.aiRunning) {
        _sc_print_to_tab(tab, "[AI] Already waiting for a response\u2026", "#f0c674");
        return;
    }

    _sc_print_to_tab(tab, "[AI] " + userText, "#c5a5ff");
    tab.aiRunning = true;
    tab.aiSpinner.style.display = "inline";
    tab.aiCancelBtn.style.display = "inline-block";

    /* Spinner animation */
    var frames = ["\u280B","\u2819","\u2839","\u2838","\u283C","\u2834","\u2826","\u2827","\u2807","\u280F"];
    var frameIdx = 0;
    var spinTimer = setInterval(function () {
        tab.aiSpinner.textContent = frames[frameIdx] + " Thinking\u2026";
        frameIdx = (frameIdx + 1) % frames.length;
    }, 80);

    tab.aiAbort = new AbortController();
    var cancelled = false;
    tab.aiAbort.signal.addEventListener("abort", function () { cancelled = true; });

    var hasSession = tab.browserTabId !== null;

    var systemPrompt;
    if (hasSession) {
        systemPrompt =
            "You are a browser DevTools console agent. The user describes a task. " +
            "You respond ONLY with a JSON object wrapped in a ```json code fence:\n" +
            '```json\n{"commands": ["cmd1", "cmd2"], "isFinal": true}\n```\n\n' +
            "Rules:\n" +
            "- commands: array of JavaScript expressions to eval inside a browser tab's DOM.\n" +
            "- CRITICAL VARIABLE RULE: Each command runs in its own fresh scope. Variables (const/let/var) " +
            "declared in one command DO NOT EXIST in subsequent commands. NEVER declare variables.\n" +
            "  BAD:  {\"commands\": [\"const el = document.querySelector('h1')\", \"console.log(el.textContent)\"]}\n" +
            "  GOOD: {\"commands\": [\"console.log(document.querySelector('h1').textContent)\"], \"isFinal\": true}\n" +
            "  ALSO GOOD: set isFinal: false, read output, then hardcode values in next turn.\n" +
            "- All document.* and window.* calls target the browser tab's document and window, NOT the parent page.\n" +
            "- You are like a DevTools console attached to a web page. Write plain DOM JS.\n" +
            "- isFinal: true if the task is done. false if you need to see output to decide next steps.\n" +
            "- Use console.log() for output.\n" +
            "- Each command must be valid standalone JavaScript.\n" +
            "- Prefer single quotes or template literals inside command strings.\n" +
            "- Do NOT split a single statement across multiple commands.\n" +
            "- NEVER put multiple statements separated by newlines in a single command string.\n" +
            "- Maximum " + _SC_AI_MAX_TURNS + " turns allowed.\n";
    } else {
        var shellDesc = _console_get_shell_description();
        systemPrompt =
            "You are a JS console agent. The user describes a task in plain English. " +
            "You respond ONLY with a JSON object wrapped in a ```json code fence:\n" +
            '```json\n{"commands": ["cmd1", "cmd2"], "isFinal": true}\n```\n\n' +
            "Rules:\n" +
            "- commands: array of JavaScript expressions to eval in the browser console.\n" +
            "- CRITICAL VARIABLE RULE: Each command runs in its own fresh scope. Variables (const/let/var) " +
            "declared in one command DO NOT EXIST in subsequent commands. NEVER declare variables.\n" +
            "  BAD:  {\"commands\": [\"const id = shell.browser.newTab('https://x.com','X')\", \"shell.sessionConsole.getTabById(1).attachToBrowserTab(id)\"]}\n" +
            "  GOOD: {\"commands\": [\"shell.browser.newTab('https://x.com','X')\"], \"isFinal\": false}  → read output → hardcode in next turn\n" +
            "  ALSO GOOD: nested calls — shell.sessionConsole.getTabById(shell.sessionConsole.newTab('X')).attachToBrowserTab(shell.browser.newTab('https://x.com','X'))\n" +
            "- isFinal: true if the task is done after these commands. false if you need to see the output to decide next steps.\n" +
            "- Use console.log() for output the user should see.\n" +
            "- Each command must be valid standalone JavaScript.\n" +
            "- Prefer single quotes or template literals inside command strings.\n" +
            "- Do NOT split a single statement across multiple commands.\n" +
            "- NEVER put multiple statements separated by newlines in a single command string.\n" +
            "- CRITICAL: If you do not know the exact signature of a function, " +
            "inspect it first with console.dir(<fn>) before invoking it.\n" +
            "- CRITICAL: Before using any shell namespace, call its help() method first (e.g. shell.browser.help(), " +
            "shell.sessionConsole.help()) to learn available methods and recipes. Call shell.help() for an overview.\n" +
            "- The page has a global `shell` object for app automation.\n" +
            "- Current shell API:\n" + shellDesc + "\n\n" +
            "- Use shell.list() to see available apps. Use console.dir(shell.<appName>) to discover APIs.\n" +
            "\nBrowser + Session Console workflow:\n" +
            "- To execute JS on a webpage, follow these steps:\n" +
            "  1. shell.browser.newTab('https://example.com', 'My Tab') → returns a browser tab ID (number)\n" +
            "  2. shell.sessionConsole.newTab('My Session') → returns a session console tab ID (number)\n" +
            "  3. Find the browser tab ID: shell.browser.listTabs() → [{id, name, url}]\n" +
            "  4. Attach: shell.sessionConsole.getTabById(<consoleTabId>).attachToBrowserTab(<browserTabId>)\n" +
            "  5. Now shell.sessionConsole.submit(<consoleTabId>, 'document.title') executes inside that page's iframe\n" +
            "- To attach to an existing browser tab, use shell.browser.listTabs() to find its ID first.\n" +
            "- After attaching, all submit() calls on that console tab run inside the browser tab's iframe DOM.\n" +
            "- Maximum " + _SC_AI_MAX_TURNS + " turns allowed.\n";
    }

    var conversation = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
    ];

    _sc_ai_loop(tab, conversation, 0, spinTimer, cancelled);
}

function _sc_ai_loop(tab, conversation, turn, spinTimer, cancelled) {
    if (cancelled) { _sc_ai_finish(tab, spinTimer, "Cancelled."); return; }
    if (turn >= _SC_AI_MAX_TURNS) { _sc_ai_finish(tab, spinTimer, "Reached max " + _SC_AI_MAX_TURNS + " turns."); return; }

    /* Flatten conversation */
    var prompt = "";
    for (var i = 0; i < conversation.length; i++) {
        var msg = conversation[i];
        if (msg.role === "system")         prompt += msg.content + "\n\n";
        else if (msg.role === "user")      prompt += "User: " + msg.content + "\n\n";
        else if (msg.role === "assistant") prompt += "Assistant: " + msg.content + "\n\n";
        else if (msg.role === "output")    prompt += "Command output:\n" + msg.content + "\n\n";
    }

    _sc_print_to_tab(tab, "[AI] Turn " + (turn + 1) + "/" + _SC_AI_MAX_TURNS + "\u2026", "#888");

    submitMessage(
        prompt,
        function () { /* onstart */ },
        async function (ctx) {
            if (tab.aiAbort && tab.aiAbort.signal.aborted) { _sc_ai_finish(tab, spinTimer, "Cancelled."); return; }
            if (ctx.cancelled) { _sc_ai_finish(tab, spinTimer, "Cancelled."); return; }
            if (ctx.error) { _sc_ai_finish(tab, spinTimer, "Error: " + String(ctx.error)); return; }

            var raw = (ctx.result || "").trim();
            if (!raw) { _sc_ai_finish(tab, spinTimer, "Empty response."); return; }

            raw = raw.replace(/^```(?:json|javascript|js)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();

            var parsed;
            try { parsed = JSON.parse(raw); } catch (e) {
                _sc_print_to_tab(tab, "[AI] Response (not JSON, executing as JS):", "#f0c674");
                _sc_print_to_tab(tab, raw, "#9ecbff");
                submitSessionConsoleMessage(tab.id, raw);
                _sc_ai_finish(tab, spinTimer, "Done (fallback mode).");
                return;
            }

            var commands = parsed.commands || [];
            var isFinal  = parsed.isFinal !== false;

            conversation.push({ role: "assistant", content: raw });

            if (commands.length === 0) { _sc_ai_finish(tab, spinTimer, "Done (no commands)."); return; }

            var allLogs = [];
            for (var ci = 0; ci < commands.length; ci++) {
                var cmd = commands[ci];
                _sc_print_to_tab(tab, "[AI cmd " + (ci + 1) + "] " + cmd, "#c5a5ff");
                var out = await _sc_ai_exec_capturing(tab, cmd);
                if (out.logs.length > 0) allLogs = allLogs.concat(out.logs);
            }

            if (isFinal) { _sc_ai_finish(tab, spinTimer, "Done."); return; }

            var outputText = allLogs.length > 0 ? allLogs.join("\n") : "(no output)";
            conversation.push({ role: "output", content: outputText });

            setTimeout(function () {
                _sc_ai_loop(tab, conversation, turn + 1, spinTimer,
                    tab.aiAbort && tab.aiAbort.signal.aborted);
            }, 0);
        }
    );
}

function _sc_ai_finish(tab, spinTimer, message) {
    clearInterval(spinTimer);
    tab.aiRunning = false;
    tab.aiAbort = null;
    tab.aiSpinner.style.display = "none";
    tab.aiCancelBtn.style.display = "none";
    _sc_print_to_tab(tab, "[AI] " + message, "#f0c674");
}

/* ---- Persistence ---- */

function _sc_persist_state() {
    const data = _sc_tabs.map(t => ({
        id:           t.id,
        name:         t.name,
        aiMode:       t.aiMode,
        browserTabId: t.browserTabId
    }));
    localStorage.setItem("tm_session_console_tabs", JSON.stringify(data));
    localStorage.setItem("tm_session_console_active_tab", String(_sc_active_tab || ""));
    localStorage.setItem("tm_session_console_next_id", String(_sc_next_id));
}

function _sc_restore_state() {
    try {
        const nextId = parseInt(localStorage.getItem("tm_session_console_next_id"), 10);
        if (nextId > 0) _sc_next_id = nextId;

        const raw = localStorage.getItem("tm_session_console_tabs");
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!Array.isArray(saved)) return;

        saved.forEach(s => {
            const id = _sc_new_tab(s.name);
            const tab = _sc_tabs.find(t => t.id === id);
            if (!tab) return;

            /* Restore the original id */
            tab.id = s.id;
            if (s.id >= _sc_next_id) _sc_next_id = s.id + 1;

            tab.aiMode = !!s.aiMode;
            tab.aiTrack.style.background = tab.aiMode ? "#4fc3f7" : "rgba(255,255,255,0.18)";
            tab.aiKnob.style.left = tab.aiMode ? "16px" : "2px";

            /* Restore session binding if the browser tab still exists */
            if (s.browserTabId !== null && s.browserTabId !== undefined) {
                if (typeof _browser_get_tab === "function" && _browser_get_tab(s.browserTabId)) {
                    tab.browserTabId = s.browserTabId;
                    tab.sessionBadge.textContent = "session: browser tab #" + s.browserTabId;
                    tab.sessionBadge.style.color = "#4fc3f7";
                }
            }
        });

        _sc_render_tab_bar();

        const savedActive = parseInt(localStorage.getItem("tm_session_console_active_tab"), 10);
        if (savedActive && _sc_tabs.find(t => t.id === savedActive)) {
            _sc_set_active(savedActive);
        } else if (_sc_tabs.length > 0) {
            _sc_set_active(_sc_tabs[0].id);
        }
    } catch (e) {
        console.error("session console restore state:", e);
    }
}

/* ---- Shell API builder ---- */

function _sc_build_shell_api() {
    return {
        help() {
            return "shell.sessionConsole — Tabbed JS console with browser-tab binding\n\n" +
                "Methods:\n" +
                "  newTab(name?)                          — Create a console tab. Returns tab ID.\n" +
                "  closeTab(tabId)                        — Close a console tab.\n" +
                "  listTabs()                             — [{id, name, hasSession, aiMode, browserTabId}]\n" +
                "  submit(tabId, command)                 — Eval JS in the tab's scope.\n" +
                "  setAiMode(tabId, bool)                 — Toggle AI mode.\n" +
                "  getTabById(tabId)                      — Returns a tab API object with:\n" +
                "    .startSession(url?)                  — Open a browser tab + bind scope.\n" +
                "    .endSession()                        — Unbind.\n" +
                "    .attachToBrowserTab(browserTabId)    — Bind to an existing browser tab.\n" +
                "    .getOutput()                         — Output log array.\n\n" +
                "Recipes:\n" +
                "  // Execute JS on an existing browser tab:\n" +
                "  var tabs = shell.browser.listTabs()     // find browser tab ID\n" +
                "  var cid = shell.sessionConsole.newTab('My Session')\n" +
                "  shell.sessionConsole.getTabById(cid).attachToBrowserTab(tabs[0].id)\n" +
                "  shell.sessionConsole.submit(cid, 'document.title')\n\n" +
                "  // Open a new page and execute JS on it:\n" +
                "  var bid = shell.browser.newTab('https://example.com', 'Example')\n" +
                "  var cid = shell.sessionConsole.newTab('Example Session')\n" +
                "  shell.sessionConsole.getTabById(cid).attachToBrowserTab(bid)\n" +
                "  shell.sessionConsole.submit(cid, 'document.querySelectorAll(\"a\").length')";
        },
        newTab(name)                { return _sc_new_tab(name); },
        closeTab(tabId)             { _sc_close_tab(tabId); },
        listTabs()                  { return _sc_tabs.map(t => ({ id: t.id, name: t.name, hasSession: t.browserTabId !== null, aiMode: t.aiMode, browserTabId: t.browserTabId })); },
        submit(tabId, command)      { return submitSessionConsoleMessage(tabId, command); },
        setAiMode(tabId, on)        { var t = _sc_tabs.find(x => x.id === tabId); if (t) { t.aiMode = !!on; t.aiTrack.style.background = t.aiMode ? "#4fc3f7" : "rgba(255,255,255,0.18)"; t.aiKnob.style.left = t.aiMode ? "16px" : "2px"; _sc_persist_state(); } },
        getTabById(tabId) {
            var t = _sc_tabs.find(x => x.id === tabId);
            if (!t) return null;
            return {
                get id()            { return t.id; },
                get name()          { return t.name; },
                get hasSession()    { return t.browserTabId !== null; },
                get aiMode()        { return t.aiMode; },
                get browserTabId()  { return t.browserTabId; },
                getOutput()         { return t.outputLog.slice(); },
                startSession(url) {
                    if (!sessionConsoleContainer) component_session_console_create();
                    sessionConsoleServiceWindow.show();
                    return _sc_start_session(t.id, url);
                },
                endSession() {
                    _sc_end_session(t.id);
                },
                attachToBrowserTab(browserTabId) {
                    /* Bind this console tab to an existing browser tab (no new tab created) */
                    if (typeof _browser_get_tab === "function" && !_browser_get_tab(browserTabId)) {
                        return { error: "Browser tab " + browserTabId + " not found" };
                    }
                    var existing = _sc_tabs.find(x => x.id !== t.id && x.browserTabId === browserTabId);
                    if (existing) {
                        return { error: "Browser tab " + browserTabId + " is already bound to session tab " + existing.id };
                    }
                    t.browserTabId = browserTabId;
                    t.sessionBadge.textContent = "session: browser tab #" + browserTabId;
                    t.sessionBadge.style.color = "#4fc3f7";
                    _sc_print_to_tab(t, "Attached to browser tab #" + browserTabId, "#7ee787");
                    _sc_render_tab_bar();
                    _sc_persist_state();
                    return { browserTabId: browserTabId };
                }
            };
        }
    };
}

/* ---- Framework lifecycle ---- */

function component_session_console_handle_init() {
    ServiceWindow.registerApp("session_console", component_session_console_launch);
}

// ===== src/component_tab_ascii.js =====
// -----------------------------------------------------------------------------
// component_tab_ascii.js — Ascii design tab generator.
// -----------------------------------------------------------------------------

/* ---- Ascii-tab-owned state ---- */

let asciiTA;
let asciiCache = { hash: null, content: "" };
const ASCII_CACHE_KEY = "tm_ascii_cache";

function generateAsciiDiagram(code, hash) {

    const prompt = "Analyze the following code and create an ASCII box diagram showing its architecture, " +
        "main components, and their relationships. Use simple ASCII box drawing characters " +
        "(+, -, |, >, arrows). Keep it concise and readable. Respond ONLY with the ASCII " +
        "diagram, no explanations enclosed inside triple quotes pair : \"```md and ```\", denoting code." +
        "\n\nCode:\n" + code;

    const onstart = (ctx) => {
        showWaitingUI();
    };

    const onend = (ctx) => {
        hideWaitingUI();

        if (ctx.cancelled) return;

        if (ctx.error) {
            if (activeTab === "ascii") asciiTA.value = "(Error generating ASCII diagram: " + ctx.error.message + ")";
            return;
        }

        if (ctx.result) {
            asciiCache = { hash: hash, content: ctx.result };
            try { localStorage.setItem(ASCII_CACHE_KEY, JSON.stringify(asciiCache)); } catch (e) {}
            if (activeTab === "ascii") asciiTA.value = ctx.result;
        } else {
            if (activeTab === "ascii") asciiTA.value = "(Failed to generate ASCII diagram)";
        }
    };

    submitMessage(prompt, onstart, onend);
}

// ===== src/component_tab_question.js =====
// -----------------------------------------------------------------------------
// component_tab_question.js — Question tab generator.
// -----------------------------------------------------------------------------

/* ---- Question-tab-owned state ---- */

let questionTA;
let questionCache = { hash: null, content: "" };
const QUESTION_CACHE_KEY = "tm_question_cache";

function generateQuestion(code, hash) {

    const prompt = "Analyze the following code (it may be partial/half-written) and figure out what problem it is solving. " +
        "If it is a LeetCode problem, identify the question number and title. Follow this EXACT format:\n\n" +
        "Title: [LeetCode #number] Problem Title\n" +
        "(If you cannot identify the exact LeetCode question, use: [x] Unable to identify LeetCode question - Best guess: <title>)\n\n" +
        "## Question\n<Full problem statement>\n\n" +
        "## Constraints\n<List all constraints>\n\n" +
        "## Example 1\nInput: ...\nOutput: ...\nExplanation: ...\n\n" +
        "## Example 2\nInput: ...\nOutput: ...\nExplanation: ...\n\n" +
        "## Hints\n<2-3 hints>\n\n" +
        "## Companies Asked\n<List of companies known to ask this>\n\n" +
        "## Expected Complexity (Interview)\nTime: O(...)\nSpace: O(...)\n\n" +
        "## Topics\n<List of relevant topics/tags>\n\n" +
        "If it is NOT a LeetCode question, still frame the problem the code is trying to solve with corner cases, expected TC and SC.\n" +
        "You may use ASCII diagrams where helpful.\n" +
        "Enclose your ENTIRE response inside ```md and ``` so it is treated as markdown code.\n\n" +
        "Code:\n" + code;

    const onstart = (ctx) => {
        showWaitingUI();
    };

    const onend = (ctx) => {
        hideWaitingUI();

        if (ctx.cancelled) return;

        if (ctx.error) {
            if (activeTab === "question") questionTA.value = "(Error generating question: " + ctx.error.message + ")";
            return;
        }

        if (ctx.result) {
            questionCache = { hash: hash, content: ctx.result };
            try { localStorage.setItem(QUESTION_CACHE_KEY, JSON.stringify(questionCache)); } catch (e) {}
            if (activeTab === "question") questionTA.value = ctx.result;
        } else {
            if (activeTab === "question") questionTA.value = "(Failed to generate question)";
        }
    };

    submitMessage(prompt, onstart, onend);
}

// ===== src/component_tab_snippets.js =====
// -----------------------------------------------------------------------------
// component_tab_snippets.js — Snippets tab generator.
// -----------------------------------------------------------------------------

/* ---- Snippets-tab-owned state ---- */

let snippetsTA;
let snippetsCache = { hash: null, content: "" };
const SNIPPETS_CACHE_KEY = "tm_snippets_cache";

function generateSnippets(code, hash) {

    const prompt = "Analyze the following code and understand what problem it is solving. " +
        "Then provide reusable, well-known algorithm and utility functions that would help solve this problem. " +
        "These should be GENERIC helper functions that a developer would commonly memorize and reuse across many " +
        "LeetCode problems or projects — things like BFS, DFS, Union-Find, binary search, LIS, topological sort, " +
        "segment tree operations, GCD/LCM, prefix sums, sliding window helpers, trie operations, Dijkstra, " +
        "Floyd-Warshall, KMP, matrix exponentiation, etc.\n\n" +
        "IMPORTANT — Also scan the code for:\n" +
        "1. Functions that are CALLED but never defined (missing implementations)\n" +
        "2. Functions that have EMPTY bodies or only placeholder/stub content (e.g. TODO, throw NotImplemented, pass, return default)\n" +
        "Provide full working implementations for ALL such functions too, placed BEFORE the generic helpers.\n\n" +
        "Rules:\n" +
        "- Wrap all functions inside a `class Helper` with static methods\n" +
        "- Each function must be self-contained — only depends on its inputs, no external state\n" +
        "- Match the programming language used in the code. If the language is unclear, default to C#\n" +
        "- Include FULL function bodies (not stubs) — complete, working implementations\n" +
        "- Add a brief one-line comment above each function describing what it does\n" +
        "- For missing/empty functions found in the code, add a comment like: // [Missing from code] or // [Stub in code]\n" +
        "- Only include generic helpers genuinely relevant to solving this type of problem\n" +
        "- These should be the kind of well-known algorithms that experienced developers recall from memory\n" +
        "- Enclose your ENTIRE response inside ```md and ``` so it is treated as code\n\n" +
        "Code:\n" + code;

    const onstart = (ctx) => {
        showWaitingUI();
    };

    const onend = (ctx) => {
        hideWaitingUI();

        if (ctx.cancelled) return;

        if (ctx.error) {
            if (activeTab === "snippets") snippetsTA.value = "(Error generating snippets: " + ctx.error.message + ")";
            return;
        }

        if (ctx.result) {
            snippetsCache = { hash: hash, content: ctx.result };
            try { localStorage.setItem(SNIPPETS_CACHE_KEY, JSON.stringify(snippetsCache)); } catch (e) {}
            if (activeTab === "snippets") snippetsTA.value = ctx.result;
        } else {
            if (activeTab === "snippets") snippetsTA.value = "(Failed to generate snippets)";
        }
    };

    submitMessage(prompt, onstart, onend);
}

// ===== src/component_tab_spreview.js =====
// -----------------------------------------------------------------------------
// component_tab_spreview.js — S-Preview tab generator (syntax-highlighted
// HTML rendered in a sandboxed iframe).
// -----------------------------------------------------------------------------

/* ---- S-Preview-tab-owned state ---- */

let spreviewFrame;
let spreviewCache = { hash: null, content: "" };
const SPREVIEW_CACHE_KEY = "tm_spreview_cache";

function setSpreviewContent(html) {
    const cssReset = '<style>pre,code{white-space:pre!important;tab-size:4!important}td pre{margin:0!important}</style>';
    if (html.indexOf('<head') !== -1) {
        html = html.replace(/<head[^>]*>/i, m => m + cssReset);
    } else if (html.indexOf('<html') !== -1) {
        html = html.replace(/<html[^>]*>/i, m => m + cssReset);
    } else {
        html = cssReset + html;
    }
    spreviewFrame.srcdoc = html;
}

function generateSpreview(code, hash) {

    const prompt = "Take the following source code and produce a single, self-contained HTML document that displays it " +
        "with advanced, IDE-quality syntax highlighting. Requirements:\n\n" +
        "1. Use inline CSS only (no external stylesheets or JS)\n" +
        "2. Light background (#fff) with high-contrast, WCAG AA compliant colors\n" +
        "3. Color categories (colorblind-friendly palette):\n" +
        "   - Language keywords (if, else, for, return, new, var, class, public, static, async, etc.): bold blue (#0550ae)\n" +
        "   - Type names, class names, framework types (int, long, string, bool, List, Dictionary, PriorityQueue, " +
        "HashSet, Array, Tuple, Task, etc.): teal (#0e7c6b) — color EVERY occurrence including in generics like List<int>\n" +
        "   - Numbers, numeric constants, and built-in constants (long.MaxValue, int.MinValue, null, true, false): purple (#6f42c1)\n" +
        "   - Strings and char literals: dark red (#a31515)\n" +
        "   - Method calls and function names (.Add, .Enqueue, .TryDequeue, .ToString, .Count, etc.): orange (#953800) — " +
        "color the dot AND the method name for EVERY call site\n" +
        "   - Comments: italic dark gray (#57606a)\n" +
        "   - Properties and member access (.Length, .Count, .Value): orange (#953800)\n" +
        "   - Regular identifiers: black (#24292f)\n" +
        "4. Important variables: Identify the semantically important variables in the code (function parameters, " +
        "key data structures, accumulators, result variables, graph/source/target/dist/result etc.). " +
        "Assign EACH important variable its own distinct soft pastel background color so they are visually " +
        "distinguishable at a glance. Use colors like: #fff3cd (warm yellow), #d1ecf1 (light blue), " +
        "#d4edda (light green), #f8d7da (light pink), #e2d9f3 (light lavender), #fde2c8 (light peach), " +
        "#d6eaf8 (sky blue), #dcedc8 (pale lime). Each variable gets ONE consistent color across ALL its " +
        "occurrences throughout the entire code — not just at declaration but EVERY usage. " +
        "Limit to 6-8 most important variables to avoid visual clutter.\n" +
        "Additionally, among those important variables, identify the ones that hold CORE algorithmic data structures " +
        "— the ones driving the algorithm's main logic (e.g. pq/priorityQueue in Dijkstra, visited/seen HashSet, " +
        "dp array, stack in DFS, queue in BFS, memo cache, adjacency list, tree node pointers, linked list head/curr). " +
        "Render these variables in BOLD with a slightly darker/richer background version of their assigned color. " +
        "This makes them instantly stand out as the 'engine' variables of the algorithm.\n" +
        "5. Use a monospace font (Consolas, monospace), line numbers in a gutter column, and comfortable line spacing (1.5)\n" +
        "6. Detect the programming language automatically\n" +
        "7. CRITICAL: Preserve ALL indentation exactly. Use a <pre> element with white-space:pre. " +
        "Use a <table> layout where column 1 is the line number (right-aligned, gray, padding-right:1em) " +
        "and column 2 is the code line inside a <pre> with margin:0 and white-space:pre. " +
        "Do NOT trim or collapse any leading spaces or tabs.\n" +
        "8. CRITICAL: You MUST include EVERY SINGLE LINE of the source code in the HTML output — from the very first " +
        "line to the very last line. Do NOT truncate, summarize, skip, or abbreviate ANY part of the code. " +
        "If the code has multiple functions or classes, ALL of them must appear in full. " +
        "The HTML line count must match the source code line count exactly. Do NOT add comments like " +
        "'// rest of code...' or '// similar for other functions'. Output the COMPLETE code.\n" +
        "9. Respond ONLY with the complete HTML document, nothing else — no explanations, no markdown fences\n\n" +
        "Code:\n" + code;

    const onstart = (ctx) => {
        showWaitingUI();
    };

    const onend = (ctx) => {
        hideWaitingUI();

        if (ctx.cancelled) return;

        if (ctx.error) {
            if (activeTab === "spreview") setSpreviewContent("<p style='font-family:monospace;padding:20px;color:red'>(Error: " + ctx.error.message + ")</p>");
            return;
        }

        if (ctx.result) {
            let html = ctx.result
                .replace(/^```html?\n?/i, "")
                .replace(/```\s*$/, "")
                .trim();

            spreviewCache = { hash: hash, content: html };

            try { localStorage.setItem(SPREVIEW_CACHE_KEY, JSON.stringify(spreviewCache)); } catch (e) {}

            if (activeTab === "spreview") setSpreviewContent(html);
        } else {
            if (activeTab === "spreview") setSpreviewContent("<p style='font-family:monospace;padding:20px;color:red'>(Failed to generate preview)</p>");
        }
    };

    submitMessage(prompt, onstart, onend);
}

// ===== src/component_tabbar.js =====
// -----------------------------------------------------------------------------
// component_tabbar.js — tab switching, per-tab cursor/scroll persistence,
// regenerate-current dispatch, and shared helpers (simpleHash, getEditorContent).
// -----------------------------------------------------------------------------

/* ---- Tabbar-owned state ----
   Tab buttons are constructed in createEditor() (component_window.js) but the
   active-tab selection and per-tab cursor/scroll state live here. */

let activeTab = "editor";
let editorTabBtn;
let asciiTabBtn;
let questionTabBtn;
let snippetsTabBtn;
let spreviewTabBtn;

const tabState = {
    editor:   { scrollTop: 0, selStart: 0, selEnd: 0 },
    ascii:    { scrollTop: 0, selStart: 0, selEnd: 0 },
    question: { scrollTop: 0, selStart: 0, selEnd: 0 },
    snippets: { scrollTop: 0, selStart: 0, selEnd: 0 },
    spreview: { scrollTop: 0, selStart: 0, selEnd: 0 }
};

function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(36);
}

function getEditorContent() {
    if (editorServiceWindow.mode === "maximized") {
        return mergeColumnContent();
    }
    return textarea.value;
}

function updateTabStyles() {
    if (editorServiceWindow) editorServiceWindow.setActiveTabHighlight(activeTab);
}

function getTabTA(tab) {
    if (tab === "ascii") return asciiTA;
    if (tab === "question") return questionTA;
    if (tab === "snippets") return snippetsTA;
    return textarea;
}

function saveTabState(tab) {
    if (tab === "spreview") {
        try { tabState.spreview.scrollTop = spreviewFrame.contentWindow.scrollY || 0; } catch (e) {}
        return;
    }
    const ta = getTabTA(tab);
    if (!ta) return;
    tabState[tab] = {
        scrollTop: ta.scrollTop,
        selStart: ta.selectionStart,
        selEnd: ta.selectionEnd
    };
}

function restoreTabState(tab) {
    if (tab === "spreview") {
        try { spreviewFrame.contentWindow.scrollTo(0, tabState.spreview.scrollTop); } catch (e) {}
        return;
    }
    const ta = getTabTA(tab);
    if (!ta) return;
    const s = tabState[tab];
    ta.scrollTop = s.scrollTop;
    ta.selectionStart = s.selStart;
    ta.selectionEnd = s.selEnd;
}

function regenerateCurrentTab() {
    const code = getEditorContent();
    const hash = simpleHash(code);

    if (activeTab === "ascii") {
        asciiCache = { hash: null, content: "" };
        asciiTA.value = "Regenerating ASCII diagram...";
        generateAsciiDiagram(code, hash);
    } else if (activeTab === "question") {
        questionCache = { hash: null, content: "" };
        questionTA.value = "Regenerating question...";
        generateQuestion(code, hash);
    } else if (activeTab === "snippets") {
        snippetsCache = { hash: null, content: "" };
        snippetsTA.value = "Regenerating snippets...";
        generateSnippets(code, hash);
    } else if (activeTab === "spreview") {
        spreviewCache = { hash: null, content: "" };
        setSpreviewContent("<p style='font-family:monospace;padding:20px;color:#555'>Regenerating preview...</p>");
        generateSpreview(code, hash);
    }
}

function switchTab(tabName) {

    if (tabName === activeTab) return;

    saveTabState(activeTab);

    activeTab = tabName;
    updateTabStyles();

    if (tabName === "editor") {

        asciiTA.style.display = "none";
        questionTA.style.display = "none";
        snippetsTA.style.display = "none";
        spreviewFrame.style.display = "none";

        if (editorServiceWindow.mode === "maximized") {
            columnContainer.style.display = "flex";
            (lastFocusedTA || leftTA).focus();
            restoreTabState("editor");
        } else {
            textarea.style.display = "block";
            textarea.focus();
            restoreTabState("editor");
        }
        return;
    }

    textarea.style.display = "none";
    columnContainer.style.display = "none";
    asciiTA.style.display = "none";
    questionTA.style.display = "none";
    snippetsTA.style.display = "none";
    spreviewFrame.style.display = "none";

    if (tabName === "ascii") {

        asciiTA.style.display = "block";
        asciiTA.focus();

        const code = getEditorContent();
        const hash = simpleHash(code);

        if (hash === asciiCache.hash && asciiCache.content) {
            asciiTA.value = asciiCache.content;
            restoreTabState("ascii");
            return;
        }

        /* Ascii design does NOT auto-regenerate. If the cache is stale (code changed)
           or missing, prompt the user to explicitly regenerate via Alt+R / ↻. */
        if (asciiCache.content) {
            asciiTA.value = "(Code has changed. Press ↻ or Alt+R to regenerate ASCII diagram)";
        } else {
            asciiTA.value = "(Press ↻ or Alt+R to generate ASCII diagram)";
        }
        return;
    }

    if (tabName === "question") {

        questionTA.style.display = "block";
        questionTA.focus();

        if (questionCache.content) {
            questionTA.value = questionCache.content;
            restoreTabState("question");
        } else {
            questionTA.value = "(Press ↻ or Alt+R to generate question)";
        }
        return;
    }

    if (tabName === "snippets") {

        snippetsTA.style.display = "block";
        snippetsTA.focus();

        /* Show cached content if available, otherwise prompt user to regenerate.
           Snippets does NOT auto-regenerate on code change — explicit Alt+R only. */
        if (snippetsCache.content) {
            snippetsTA.value = snippetsCache.content;
            restoreTabState("snippets");
        } else {
            snippetsTA.value = "(Press ↻ or Alt+R to generate snippets)";
        }
        return;
    }

    if (tabName === "spreview") {

        spreviewFrame.style.display = "block";

        const code = getEditorContent();
        const hash = simpleHash(code);

        if (hash === spreviewCache.hash && spreviewCache.content) {
            setSpreviewContent(spreviewCache.content);
            restoreTabState("spreview");
            return;
        }

        /* S-Preview does NOT auto-regenerate. If the cache is stale (code changed)
           or missing, prompt the user to explicitly regenerate via Alt+R / ↻. */
        if (spreviewCache.content) {
            setSpreviewContent("<p style='font-family:monospace;padding:20px;color:#555'>(Code has changed. Press ↻ or Alt+R to regenerate preview)</p>");
        } else {
            setSpreviewContent("<p style='font-family:monospace;padding:20px;color:#555'>(Press ↻ or Alt+R to generate preview)</p>");
        }
    }
}

// ===== src/component_waitingui.js =====
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
        flushLlmQueue();
        cancelCurrentLlmJob();
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

// ===== src/component_window.js =====
// -----------------------------------------------------------------------------
// component_window.js — floating container, header, min/max/close, drag,
// resize, persisted geometry, and the master createEditor() that wires the
// whole UI together.
// -----------------------------------------------------------------------------

/* ---- Window-owned state ----
   These are populated by createEditor() and read by other components. The
   window component is the sole writer; everyone else is a reader.
   Geometry/mode/visibility are persisted by ServiceWindow itself under the
   key "tm_window_editor" (derived from the appName passed to .create()). */

let container;
let textarea;
let resizeHandle;
let headerEl;
let editorServiceWindow = null;

/* ---- Framework lifecycle reactors ----
   Called by the matching framework_on_*() hook in framework.js. The framework
   does not know about windowMode; it only knows that the window component
   wants to be told when these moments happen. */

function component_window_launch() {
    if (!container) createEditor();
    editorServiceWindow.show();
}

function component_window_handle_init() {
    /* Register with the system-restore registry so framework_system_restore.js
       can re-open the editor at boot if it was visible last session. */
    ServiceWindow.registerApp("editor", component_window_launch);
}

function component_window_handle_launcher_registered() {
    /* If restored as maximized, the initial split happened before the
       container was visible (offsetHeight was 0). Re-split now. */
    if (editorServiceWindow && editorServiceWindow.mode === "maximized") redistributeColumns();
}

function component_window_handle_window_resized() {
    if (editorServiceWindow && editorServiceWindow.mode === "maximized") redistributeColumns();
}

function createEditor() {

    editorServiceWindow = new ServiceWindow();
    editorServiceWindow.create({
        appName:  "editor",
        width:  500,
        height: 350,
        shell:  shell,
        isDraggable: () => editorServiceWindow.mode !== "maximized",
        isResizable: () => editorServiceWindow.mode === "normal"
    });

    container    = editorServiceWindow.container;
    headerEl     = editorServiceWindow.headerEl;
    resizeHandle = editorServiceWindow.resizeHandle;

    const header   = headerEl;
    const minBtn   = editorServiceWindow.minBtn;
    const maxBtn   = editorServiceWindow.maxBtn;
    const closeBtn = editorServiceWindow.closeBtn;

    /* Tab bar — buttons constructed via ServiceWindow.registerTab. The
       resulting button refs are kept in the legacy globals because tabbar
       state restoration (updateTabStyles) and Alt+1..5 hotkeys still read
       them. */

    editorTabBtn   = editorServiceWindow.registerTab({ id: "editor",   label: "Editor",       title: "Alt+1", onClick: switchTab });
    asciiTabBtn    = editorServiceWindow.registerTab({ id: "ascii",    label: "Ascii design", title: "Alt+2", onClick: switchTab });
    questionTabBtn = editorServiceWindow.registerTab({ id: "question", label: "Question",     title: "Alt+3", onClick: switchTab });
    snippetsTabBtn = editorServiceWindow.registerTab({ id: "snippets", label: "Snippets",     title: "Alt+4", onClick: switchTab });
    spreviewTabBtn = editorServiceWindow.registerTab({ id: "spreview", label: "S-Preview",    title: "Alt+5", onClick: switchTab });

    /* Action buttons */

    editorServiceWindow.registerAction({
        label: "↻",
        title: "Regenerate Ascii/Question/Snippets (Alt+R)",
        onClick: regenerateCurrentTab,
        style: {
            background: "#555", color: "white", border: "none",
            borderRadius: "3px", padding: "2px 8px",
            cursor: "pointer", fontSize: "13px"
        }
    });

    editorServiceWindow.registerAction({
        label: "Command",
        title: "Execute line command (Alt+I)",
        onClick: handleLineAction
    });

    editorServiceWindow.registerAction({
        label: "Check",
        title: "Code check (Alt+C)",
        onClick: handleCodeCheck
    });

    editorServiceWindow.registerAction({
        title: "Project page on GitHub",
        html: '<svg viewBox="0 0 16 16" width="12" height="12" fill="white"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
        onClick: () => window.open("https://github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey", "_blank"),
        style: {
            background: "#555", color: "white", border: "none",
            borderRadius: "3px", padding: "3px 6px",
            cursor: "pointer", display: "flex", alignItems: "center"
        }
    });

    /* Append window control cluster (min/max/close) after the editor's own
       header content so it lands at the right edge of the header. */
    editorServiceWindow.appendControls();

    /* Window-scoped hotkeys — dispatched by service_hotkeys.js only when this
       window is the active one. Ctrl+Z/Y stay on the textarea (see
       attachEditorKeydown) but are gated on this window being active. */
    service_hotkeys_register(editorServiceWindow, "alt+1", () => switchTab("editor"));
    service_hotkeys_register(editorServiceWindow, "alt+2", () => switchTab("ascii"));
    service_hotkeys_register(editorServiceWindow, "alt+3", () => switchTab("question"));
    service_hotkeys_register(editorServiceWindow, "alt+4", () => switchTab("snippets"));
    service_hotkeys_register(editorServiceWindow, "alt+5", () => switchTab("spreview"));
    service_hotkeys_register(editorServiceWindow, "alt+i", () => handleLineAction());
    service_hotkeys_register(editorServiceWindow, "alt+c", () => handleCodeCheck());
    service_hotkeys_register(editorServiceWindow, "alt+r", () => regenerateCurrentTab());

    /* Main editor textarea */

    textarea = document.createElement("textarea");

    textarea.spellcheck = false;
    textarea.setAttribute("autocomplete", "off");
    textarea.setAttribute("autocorrect", "off");
    textarea.setAttribute("autocapitalize", "off");

    Object.assign(textarea.style, {
        flex: "1",
        width: "100%",
        resize: "none",
        background: "#1e1e1e",
        color: "#c9a36a",
        border: "none",
        outline: "none",
        padding: "10px",
        fontFamily: "monospace",
        fontSize: "13px",
        lineHeight: "18px",
        tabSize: "4"
    });

    textarea.value = localStorage.getItem("tm_editor_content") || "";

    textarea.addEventListener("input", () => {
        localStorage.setItem("tm_editor_content", textarea.value);
        editorUndoRedoStack.pushUndoDebounced(textarea);
    });

    editorUndoRedoStack.pushUndo(textarea.value, 0);

    attachEditorKeydown(textarea);

    container.appendChild(textarea);

    /* Column layout for maximized mode */

    columnContainer = document.createElement("div");

    Object.assign(columnContainer.style, {
        display: "none",
        flex: "1",
        flexDirection: "row",
        gap: "0px",
        overflow: "hidden"
    });

    leftTA = document.createElement("textarea");
    rightTA = document.createElement("textarea");

    [leftTA, rightTA].forEach(col => {

        col.spellcheck = false;
        col.setAttribute("autocomplete", "off");
        col.setAttribute("autocorrect", "off");
        col.setAttribute("autocapitalize", "off");

        Object.assign(col.style, {
            flex: "1",
            resize: "none",
            margin: "0",
            padding: "10px",
            fontFamily: "monospace",
            fontSize: "13px",
            color: "#c9a36a",
            background: "#1e1e1e",
            border: "none",
            outline: "none",
            tabSize: "4",
            lineHeight: "18px"
        });

        attachEditorKeydown(col);

        col.addEventListener("input", () => {
            if (syncing) return;
            redistributeColumns();
            const merged = mergeColumnContent();
            textarea.value = merged;
            localStorage.setItem("tm_editor_content", merged);
            editorUndoRedoStack.pushUndoDebounced(textarea);
        });
    });

    leftTA.style.borderRight = "1px solid #333";

    leftTA.addEventListener("keydown", (e) => {

        if (editorServiceWindow.mode !== "maximized") return;

        if (e.key === "ArrowDown") {
            const val = leftTA.value;
            const cur = leftTA.selectionStart;
            const after = val.substring(cur);
            if (after.indexOf("\n") === -1) {
                e.preventDefault();
                rightTA.focus();
                rightTA.selectionStart = rightTA.selectionEnd = 0;
            }
        }
    });

    rightTA.addEventListener("keydown", (e) => {

        if (editorServiceWindow.mode !== "maximized") return;
        const cur = rightTA.selectionStart;

        if (e.key === "ArrowUp") {
            const before = rightTA.value.substring(0, cur);
            if (before.indexOf("\n") === -1) {
                e.preventDefault();
                leftTA.focus();
                leftTA.selectionStart = leftTA.selectionEnd = leftTA.value.length;
            }
        }

        if (e.key === "Backspace" && cur === 0 && rightTA.selectionEnd === 0) {
            e.preventDefault();
            const leftVal = leftTA.value;
            const lastNewline = leftVal.lastIndexOf("\n");
            if (lastNewline !== -1) {
                const movedText = leftVal.substring(lastNewline + 1);
                leftTA.value = leftVal.substring(0, lastNewline);
                rightTA.value = movedText + rightTA.value;
                rightTA.focus();
                rightTA.selectionStart = rightTA.selectionEnd = movedText.length;
            } else {
                leftTA.value = leftVal + rightTA.value;
                rightTA.value = "";
                leftTA.focus();
                leftTA.selectionStart = leftTA.selectionEnd = leftVal.length;
            }
            saveMergedContent();
            redistributeColumns();
        }
    });

    columnContainer.appendChild(leftTA);
    columnContainer.appendChild(rightTA);
    container.appendChild(columnContainer);

    /* ASCII / Question / Snippets / S-Preview tab content areas */

    asciiTA = document.createElement("textarea");
    asciiTA.readOnly = true;
    asciiTA.spellcheck = false;
    Object.assign(asciiTA.style, {
        flex: "1", width: "100%", resize: "none",
        background: "#1e1e1e", color: "#c9a36a",
        border: "none", outline: "none",
        padding: "10px",
        fontFamily: "monospace", fontSize: "13px",
        lineHeight: "18px", tabSize: "4",
        display: "none"
    });
    container.appendChild(asciiTA);

    questionTA = document.createElement("textarea");
    questionTA.readOnly = true;
    questionTA.spellcheck = false;
    Object.assign(questionTA.style, {
        flex: "1", width: "100%", resize: "none",
        background: "#1e1e1e", color: "#c9a36a",
        border: "none", outline: "none",
        padding: "10px",
        fontFamily: "monospace", fontSize: "13px",
        lineHeight: "18px", tabSize: "4",
        display: "none"
    });
    container.appendChild(questionTA);

    snippetsTA = document.createElement("textarea");
    snippetsTA.spellcheck = false;
    Object.assign(snippetsTA.style, {
        flex: "1", width: "100%", resize: "none",
        background: "#1e1e1e", color: "#c9a36a",
        border: "none", outline: "none",
        padding: "10px",
        fontFamily: "monospace", fontSize: "13px",
        lineHeight: "18px", tabSize: "4",
        display: "none"
    });
    container.appendChild(snippetsTA);

    spreviewFrame = document.createElement("iframe");
    spreviewFrame.sandbox = "allow-same-origin";
    Object.assign(spreviewFrame.style, {
        flex: "1", width: "100%",
        border: "none", display: "none",
        background: "#fff"
    });
    container.appendChild(spreviewFrame);

    /* Load tab caches from localStorage */
    try { const c = localStorage.getItem(ASCII_CACHE_KEY);    if (c) asciiCache    = JSON.parse(c); } catch (e) {}
    try { const c = localStorage.getItem(QUESTION_CACHE_KEY); if (c) questionCache = JSON.parse(c); } catch (e) {}
    try { const c = localStorage.getItem(SNIPPETS_CACHE_KEY); if (c) snippetsCache = JSON.parse(c); } catch (e) {}
    try { const c = localStorage.getItem(SPREVIEW_CACHE_KEY); if (c) spreviewCache = JSON.parse(c); } catch (e) {}

    const restored = restoreEditorState();
    if (!restored) centerEditor();

    /* Window control button handlers — wrap ServiceWindow's defaults with
       editor-specific extras (tab content visibility, column layout). The
       defaults handle geometry / mode / previousBounds / resizeHandle. */

    minBtn.onclick = () => {

        const wasMinimized = editorServiceWindow.mode === "minimized";

        if (!wasMinimized && editorServiceWindow.mode === "maximized" && activeTab === "editor") {
            exitMaximizedColumnLayout();
        }

        editorServiceWindow.defaultMinimize();

        if (editorServiceWindow.mode === "minimized") {
            textarea.style.display      = "none";
            columnContainer.style.display = "none";
            asciiTA.style.display       = "none";
            questionTA.style.display    = "none";
            snippetsTA.style.display    = "none";
            spreviewFrame.style.display = "none";
        }
        else {
            /* Restoring from minimized — show the active tab's content. */
            if (activeTab === "ascii") {
                asciiTA.style.display = "block"; asciiTA.focus();
            } else if (activeTab === "question") {
                questionTA.style.display = "block"; questionTA.focus();
            } else if (activeTab === "snippets") {
                snippetsTA.style.display = "block"; snippetsTA.focus();
            } else if (activeTab === "spreview") {
                spreviewFrame.style.display = "block";
            } else {
                textarea.style.display = "block";
            }
        }

        saveEditorState();
    };

    maxBtn.onclick = () => {

        const wasMaximized = editorServiceWindow.mode === "maximized";

        if (wasMaximized && activeTab === "editor") {
            exitMaximizedColumnLayout();
        }

        editorServiceWindow.defaultMaximize();

        if (!wasMaximized && editorServiceWindow.mode === "maximized" && activeTab === "editor") {
            enterMaximizedColumnLayout();
        }

        saveEditorState();
    };

    /* closeBtn keeps ServiceWindow's default behaviour (hide container). */
}

/* ---- Initial centering ---- */

function centerEditor() {
    service_window_center(container, 500, 350);
}

/* ---- Geometry persistence ----
   ServiceWindow auto-persists geometry/mode/visibility to the localStorage
   key derived from appName. These wrappers add the editor-specific
   side-effects (entering maximized column layout, hiding tab content
   elements when minimized) that the class can't know about. */

function saveEditorState() {
    if (!editorServiceWindow) return;
    editorServiceWindow.persistState();
}

function restoreEditorState() {

    const state = editorServiceWindow.restoreState();
    if (!state) return false;

    if (editorServiceWindow.mode === "maximized") {
        enterMaximizedColumnLayout();
    }

    if (editorServiceWindow.mode === "minimized") {
        textarea.style.display = "none";
    }

    return true;
}

// ===== src/framework_kiosk.js =====
// -----------------------------------------------------------------------------
// framework_kiosk.js — kiosk-mode bootstrap. Reads localStorage["kiosk"]
// (populated by run_app.go from appsettings.json "properties") and, if set
// to the string "true", delegates to component_kiosk() which lives in
// component_kiosk.js.
// -----------------------------------------------------------------------------

function handle_kiosk() {
    try {
        if (localStorage.getItem("kiosk") === "true") {
            component_kiosk();
        }
    } catch (e) {
        // localStorage may be unavailable in restricted contexts; ignore.
    }
}

// ===== src/framework_launcher.js =====
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
            try { onlaunch(); }
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

// ===== src/framework_launcher_kdeubuntu.js =====
// -----------------------------------------------------------------------------
// framework_launcher_kdeubuntu.js — KDE/Ubuntu-style launcher registration.
//
// Thin wrapper around framework_taskbar.js. The taskbar service owns all DOM:
// wallpaper, bottom taskbar, Start button + Start menu (search + scrollable
// app list), running-apps list, system tray, up arrow for overflow, and
// clock. This file just exposes the registration entrypoint that
// framework_launcher.js delegates to.
// -----------------------------------------------------------------------------

function framework_launcher_kdeubuntu_register(textContent, onlaunch, opts) {

    framework_taskbar_init();
    framework_taskbar_register_app(textContent, onlaunch, opts);
}

// ===== src/framework_orphan_cleanup.js =====
// -----------------------------------------------------------------------------
// framework_orphan_cleanup.js — sweep stale per-app localStorage entries.
//
// Why one-shot at end of init, not per-mutation:
//   - Safe: every component_*_handle_init() has already registered with
//     ServiceWindow._apps, so we know the full set of live appNames. Deleting
//     a key for an unknown app means the owning component truly no longer
//     exists in this build (renamed, removed, or feature-flagged out).
//   - Cheap: runs once per page load, scans only a handful of keys.
//   - No surprises during normal use: nothing is deleted while the user is
//     interacting with windows, tabs, or the tray overflow popup.
//
// What we sweep:
//   - "tm_window_<appName>" geometry blobs whose appName is not in
//     ServiceWindow._apps.
//   - "tm_tray_hidden_apps" entries whose appName is not in the tray-app
//     registry. Tray apps register through framework_taskbar_register_tray_app,
//     which keeps an internal _tray_apps list — we expose
//     framework_taskbar_list_tray_apps() so this file doesn't need to reach
//     into private state.
//
// What we DO NOT sweep:
//   - Cache keys (tm_ascii_cache, tm_question_cache, …): they don't follow
//     the <prefix>_<appName> pattern and are owned by component_window's tab
//     system; cleaning them would couple this file to component internals.
//   - Anything not matching a known prefix. Unknown keys are left alone so
//     third-party data on the page isn't touched.
// -----------------------------------------------------------------------------

const FRAMEWORK_ORPHAN_PREFIX_WINDOW = "tm_window_";

function framework_orphan_cleanup() {

    /* ---- Window geometry blobs ---- */

    const liveAppNames = new Set();
    if (typeof ServiceWindow !== "undefined" && Array.isArray(ServiceWindow._apps)) {
        for (const a of ServiceWindow._apps) liveAppNames.add(a.appName);
    }

    /* Snapshot keys first — mutating localStorage while iterating its length
       index causes us to skip entries. */
    const allKeys = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            allKeys.push(localStorage.key(i));
        }
    } catch (e) { return; }

    let removedWindow = 0;
    for (const k of allKeys) {
        if (!k || !k.startsWith(FRAMEWORK_ORPHAN_PREFIX_WINDOW)) continue;
        const appName = k.slice(FRAMEWORK_ORPHAN_PREFIX_WINDOW.length);
        if (liveAppNames.has(appName)) continue;
        try { localStorage.removeItem(k); removedWindow++; } catch (e) {}
    }

    /* ---- Tray-hidden list ---- */

    let removedTray = 0;
    try {
        const liveTrayNames = new Set(
            framework_taskbar_list_tray_apps().map(a => a.appName)
        );
        const raw = localStorage.getItem("tm_tray_hidden_apps");
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                const filtered = arr.filter(n => liveTrayNames.has(n));
                if (filtered.length !== arr.length) {
                    removedTray = arr.length - filtered.length;
                    localStorage.setItem(
                        "tm_tray_hidden_apps",
                        JSON.stringify(filtered)
                    );
                }
            }
        }
    } catch (e) { /* best-effort */ }

    if (removedWindow || removedTray) {
        console.log(
            "[orphan-cleanup] removed " + removedWindow + " window state(s), " +
            removedTray + " tray-hidden entry(ies)"
        );
    }
}

// ===== src/framework_scrollbars.js =====
// -----------------------------------------------------------------------------
// framework_scrollbars.js — injects a minimalist black-theme scrollbar style
// into the host page. Targets WebKit/Blink (Chrome) via `::-webkit-scrollbar`
// pseudo-elements and also sets the standardised `scrollbar-color` /
// `scrollbar-width` properties as a fallback.
//
// Called from framework_init() after the @keyframes style is injected.
// -----------------------------------------------------------------------------

function framework_scrollbars_inject() {
    // Avoid double-injection if framework_init() is somehow called twice.
    if (document.getElementById("tm-scrollbar-style")) return;

    const style = document.createElement("style");
    style.id = "tm-scrollbar-style";
    style.textContent = `
        /* Standards-compliant (Firefox + modern Chromium) */
        * {
            scrollbar-width: thin;
            scrollbar-color: #2a2a2a #000000;
        }

        /* WebKit / Blink (Chrome, Edge, Opera) */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
            background: #000000;
        }
        ::-webkit-scrollbar-track {
            background: #000000;
            border: none;
        }
        ::-webkit-scrollbar-thumb {
            background: #2a2a2a;
            border-radius: 4px;
            border: none;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: #3d3d3d;
        }
        ::-webkit-scrollbar-thumb:active {
            background: #4d4d4d;
        }
        ::-webkit-scrollbar-corner {
            background: #000000;
        }
        /* Hide the up/down arrow buttons for a flat, minimalist look */
        ::-webkit-scrollbar-button {
            display: none;
            width: 0;
            height: 0;
        }
    `;
    document.head.appendChild(style);
}

// ===== src/framework_shell.js =====
// -----------------------------------------------------------------------------
// framework_shell.js — top-level scripting facade exposed as window.shell.
//
// The shell is a *live view* of the existing registries. It does not own
// state. Install/uninstall is the registry's job:
//     framework_taskbar_register_app / _unregister_app          (start menu)
//     framework_taskbar_register_tray_app / _unregister_tray_app (system tray)
//
// Public surface:
//   shell.launcher.<appName>()       — invokes the Start-menu app's onlaunch.
//   shell.tray.<appName>()           — invokes the tray app's onClick (toggle).
//   shell.tray.<appName>.show()      — force-show the tray icon.
//   shell.tray.<appName>.hide()      — force-hide the tray icon.
//   shell.startMenu.open() / close() / toggle()
//   shell.shellVisibility.show() / hide() / isHidden()
//   shell.list()                     — { launcher: [...], tray: [...] }
//
// Why a Proxy: the registries can grow at runtime (dynamic install via
// localStorage / src-fs at any point after boot). A Proxy resolves names
// on every access against the current registry — no caching, no re-binding,
// uninstall returns to undefined for free.
//
// Coupling: this file depends ONLY on framework_taskbar's public API
// (framework_taskbar_list_apps, _list_tray_apps, _invoke_app, _invoke_tray_app,
// _set_app_visibility, _toggle_start_menu, _close_start_menu, _show_shell,
// _hide_shell, _is_hidden). It does not poke private state.
// -----------------------------------------------------------------------------

function _framework_shell_make_launcher_proxy() {
    return new Proxy(Object.create(null), {
        get(_target, prop) {
            if (typeof prop !== "string") return undefined;
            if (prop === "help") {
                return () => "shell.launcher — Start-menu app launcher\n\n" +
                    "Methods:\n" +
                    "  shell.launcher.<appName>()  — Launch an app by name.\n" +
                    "  shell.launcher.list()       — Array of registered app names.\n\n" +
                    "Recipe:\n" +
                    "  shell.launcher.list()       // discover apps\n" +
                    "  shell.launcher.browser()    // launch browser";
            }
            if (prop === "list") {
                return () => framework_taskbar_list_apps()
                    .filter(a => a.appName)
                    .map(a => a.appName);
            }
            const app = framework_taskbar_list_apps().find(a => a.appName === prop);
            if (!app) return undefined;
            /* Re-resolve at call time so unregister-then-call fails cleanly
               (invoke_app throws) instead of invoking a stale closure. */
            const fn = () => framework_taskbar_invoke_app(prop);
            fn.appName = app.appName;
            fn.label   = app.label;
            fn.title   = app.title;
            return fn;
        },
        has(_t, prop) {
            return typeof prop === "string" &&
                !!framework_taskbar_list_apps().find(a => a.appName === prop);
        },
        ownKeys() {
            return framework_taskbar_list_apps()
                .filter(a => a.appName).map(a => a.appName);
        },
        getOwnPropertyDescriptor(_t, prop) {
            const app = framework_taskbar_list_apps().find(a => a.appName === prop);
            if (!app) return undefined;
            return { enumerable: true, configurable: true, value: this.get(_t, prop) };
        }
    });
}

function _framework_shell_make_tray_proxy() {
    return new Proxy(Object.create(null), {
        get(_target, prop) {
            if (typeof prop !== "string") return undefined;
            if (prop === "help") {
                return () => "shell.tray — System tray apps\n\n" +
                    "Methods:\n" +
                    "  shell.tray.<appName>()      — Toggle a tray app.\n" +
                    "  shell.tray.<appName>.show()  — Force-show the tray icon.\n" +
                    "  shell.tray.<appName>.hide()  — Force-hide the tray icon.\n" +
                    "  shell.tray.list()            — Array of registered tray app names.\n\n" +
                    "Recipe:\n" +
                    "  shell.tray.list()            // discover tray apps\n" +
                    "  shell.tray.console()         // toggle tray console";
            }
            if (prop === "list") {
                return () => framework_taskbar_list_tray_apps().map(a => a.appName);
            }
            const app = framework_taskbar_list_tray_apps().find(a => a.appName === prop);
            if (!app) return undefined;
            const fn = () => framework_taskbar_invoke_tray_app(prop);
            fn.appName = app.appName;
            fn.label   = app.label;
            /* Convenience handles for force-show / force-hide of the tray icon.
               Toggling visibility goes through the same path as the overflow
               popup so persisted hidden-apps state stays consistent. */
            fn.show = () => framework_taskbar_set_app_visibility(prop, true);
            fn.hide = () => framework_taskbar_set_app_visibility(prop, false);
            return fn;
        },
        has(_t, prop) {
            return typeof prop === "string" &&
                !!framework_taskbar_list_tray_apps().find(a => a.appName === prop);
        },
        ownKeys() {
            return framework_taskbar_list_tray_apps().map(a => a.appName);
        },
        getOwnPropertyDescriptor(_t, prop) {
            const app = framework_taskbar_list_tray_apps().find(a => a.appName === prop);
            if (!app) return undefined;
            return { enumerable: true, configurable: true, value: this.get(_t, prop) };
        }
    });
}

function framework_shell_init() {
    if (typeof window === "undefined") return;

    /* Overwrite unconditionally. ChatGPT's page sets its own window.shell
       (some internal object without .launcher), so a presence guard would
       silently skip our installation. The proxies are stateless — replacing
       the object on every call is cheap and idempotent in effect. We stash
       any pre-existing value under window.__pageShell in case page code
       still needs it. */
    if (window.shell && !window.shell.__tm_framework_shell) {
        window.__pageShell = window.shell;
    }

    window.shell = {
        __tm_framework_shell: true,

        help() {
            return "shell — Top-level scripting facade\n\n" +
                "Namespaces:\n" +
                "  shell.browser          — Browser tab management. shell.browser.help()\n" +
                "  shell.sessionConsole   — JS console with browser binding. shell.sessionConsole.help()\n" +
                "  shell.clock            — Clock, alarms, timers, stopwatch. shell.clock.help()\n" +
                "  shell.shelltoast       — Toast notifications. shell.shelltoast.help()\n" +
                "  shell.launcher         — Start-menu app launcher. shell.launcher.help()\n" +
                "  shell.tray             — System tray apps. shell.tray.help()\n" +
                "  shell.startMenu        — Start menu controls. shell.startMenu.help()\n" +
                "  shell.shellVisibility  — Desktop shell visibility. shell.shellVisibility.help()\n\n" +
                "Methods:\n" +
                "  shell.list()           — {launcher: [...], tray: [...]}\n\n" +
                "Tip: Call help() on any namespace to see its methods and recipes.";
        },

        launcher:   _framework_shell_make_launcher_proxy(),
        tray:       _framework_shell_make_tray_proxy(),
        shelltoast: shell_toast_build(),
        browser:    _browser_build_shell_api(),
        sessionConsole: _sc_build_shell_api(),

        startMenu: {
            help()   { return "shell.startMenu — Start menu controls\n\nMethods:\n  open() / close() / toggle()"; },
            open()   { framework_taskbar_toggle_start_menu(); },
            close()  { framework_taskbar_close_start_menu(); },
            toggle() { framework_taskbar_toggle_start_menu(); }
        },

        shellVisibility: {
            help()     { return "shell.shellVisibility — Desktop shell visibility\n\nMethods:\n  show() / hide() / isHidden()"; },
            show()     { framework_taskbar_show_shell(); },
            hide()     { framework_taskbar_hide_shell(); },
            isHidden() { return framework_taskbar_is_hidden(); }
        },

        list() {
            return {
                launcher: framework_taskbar_list_apps()
                    .filter(a => a.appName).map(a => a.appName),
                tray:     framework_taskbar_list_tray_apps().map(a => a.appName)
            };
        }
    };
}

// ===== src/framework_system_restore.js =====
// -----------------------------------------------------------------------------
// framework_system_restore.js — system-restore bootstrap. Reads
// localStorage["system_restore"] (populated by run_app.go from
// appsettings.json "properties" or set manually) and, if equal to the string
// "true", iterates the ServiceWindow app registry and re-launches every app
// whose persisted state has visible:true.
//
// Each ServiceWindow instance auto-persists geometry/mode/visibility on
// drag end, resize end, min/max/close, and show/hide — so the registry walk
// here is the only thing required at boot time to bring back the previous
// session's window layout.
// -----------------------------------------------------------------------------

function handle_system_restore() {
    try {
        if (localStorage.getItem("system_restore") !== "true") return;
    } catch (e) {
        return;
    }

    for (const { appName, launchFn } of ServiceWindow._apps) {
        try {
            const raw = localStorage.getItem("tm_window_" + appName);
            if (!raw) continue;
            const state = JSON.parse(raw);
            if (state && state.visible) {
                launchFn();
            }
        } catch (e) {
            // Malformed state — skip this app.
        }
    }
}

// ===== src/framework_taskbar.js =====
// -----------------------------------------------------------------------------
// framework_taskbar.js — KDE/Ubuntu-style desktop shell + open-windows tracker.
//
// Provides:
//   framework_taskbar_init()                 — idempotent. Builds the full-screen
//                                            wallpaper, the bottom taskbar
//                                            (start button, running apps list,
//                                            system tray, up arrow, clock),
//                                            and patches ServiceWindow.show /
//                                            .hide / .defaultMinimize so any
//                                            ServiceWindow instance is tracked
//                                            in the running-apps list
//                                            automatically.
//   framework_taskbar_register_app(label, onlaunch)
//                                          — append an entry to the Start menu.
//                                            Clicking the entry runs onlaunch.
//   framework_taskbar_minimize_window(sw)    — minimize a tracked ServiceWindow
//                                            (used by the running-apps button).
//   framework_taskbar_restore_window(sw)     — restore (un-minimize / show) a
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

function framework_taskbar_init() {

    if (_taskbar_initialized) return;
    _taskbar_initialized = true;

    _framework_taskbar_build_wallpaper();
    _framework_taskbar_build_taskbar();
    _framework_taskbar_build_start_menu();
    _framework_taskbar_patch_service_window();
    _framework_taskbar_start_clock();
    _framework_taskbar_install_hotkey();

    /* Restore the "hidden shell" preference so the user's last choice
       survives a reload. */
    if (framework_taskbar_is_hidden()) {
        framework_taskbar_hide_shell();
    }

    /* Close start menu when clicking outside it. */
    document.addEventListener("mousedown", (e) => {
        if (!_taskbar_start_menu || _taskbar_start_menu.style.display === "none") return;
        if (_taskbar_start_menu.contains(e.target)) return;
        if (_taskbar_start_btn.contains(e.target)) return;
        framework_taskbar_close_start_menu();
    });
}

/* Valid JS-identifier (so shell.launcher.<name>() always works). Numbers,
   letters, _, $; cannot start with a digit. Deliberately strict — dynamic
   installers must pick a clean appName up-front rather than relying on
   downstream slug-mangling. */
function _framework_taskbar_validate_app_name(appName) {
    if (typeof appName !== "string" || appName.length === 0) {
        throw new Error("framework_taskbar: appName must be a non-empty string");
    }
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(appName)) {
        throw new Error("framework_taskbar: appName '" + appName +
            "' must be a valid JS identifier (letters/digits/_/$, no leading digit)");
    }
}

function framework_taskbar_register_app(label, onlaunch, opts) {
    opts = opts || {};
    if (opts.appName) _framework_taskbar_validate_app_name(opts.appName);
    if (opts.appName && _taskbar_apps.find(a => a.appName === opts.appName)) {
        throw new Error("framework_taskbar: app '" + opts.appName + "' already registered");
    }
    _taskbar_apps.push({
        label:    label,
        onlaunch: onlaunch,
        icon:     opts.icon    || null,
        title:    opts.title   || null,
        appName:  opts.appName || null   // for taskbar-icon lookup by ServiceWindow.appName
    });
    _framework_taskbar_rebuild_start_list("");
}

/* Remove a previously-registered Start-menu app. Returns true if removed,
   false if not found. Safe no-throw API for hot-reload / dynamic uninstall. */
function framework_taskbar_unregister_app(appName) {
    const idx = _taskbar_apps.findIndex(a => a.appName === appName);
    if (idx < 0) return false;
    _taskbar_apps.splice(idx, 1);
    _framework_taskbar_rebuild_start_list("");
    return true;
}

/* Read-only snapshot of registered Start-menu apps. Used by framework_shell
   to back the shell.launcher.<name>() Proxy. */
function framework_taskbar_list_apps() {
    return _taskbar_apps.map(a => ({
        appName: a.appName,
        label:   a.label,
        icon:    a.icon,
        title:   a.title
    }));
}

/* Invoke a registered Start-menu app's onlaunch by appName. Throws if no
   matching app is registered or it has no onlaunch. Used by framework_shell
   so the shell file does not need to reach into the private registry. */
function framework_taskbar_invoke_app(appName) {
    const app = _taskbar_apps.find(a => a.appName === appName);
    if (!app || typeof app.onlaunch !== "function") {
        throw new Error("framework_taskbar: app '" + appName + "' has no onlaunch");
    }
    return app.onlaunch();
}

/* Resolve a human-readable label for an app by its ServiceWindow.appName.
   Looks up tray/Start-menu registries so the taskbar shows "Calculator"
   instead of "calc" and "Code Editor" instead of "editor". Falls back to
   the appName (capitalised) when no registration matches. */
function framework_taskbar_get_app_label(appName) {
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
function framework_taskbar_get_app_icon(appName) {
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

function _framework_taskbar_build_wallpaper() {

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
        framework_taskbar_close_start_menu();
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
function _framework_taskbar_inject_styles() {

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

function _framework_taskbar_build_taskbar() {

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
       defined once in framework_taskbar_inject_styles(). */
    _framework_taskbar_inject_styles();

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
        framework_taskbar_toggle_start_menu();
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
        _framework_taskbar_open_tray_overflow(up);
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

function _framework_taskbar_start_clock() {

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

function _framework_taskbar_build_start_menu() {

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
        _framework_taskbar_rebuild_start_list(search.value || "");
    });
    search.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            /* Launch the first visible match. */
            const first = _taskbar_start_list.querySelector("button[data-app-entry]");
            if (first) first.click();
        } else if (e.key === "Escape") {
            framework_taskbar_close_start_menu();
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
        _framework_taskbar_open_options_menu();
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

function _framework_taskbar_rebuild_start_list(filter) {

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
            framework_taskbar_close_start_menu();
            try { app.onlaunch(); }
            catch (err) { console.error("taskbar launch threw:", err); }
        };
        _taskbar_start_list.appendChild(entry);
    });
}

function framework_taskbar_toggle_start_menu() {
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
        _framework_taskbar_rebuild_start_list("");
        setTimeout(() => _taskbar_start_search.focus(), 0);
    } else {
        framework_taskbar_close_start_menu();
    }
}

function framework_taskbar_close_start_menu() {
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
function _framework_taskbar_install_hotkey() {

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
            framework_taskbar_toggle_start_menu();
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

function _framework_taskbar_patch_service_window() {

    const origShow = ServiceWindow.prototype.show;
    const origHide = ServiceWindow.prototype.hide;
    const origMin  = ServiceWindow.prototype.defaultMinimize;
    const origMax  = ServiceWindow.prototype.defaultMaximize;

    ServiceWindow.prototype.show = function () {
        origShow.call(this);
        _framework_taskbar_on_show(this);
    };

    ServiceWindow.prototype.hide = function () {
        origHide.call(this);
        _framework_taskbar_on_hide(this);
    };

    ServiceWindow.prototype.defaultMinimize = function () {
        origMin.call(this);
        _framework_taskbar_update_button(this);
    };

    ServiceWindow.prototype.defaultMaximize = function () {
        origMax.call(this);
        _framework_taskbar_update_button(this);
    };
}

function _framework_taskbar_find_entry(sw) {
    return _taskbar_windows.find(w => w.sw === sw) || null;
}

function _framework_taskbar_on_show(sw) {

    if (!_taskbar_running_el) return;
    /* Tray-hosted windows are represented by their tray icon, not by a
       running-apps button — skip tracking. */
    if (sw && sw._trayHandle) return;
    if (_framework_taskbar_find_entry(sw)) {
        _framework_taskbar_update_button(sw);
        return;
    }

    /* Resolve a label and icon for the taskbar button. Both are looked up
       by appName from the tray/Start-menu registries — apps register their
       icon/title once and every running-apps button picks it up
       automatically. So an editor window with appName="editor" shows up as
       "Code Editor" with a 📝 glyph, not raw "editor". */
    const label = framework_taskbar_get_app_label(sw.appName);
    const icon  = framework_taskbar_get_app_icon(sw.appName);

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
            framework_taskbar_restore_window(sw);
        } else if (ServiceWindow.activeWindow() !== sw) {
            sw._markActive();
        } else {
            framework_taskbar_minimize_window(sw);
        }
    };

    btn.ondblclick = () => {
        if (sw.visible && sw.mode !== "minimized") {
            framework_windowmanager_ensure_in_viewport(sw);
            sw._markActive();
        }
    };

    _taskbar_running_el.appendChild(btn);
    _taskbar_windows.push({ sw, btn });
    _framework_taskbar_update_button(sw);
}

function _framework_taskbar_on_hide(sw) {

    const entry = _framework_taskbar_find_entry(sw);
    if (!entry) return;

    if (entry.btn.parentElement) entry.btn.parentElement.removeChild(entry.btn);
    const idx = _taskbar_windows.indexOf(entry);
    if (idx >= 0) _taskbar_windows.splice(idx, 1);
}

function _framework_taskbar_update_button(sw) {

    const entry = _framework_taskbar_find_entry(sw);
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
   Components register a tray icon via framework_taskbar_register_tray_icon.
   Returns a handle so the caller can remove the icon when its window
   closes. The button's onClick receives the button DOM node so the caller
   can compute the popup anchor (e.g. ServiceWindow tray-mode positions
   itself just above this button). */

function framework_taskbar_register_tray_icon(opts) {

    framework_taskbar_init();
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
   Higher-level than framework_taskbar_register_tray_icon. Apps register once;
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

function _framework_taskbar_load_hidden() {
    try {
        const raw = localStorage.getItem(TRAY_HIDDEN_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function _framework_taskbar_save_hidden(arr) {
    try { localStorage.setItem(TRAY_HIDDEN_KEY, JSON.stringify(arr)); }
    catch (e) {}
}

function _framework_taskbar_is_app_hidden(appName) {
    return _framework_taskbar_load_hidden().indexOf(appName) >= 0;
}

function _framework_taskbar_set_app_hidden(appName, hidden) {
    let arr = _framework_taskbar_load_hidden();
    const idx = arr.indexOf(appName);
    if (hidden && idx < 0) arr.push(appName);
    if (!hidden && idx >= 0) arr.splice(idx, 1);
    _framework_taskbar_save_hidden(arr);
}

function framework_taskbar_register_tray_app(opts) {

    framework_taskbar_init();

    _framework_taskbar_validate_app_name(opts.appName);
    if (_tray_apps.find(a => a.appName === opts.appName)) {
        throw new Error("framework_taskbar: tray app '" + opts.appName + "' already registered");
    }

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

    if (!_framework_taskbar_is_app_hidden(app.appName)) {
        _framework_taskbar_show_app(app);
    }

    return {
        /* Programmatic show/hide — same path as the user's overflow toggle. */
        setVisible(on) {
            framework_taskbar_set_app_visibility(app.appName, on);
        }
    };
}

/* Remove a previously-registered tray app. Returns true if removed,
   false if not found. Safe no-throw API for hot-reload / dynamic uninstall.
   Also tears down the live tray button (if any) so the icon disappears. */
function framework_taskbar_unregister_tray_app(appName) {
    const idx = _tray_apps.findIndex(a => a.appName === appName);
    if (idx < 0) return false;
    const app = _tray_apps[idx];
    _framework_taskbar_hide_app(app);
    _tray_apps.splice(idx, 1);
    return true;
}

function _framework_taskbar_show_app(app) {
    if (app.handle) return;   // already shown
    app.handle = framework_taskbar_register_tray_icon({
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

function _framework_taskbar_hide_app(app) {
    if (!app.handle) return;
    app.handle.remove();
    app.handle = null;
}

function framework_taskbar_set_app_visibility(appName, on) {
    const app = _tray_apps.find(a => a.appName === appName);
    if (!app) return;
    _framework_taskbar_set_app_hidden(appName, !on);
    if (on) _framework_taskbar_show_app(app);
    else    _framework_taskbar_hide_app(app);
}

/* Look up the live tray button for an app, if currently visible.
   Returns null if the app isn't registered or is hidden. Used by
   component_*_create paths that want to wire the ServiceWindow against
   whatever button currently exists. */
function framework_taskbar_get_tray_button(appName) {
    const app = _tray_apps.find(a => a.appName === appName);
    if (!app || !app.handle) return null;
    return app.handle.button;
}

/* Read-only snapshot of the registered tray apps. Used by
   framework_orphan_cleanup to detect stale entries in the
   tm_tray_hidden_apps list. Returns shallow clones — callers must not
   mutate live registry state. */
function framework_taskbar_list_tray_apps() {
    return _tray_apps.map(a => ({
        appName: a.appName,
        label:   a.label,
        icon:    a.icon
    }));
}

/* Invoke a registered tray app's onClick by appName. Re-uses the live tray
   button (if visible) so click-coordinate-dependent decoration (the tail)
   positions correctly. Throws if no matching tray app is registered. */
function framework_taskbar_invoke_tray_app(appName) {
    const app = _tray_apps.find(a => a.appName === appName);
    if (!app) {
        throw new Error("framework_taskbar: tray app '" + appName + "' is not registered");
    }
    const btn = framework_taskbar_get_tray_button(appName);
    if (typeof app.onClick === "function") app.onClick(btn);
}

/* ---- Tray overflow popup ----
   Opened by clicking the up-arrow in the right-side cluster. Lists every
   registered tray app with: name, a Launch button, and a Show-in-tray
   toggle. A search box at the top filters the list by label. The popup
   styling mirrors ServiceMenu (glass panel) so it feels consistent. */

let _tray_overflow_popup = null;

function _framework_taskbar_close_tray_overflow() {
    if (_tray_overflow_popup) {
        if (_tray_overflow_popup._cleanup) _tray_overflow_popup._cleanup();
        if (_tray_overflow_popup.parentNode) {
            _tray_overflow_popup.parentNode.removeChild(_tray_overflow_popup);
        }
        _tray_overflow_popup = null;
    }
}

function _framework_taskbar_open_tray_overflow(anchorBtn) {

    _framework_taskbar_close_tray_overflow();

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
                _framework_taskbar_close_tray_overflow();
            };
            row.appendChild(launchBtn);

            /* Show-in-tray toggle */
            const visible = !_framework_taskbar_is_app_hidden(app.appName);
            const sw = _service_menu_make_switch(visible);
            sw.el.style.cursor = "pointer";
            sw.el.title = "Show in tray";
            sw.el.addEventListener("click", () => {
                const next = _framework_taskbar_is_app_hidden(app.appName);  // toggle: hidden -> visible
                framework_taskbar_set_app_visibility(app.appName, next);
                sw.set(next);
            });
            row.appendChild(sw.el);

            list.appendChild(row);
        }
    };

    search.addEventListener("input", rebuild);
    search.addEventListener("keydown", (e) => {
        if (e.key === "Escape") _framework_taskbar_close_tray_overflow();
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
        _framework_taskbar_close_tray_overflow();
    };
    const onKey = (e) => {
        if (e.key === "Escape") _framework_taskbar_close_tray_overflow();
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

function framework_taskbar_minimize_window(sw) {
    if (!sw) return;
    if (sw.mode !== "minimized") sw.defaultMinimize();
}

function framework_taskbar_restore_window(sw) {
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

function _framework_taskbar_open_options_menu() {

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
            getter: () => framework_taskbar_is_hidden(),
            setter: (on) => {
                if (on) framework_taskbar_hide_shell();
                else    framework_taskbar_show_shell();
            }
        })
        .addItem({
            label: "Clear all app state…",
            onClick: () => _framework_confirm_clear_state()
        })
        .openAt(p.x, p.y);
}

function framework_taskbar_is_hidden() {
    try { return localStorage.getItem(TASKBAR_HIDDEN_KEY) === "true"; }
    catch (e) { return false; }
}

function _framework_taskbar_set_hidden(flag) {
    try { localStorage.setItem(TASKBAR_HIDDEN_KEY, flag ? "true" : "false"); }
    catch (e) {}
}

function framework_taskbar_hide_shell() {

    framework_taskbar_close_start_menu();

    if (_taskbar_wallpaper_el) _taskbar_wallpaper_el.style.display = "none";
    if (_taskbar_el)           _taskbar_el.style.display           = "none";

    _framework_taskbar_set_hidden(true);
    _framework_taskbar_show_restore_btn();
}

function framework_taskbar_show_shell() {

    if (_taskbar_wallpaper_el) _taskbar_wallpaper_el.style.display = "block";
    if (_taskbar_el)           _taskbar_el.style.display           = "flex";

    _framework_taskbar_set_hidden(false);
    _framework_taskbar_hide_restore_btn();
}

/* Floating restore button, bottom-right. Mirrors the simple-launcher anchor
   on the opposite corner so it doesn't visually clash with whatever the
   user is doing. */
function _framework_taskbar_show_restore_btn() {

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
        framework_taskbar_show_shell();
    };

    document.body.appendChild(btn);
    _taskbar_restore_btn = btn;
}

function _framework_taskbar_hide_restore_btn() {
    if (_taskbar_restore_btn) _taskbar_restore_btn.style.display = "none";
}

/* ---- Clear all app state ---- */

function _framework_confirm_clear_state() {

    const existing = document.getElementById("tm-clear-state-dialog");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "tm-clear-state-dialog";
    Object.assign(overlay.style, {
        position: "fixed", inset: "0",
        background: "rgba(0,0,0,.55)", zIndex: "9999999",
        display: "flex", alignItems: "center", justifyContent: "center"
    });

    const dialog = document.createElement("div");
    Object.assign(dialog.style, {
        background: "#1e1e1e", color: "#d0d0d0",
        border: "1px solid #444", borderRadius: "10px",
        padding: "20px 24px", maxWidth: "420px", width: "90%",
        fontFamily: "monospace", fontSize: "13px",
        boxShadow: "0 12px 40px rgba(0,0,0,.6)"
    });

    const title = document.createElement("div");
    Object.assign(title.style, { fontWeight: "bold", fontSize: "15px", marginBottom: "12px", color: "#e0e0e0" });
    title.textContent = "Clear all app state";

    const msg = document.createElement("div");
    msg.style.marginBottom = "16px";
    msg.textContent = "This will remove all saved window positions, editor content, tab caches, console history, and component state. File system contents are preserved. The page will reload. Continue?";

    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, { display: "flex", gap: "10px", justifyContent: "flex-end" });

    const cancelBtn = document.createElement("button");
    Object.assign(cancelBtn.style, {
        padding: "6px 16px", border: "1px solid #555", borderRadius: "6px",
        background: "#333", color: "#ddd", cursor: "pointer", fontSize: "13px"
    });
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => overlay.remove();

    const clearBtn = document.createElement("button");
    Object.assign(clearBtn.style, {
        padding: "6px 16px", border: "1px solid #c62828", borderRadius: "6px",
        background: "#c62828", color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: "bold"
    });
    clearBtn.textContent = "Clear & Reload";
    clearBtn.onclick = () => {
        framework_clear_app_state();
        location.reload();
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(clearBtn);
    dialog.appendChild(title);
    dialog.appendChild(msg);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
}

/** Remove all tm_* localStorage keys (component/service state).
 *  Preserves non-tm_ keys (kiosk, system_restore, etc.) and
 *  IndexedDB (service_fs file contents). */
function framework_clear_app_state() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("tm_")) keysToRemove.push(key);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    console.log("framework_clear_app_state: removed " + keysToRemove.length + " key(s).");
}

// ===== src/framework_windowmanager.js =====
// ===== framework_windowmanager.js =====
// Window-management utilities that operate on ServiceWindow instances.

/**
 * Ensure the window is fully within the visible viewport. If any edge is
 * off-screen, clamp left/top so the entire window is visible. Also caps
 * width/height to the viewport if the window is larger than the screen.
 */
function framework_windowmanager_ensure_in_viewport(sw) {
    if (!sw || !sw.container) return;
    const c = sw.container;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = parseInt(c.style.left, 10) || 0;
    let top  = parseInt(c.style.top, 10)  || 0;
    let w    = c.offsetWidth;
    let h    = c.offsetHeight;

    if (w > vw) { c.style.width  = vw + "px"; w = vw; }
    if (h > vh) { c.style.height = vh + "px"; h = vh; }

    if (left < 0)          left = 0;
    if (top  < 0)          top  = 0;
    if (left + w > vw)     left = vw - w;
    if (top  + h > vh)     top  = vh - h;

    c.style.left = left + "px";
    c.style.top  = top  + "px";

    sw.persistState();
}

// ===== src/service_console.js =====
// -----------------------------------------------------------------------------
// service_console.js — FIFO command queue for the JS console window.
//
// Public API:
//
//     const ctx = await submitConsoleMessage("alert('h')");
//     // ctx === { command, result, error, cancelled }
//
//     submitConsoleMessage(
//         "var x = 1;\nfor (let i = 0; i < 3; i++) console.log(x + i);",
//         (ctx) => { /* onstart */ },
//         (ctx) => { /* onend */ }
//     );
//
// Each call to submitConsoleMessage() enqueues ONE job. The string may contain
// any number of newlines — the entire block is eval'd as a single unit (so
// `var`/`let`/`const`/`function` declarations span the whole block). Jobs run
// strictly one at a time in FIFO order — additional submissions wait their
// turn whether they came from the textbox in component_console or from another
// component calling submitConsoleMessage() directly.
//
// flushConsoleQueue() drops every PENDING job (each receives
// onend({ cancelled: true })) but does not interrupt a running job. Eval is
// synchronous, so a "running" job effectively means "scheduled this microtask"
// — there is no abort-mid-eval semantics.
//
// The actual eval + colored output rendering live in component_console.js
// (component_console_execute). This service is purely the queue.
// -----------------------------------------------------------------------------

const _console_queue = [];
let _console_processing = false;

function submitConsoleMessage(command, onstart, onend) {

    return new Promise(resolve => {
        _console_queue.push({ command, onstart, onend, resolve });
        _console_drain_queue();
    });
}

async function _console_drain_queue() {

    if (_console_processing) return;
    if (_console_queue.length === 0) return;

    _console_processing = true;

    while (_console_queue.length > 0) {

        const job = _console_queue.shift();
        const ctx = {
            command: job.command,
            result: undefined,
            error: null,
            cancelled: false
        };

        if (typeof job.onstart === "function") {
            try { job.onstart(ctx); }
            catch (e) { console.error("submitConsoleMessage onstart threw:", e); }
        }

        try {
            /* component_console_execute renders the input echo, captures
               console.*, and returns { result, error }. If the component
               window has not been created yet, lazy-create it so output is
               visible. */
            if (typeof consoleContainer !== "undefined" &&
                consoleContainer === null) {
                component_console_create();
            }

            const out = component_console_execute(job.command);
            ctx.result = out.result;
            ctx.error  = out.error;

        } catch (err) {
            ctx.error = err;
            console.error("submitConsoleMessage job failed:", err);
        }

        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("submitConsoleMessage onend threw:", e); }
        }

        try { job.resolve(ctx); } catch (_) { }

        /* Yield to the event loop between jobs so the UI can paint the new
           output line and the user can interact with the window between
           commands. */
        await new Promise(r => setTimeout(r, 0));
    }

    _console_processing = false;
}

function flushConsoleQueue() {

    const pending = _console_queue.splice(0, _console_queue.length);

    pending.forEach(job => {

        const ctx = {
            command: job.command,
            result: undefined,
            error: null,
            cancelled: true
        };

        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("flushConsoleQueue onend threw:", e); }
        }

        try { job.resolve(ctx); } catch (_) { }
    });
}

// ===== src/service_dialog.js =====
// -----------------------------------------------------------------------------
// service_dialog.js — generic modal dialog service (showResultDialog).
// Self-contained: no shared state, no external DOM deps. Reusable from any
// component. Pass (title, body) strings.
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

// ===== src/service_fs.js =====
// -----------------------------------------------------------------------------
// service_fs.js — IndexedDB-backed file store seeded by run_app.go.
//
// Layout: one IndexedDB database "tm_fs", one object store "files",
// keyed by the file's relative path under src-fs/ (forward slashes).
// Each value is { mime, dataUrl } where dataUrl is a fully-formed
// "data:<mime>;base64,<...>" string suitable for direct use in
// background-image, <img src>, <iframe srcdoc>, etc.
//
// run_app.go walks src-fs/ at boot time and calls window.__tm_seed_fs([...])
// once with every file. If the seed call lands BEFORE source.js has parsed
// (race), it stashes the payload in window.__tm_pending_fs and we drain it
// when this file initialises.
// -----------------------------------------------------------------------------

const FS_DB_NAME    = "tm_fs";
const FS_STORE_NAME = "files";

function _fs_open() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(FS_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(FS_STORE_NAME)) {
                db.createObjectStore(FS_STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

function service_fs_put(path, mime, dataUrl) {
    return _fs_open().then(db => new Promise((res, rej) => {
        const tx = db.transaction(FS_STORE_NAME, "readwrite");
        tx.objectStore(FS_STORE_NAME).put({ mime, dataUrl }, path);
        tx.oncomplete = () => res();
        tx.onerror    = () => rej(tx.error);
    }));
}

/* Returns { mime, dataUrl } or null. dataUrl is directly usable in
   background-image / <img src> / <iframe srcdoc>. */
function service_fs_get(path) {
    return _fs_open().then(db => new Promise((res, rej) => {
        const tx = db.transaction(FS_STORE_NAME, "readonly");
        const r  = tx.objectStore(FS_STORE_NAME).get(path);
        r.onsuccess = () => res(r.result || null);
        r.onerror   = () => rej(r.error);
    }));
}

function service_fs_list() {
    return _fs_open().then(db => new Promise((res, rej) => {
        const tx = db.transaction(FS_STORE_NAME, "readonly");
        const r  = tx.objectStore(FS_STORE_NAME).getAllKeys();
        r.onsuccess = () => res(r.result || []);
        r.onerror   = () => rej(r.error);
    }));
}

/* Called by run_app.go (via Runtime.evaluate) after source.js is loaded.
   `entries` is [{ path, mime, b64 }, ...]. */
window.__tm_seed_fs = function (entries) {
    if (!Array.isArray(entries)) return Promise.resolve();
    const promises = entries.map(e =>
        service_fs_put(e.path, e.mime, "data:" + e.mime + ";base64," + e.b64)
    );
    return Promise.all(promises);
};

/* Drain any pre-seed payload that arrived before source.js parsed. */
if (Array.isArray(window.__tm_pending_fs)) {
    window.__tm_seed_fs(window.__tm_pending_fs);
    window.__tm_pending_fs = null;
}

// ===== src/service_hotkeys.js =====
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

// ===== src/service_llm.js =====
// -----------------------------------------------------------------------------
// service_llm.js — LLM provider abstraction layer.
//
// This is the ONLY file that contains site-specific DOM selectors. Every other
// component in the codebase talks to the LLM exclusively through the public
// queue API (submitMessage / flushLlmQueue / cancelCurrentLlmJob). To port the
// entire UI stack to a different LLM website (e.g. Gemini, Claude, Copilot),
// rewrite the 5 provider functions below and update header.js @match — nothing
// else needs to change.
//
// ── Provider functions (site-specific, ~170 lines) ──────────────────────────
//
//   insertTextIntoChatGPT_llm(prompt)
//       Insert `prompt` text into the site's input textarea / contenteditable.
//       Current selector: #prompt-textarea
//
//   waitForSendButton_llm()
//       Poll until the send button is enabled and return it (or null on timeout).
//       Current selector: button[data-testid="send-button"]:not([disabled])
//
//   waitForAssistantResponse_llm(previousCount)
//       Two-phase poll: (1) wait for a new assistant message to appear,
//       (2) wait for streaming to stop (stop button disappears), then return
//       the cleaned response text.
//       Current selector: [data-message-author-role="assistant"]
//       Stop button: STOP_BTN_SELECTOR_llm
//
//   extractCleanText_llm(messageEl)
//       Clone a response DOM node, strip UI chrome (copy buttons, sticky
//       headers), extract text preserving code block formatting.
//       Depends on the site's response HTML structure (CodeMirror, markdown
//       <pre><code>, etc.).
//
//   sendMessage_chatgpt(prompt)
//       Orchestrator: calls insertText → waitForSendButton → click →
//       waitForAssistantResponse. Returns the cleaned response string.
//
//   sendMessage(prompt)
//       Thin dispatch — calls sendMessage_chatgpt(). To switch providers,
//       point this at your replacement (e.g. sendMessage_gemini).
//
// ── Queue API (site-agnostic, do NOT modify for porting) ────────────────────
//
//   submitMessage(prompt, onstart, onend)  — FIFO queue, one job at a time.
//   flushLlmQueue()                        — drop all pending jobs.
//   cancelCurrentLlmJob()                  — cancel the in-flight job.
//
// ── Lift-and-shift checklist ────────────────────────────────────────────────
//
//   1. Copy this file and rewrite the 5 provider functions for the target site.
//   2. Update src/header.js: change @match to the new site's URL.
//   3. If the new site has a different CSP policy, check the nonce-based eval
//      in component_console.js (component_console_eval).
//   4. Everything else (editor, tabs, clock, calc, console, shell, taskbar,
//      toast, etc.) works unchanged — they only call submitMessage().
//
// -----------------------------------------------------------------------------

const STOP_BTN_SELECTOR_llm = [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop"]'
].join(",");

function sleep_llm(ms) { return new Promise(r => setTimeout(r, ms)); }

async function insertTextIntoChatGPT_llm(prompt) {

    const input = document.querySelector("#prompt-textarea");

    if (!input) {
        alert("ChatGPT prompt box not found");
        return false;
    }

    input.focus();
    input.innerHTML = "";

    document.execCommand("insertText", false, prompt);

    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    return true;
}

async function waitForSendButton_llm() {

    for (let i = 0; i < 40; i++) {

        const btn = document.querySelector(
            'button[data-testid="send-button"]:not([disabled])'
        );

        if (btn) return btn;

        await sleep_llm(200);
    }

    return null;
}

function extractCleanText_llm(messageEl) {

    const clone = messageEl.cloneNode(true);

    /* Walk a subtree and concatenate text nodes, converting <br> to "\n".
       Necessary because ChatGPT's rendered code blocks often use <br> as the
       only line separator inside <pre><code><span>line</span><br>… and
       textContent silently drops <br>, collapsing the block to one line. */
    function extractTextWithBR(root) {
        let out = "";
        const walk = (node) => {
            if (node.nodeType === 3) {           // TEXT_NODE
                out += node.nodeValue;
                return;
            }
            if (node.nodeType !== 1) return;     // anything else: skip
            if (node.nodeName === "BR") {
                out += "\n";
                return;
            }
            node.childNodes.forEach(walk);
        };
        walk(root);
        return out;
    }

    clone.querySelectorAll("pre div.sticky").forEach(el => el.remove());
    clone.querySelectorAll('button[aria-label="Copy"]').forEach(el => el.remove());

    clone.querySelectorAll("button").forEach(btn => {
        const text = btn.textContent.trim().toLowerCase();
        if (text === "copy code" || text === "copy" || text === "copied!") {
            btn.remove();
        }
    });

    /* Code blocks arrive in any of these shapes:

         (a) <pre><code>…<br>…</code></pre>                    (markdown render)
         (b) <div class="cm-content">…<br>…</div>              (CodeMirror, old)
         (c) <div class="cm-content"><div class="cm-line">…    (CodeMirror, new)

       The unifying primitive is extractTextWithBR — text nodes pass through,
       <br> becomes "\n", everything else recurses. This handles all three
       shapes uniformly and avoids relying on innerText/textContent quirks
       (textContent drops <br>; innerText behaviour depends on CSS context
       and is unreliable inside Tampermonkey's sandbox).

       Process the most specific selectors first so a single block isn't
       captured twice. */

    const codePlaceholders = [];

    function captureCode(el, text) {
        const placeholder = "__CODE_BLOCK_" + codePlaceholders.length + "__";
        codePlaceholders.push(text);
        el.textContent = placeholder;
    }

    /* (b)/(c): CodeMirror containers. */
    clone.querySelectorAll(".cm-content").forEach(cm => {

        /* Newer CodeMirror layout: each line is a div.cm-line with no <br>
           between lines. Join their textContent with "\n" explicitly. */
        const cmLines = cm.querySelectorAll(".cm-line");
        if (cmLines.length > 0) {
            const lines = [];
            cmLines.forEach(div => lines.push(div.textContent));
            captureCode(cm, lines.join("\n"));
            return;
        }

        /* Older CodeMirror layout (or any other shape) — let the BR walker
           handle it. */
        captureCode(cm, extractTextWithBR(cm));
    });

    /* (a): Markdown <pre><code>. */
    clone.querySelectorAll("pre").forEach(pre => {

        /* Skip <pre> already replaced via the .cm-content pass above. */
        if (/__CODE_BLOCK_\d+__/.test(pre.textContent)) return;

        const code = pre.querySelector("code") || pre;
        const text = extractTextWithBR(code);
        if (!text) return;

        captureCode(pre, text);
    });

    let result = clone.innerText.trim();

    codePlaceholders.forEach((code, i) => {
        result = result.replace("__CODE_BLOCK_" + i + "__", code);
    });

    result = result.replace(/^```[\w]*\n?/gm, "").replace(/^```\s*$/gm, "");

    return result.trim();
}

function waitForAssistantResponse_llm(previousCount) {

    const isCancelled = () => !!(_llm_currentJob && _llm_currentJob.cancelled);

    return new Promise(resolve => {

        let phase = 1;

        const interval = setInterval(() => {

            if (isCancelled()) {
                clearInterval(interval);
                resolve(null);
                return;
            }

            const messages = document.querySelectorAll(
                '[data-message-author-role="assistant"]'
            );

            if (phase === 1) {
                if (messages.length > previousCount) phase = 2;
                return;
            }

            if (phase === 2) {

                const stopBtn = document.querySelector(STOP_BTN_SELECTOR_llm);

                if (!stopBtn) {
                    phase = 3;

                    setTimeout(() => {

                        if (isCancelled()) {
                            clearInterval(interval);
                            resolve(null);
                            return;
                        }

                        clearInterval(interval);

                        const finalMessages = document.querySelectorAll(
                            '[data-message-author-role="assistant"]'
                        );

                        const last = finalMessages[finalMessages.length - 1];
                        resolve(last ? extractCleanText_llm(last) : "");

                    }, 500);
                }

                return;
            }

        }, 500);
    });
}

async function sendMessage_chatgpt(prompt) {

    const previousCount = document.querySelectorAll(
        '[data-message-author-role="assistant"]'
    ).length;

    const ok = await insertTextIntoChatGPT_llm(prompt);
    if (!ok) return null;

    const sendButton = await waitForSendButton_llm();

    if (!sendButton) {
        alert("Send button not found");
        return null;
    }

    sendButton.click();

    return await waitForAssistantResponse_llm(previousCount);
}

async function sendMessage(prompt) {
    const host = location.hostname;
    if (host.includes("chatgpt.com"))      return await sendMessage_browsergpt(prompt);
    if (host.includes("build.nvidia.com")) return await sendMessage_nvidia(prompt);
    console.error("service_llm: no provider for " + host);
    return null;
}

// -----------------------------------------------------------------------------
// Public entry point.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Queued public entry point.
//
// submitMessage(prompt, onstart, onend) enqueues a prompt for sequential
// processing. Only one job runs at a time — additional submissions wait their
// turn in FIFO order.
//
//   onstart(ctx)  is invoked just before the prompt is dispatched to ChatGPT.
//   onend(ctx)    is invoked after the response arrives (success or error).
//
// `ctx` is an object: { prompt, result, error, cancelled }.
//   - On `onstart`, only `prompt` is meaningful.
//   - On `onend`, `result` is the cleaned response text (or null on
//     failure/cancel), `error` is the thrown error if any, and `cancelled`
//     is true if the user cancelled the wait (via cancelCurrentLlmJob)
//     or if the queue was flushed before the job ran.
//
// Returns a Promise that resolves with the same `ctx` passed to `onend`, so
// callers may either use callbacks, await the promise, or both.
// -----------------------------------------------------------------------------

const _llm_queue = [];
let _llm_processing = false;
let _llm_currentJob = null;   // { ctx, cancelled } while a job is in flight

function submitMessage(prompt, onstart, onend) {

    return new Promise(resolve => {

        _llm_queue.push({ prompt, onstart, onend, resolve });
        _llm_drain_queue();
    });
}

async function _llm_drain_queue() {

    if (_llm_processing) return;
    if (_llm_queue.length === 0) return;

    _llm_processing = true;

    while (_llm_queue.length > 0) {

        const job = _llm_queue.shift();
        const ctx = { prompt: job.prompt, result: null, error: null, cancelled: false };

        _llm_currentJob = { ctx, cancelled: false };

        try {
            if (typeof job.onstart === "function") {
                try { job.onstart(ctx); }
                catch (e) { console.error("submitMessage onstart threw:", e); }
            }

            const result = await sendMessage(job.prompt);

            ctx.result = result;
            if (_llm_currentJob.cancelled) {
                ctx.cancelled = true;
            } else if (result === null) {
                ctx.cancelled = true;
            }

        } catch (err) {
            ctx.error = err;
            console.error("submitMessage job failed:", err);
        }

        _llm_currentJob = null;

        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("submitMessage onend threw:", e); }
        }

        try { job.resolve(ctx); } catch (_) { }
    }

    _llm_processing = false;
}

// -----------------------------------------------------------------------------
// cancelCurrentLlmJob() — flip the cancel flag on the currently-running job
// (if any). The polling loop in waitForAssistantResponse_llm observes this on
// its next tick and bails out, resolving with null. No-op if no job is in
// flight.
// -----------------------------------------------------------------------------
function cancelCurrentLlmJob() {
    if (_llm_currentJob) _llm_currentJob.cancelled = true;
    if (typeof _browsergpt_cancel === "function") _browsergpt_cancel();
}

// -----------------------------------------------------------------------------
// flushLlmQueue() — drop all PENDING submitMessage jobs (does not touch the
// currently-running one; cancel that via cancelCurrentLlmJob()).
// Each dropped job receives an `onend({ cancelled: true })` so its caller can
// tear down UI state, then its promise resolves.
// -----------------------------------------------------------------------------
function flushLlmQueue() {

    const pending = _llm_queue.splice(0, _llm_queue.length);

    pending.forEach(job => {

        const ctx = { prompt: job.prompt, result: null, error: null, cancelled: true };

        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("flushLlmQueue onend threw:", e); }
        }

        try { job.resolve(ctx); } catch (_) { }
    });
}

// ===== src/service_llm_browsergpt.js =====
// ===== service_llm_browsergpt.js =====
// LLM provider that opens chatgpt.com inside a component_browser iframe tab
// and automates it via nonce-based eval. The parent page's ChatGPT stays
// untouched — all automation happens silently in the background iframe.
//
// Public API:
//   sendMessage_browsergpt(prompt) → string | null
//
// Lazily creates a browser tab + session console binding on first call.
// Reuses both on subsequent calls.

var _browsergpt_tab_id   = null;   // component_browser tab id
var _browsergpt_ready    = false;  // true once the iframe has loaded

/* Restore persisted tab id on load */
(function _browsergpt_restore() {
    try {
        const saved = localStorage.getItem("tm_browsergpt_tab_id");
        if (saved !== null) {
            const id = parseInt(saved, 10);
            if (!isNaN(id)) _browsergpt_tab_id = id;
        }
    } catch (_) {}
})();

function _browsergpt_persist() {
    if (_browsergpt_tab_id !== null) {
        localStorage.setItem("tm_browsergpt_tab_id", String(_browsergpt_tab_id));
    } else {
        localStorage.removeItem("tm_browsergpt_tab_id");
    }
}

async function _browsergpt_ensure_tab() {
    /* Reuse existing tab if still alive */
    if (_browsergpt_tab_id !== null) {
        const tabs = shell.browser.listTabs();
        if (tabs.some(t => t.id === _browsergpt_tab_id)) {
            /* Tab exists — make sure it's loaded */
            if (!_browsergpt_ready) await _browsergpt_wait_for_load();
            return _browsergpt_tab_id;
        }
        _browsergpt_tab_id = null;
        _browsergpt_ready  = false;
        _browsergpt_persist();
    }

    /* Create a new browser tab */
    _browsergpt_tab_id = shell.browser.newTab("https://chatgpt.com", "BrowserGPT");
    _browsergpt_ready  = false;
    _browsergpt_persist();

    /* Wait for the page to be interactive */
    await _browsergpt_wait_for_load();
    return _browsergpt_tab_id;
}

async function _browsergpt_wait_for_load() {
    /* Poll until the iframe's document reports "complete" and the prompt
       textarea is present (ChatGPT SPA fully booted). */
    for (let i = 0; i < 120; i++) {   // up to 60 seconds
        const { result } = await _browser_eval_in_tab(
            _browsergpt_tab_id,
            '(document.readyState === "complete" && !!document.querySelector("#prompt-textarea")) ? "ready" : "waiting"'
        );
        if (result === "ready") {
            _browsergpt_ready = true;
            return;
        }
        await new Promise(r => setTimeout(r, 500));
    }
    console.warn("service_llm_browsergpt: page load timed out");
    _browsergpt_ready = true;  // proceed anyway
}

async function sendMessage_browsergpt(prompt) {
    await _browsergpt_ensure_tab();

    /* Set up a cancel flag on the iframe's window that the injected script
       checks in its polling loops. cancelCurrentLlmJob() will set this. */
    const tab = _browser_get_tab(_browsergpt_tab_id);
    if (tab && tab.iframe && tab.iframe.contentWindow) {
        tab.iframe.contentWindow.__tm_browsergpt_cancel = false;
    }

    /* Inject and run the full automation as a single async IIFE inside
       the iframe. This avoids repeated eval round-trips for each step. */
    const escapedPrompt = JSON.stringify(prompt);
    /* Selectors derived from the live ChatGPT DOM (verified against a capture
       taken mid-stream):
         - Streaming flag: the composer submit button carries
           data-testid="stop-button" (aria-label="Stop answering") while
           answering, and reverts to data-testid="send-button" when done — so
           its ABSENCE reliably means "not streaming". The old
           "Stop streaming"/"Stop generating"/"Stop" labels match nothing.
         - Done flag: the per-turn action bar (Copy / Good / Bad response)
           renders only AFTER a turn finishes. A new copy-turn-action-button
           is therefore a definitive, markup-stable completion signal. */
    const stopSelectors = JSON.stringify(
        '[data-testid="stop-button"],' +
        'button[aria-label="Stop answering"]'
    );
    const doneSelectors = JSON.stringify(
        '[data-testid="copy-turn-action-button"]'
    );

    const script = `(async function() {
        function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
        function cancelled() { return !!window.__tm_browsergpt_cancel; }

        /* 1. Insert text — use direct DOM manipulation instead of
           execCommand, which requires document focus (unavailable when
           the iframe is inside a hidden ServiceWindow container). */
        var input = document.querySelector("#prompt-textarea");
        if (!input) return { error: "prompt textarea not found" };
        input.innerHTML = "";
        var p = document.createElement("p");
        p.textContent = ${escapedPrompt};
        input.appendChild(p);
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));

        /* 2. Wait for send button */
        var sendBtn = null;
        for (var i = 0; i < 40; i++) {
            if (cancelled()) return { cancelled: true };
            sendBtn = document.querySelector('button[data-testid="send-button"]:not([disabled])');
            if (sendBtn) break;
            await sleep(200);
        }
        if (!sendBtn) return { error: "send button not found" };

        /* 3. Snapshot current assistant-message count and per-turn copy-button
           count, then click send. The copy button for the NEW turn appears
           only on completion, so a later increase is our "done" signal. */
        var prevCount = document.querySelectorAll('[data-message-author-role="assistant"]').length;
        var prevCopy  = document.querySelectorAll(${doneSelectors}).length;
        sendBtn.click();

        /* 4. Wait for new assistant message to appear */
        for (var j = 0; j < 120; j++) {   // up to 60s
            if (cancelled()) return { cancelled: true };
            var msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
            if (msgs.length > prevCount) break;
            await sleep(500);
        }

        /* 5a. Wait for generation to actually START so the pre-stream gap
           isn't mistaken for completion. Bounded — a very fast reply might
           finish before we observe the stop button, so we don't hard-fail on
           timeout, and we also bail early if the turn is already done. */
        for (var s = 0; s < 40; s++) {     // up to 8s
            if (cancelled()) return { cancelled: true };
            if (document.querySelector(${stopSelectors})) break;
            if (document.querySelectorAll(${doneSelectors}).length > prevCopy) break;
            await sleep(200);
        }

        /* 5b. Wait for generation to FINISH. Signals in priority order:
             - DONE: a new per-turn action bar appeared (copy-button count
               grew). ChatGPT renders Copy/Good/Bad only after a turn
               completes — the authoritative, markup-stable signal.
             - DONE: stop button gone AND the latest assistant text has been
               stable for ~1.5s (3 ticks).
             - FALLBACK: text stable for ~4s (8 ticks) regardless, in case
               both signals drift after a future ChatGPT UI change. */
        var lastLen = -1, stableTicks = 0;
        for (var k = 0; k < 480; k++) {    // up to 240s hard cap
            if (cancelled()) return { cancelled: true };

            var doneNow   = document.querySelectorAll(${doneSelectors}).length > prevCopy;
            var streaming = !!document.querySelector(${stopSelectors});
            var msgsNow   = document.querySelectorAll('[data-message-author-role="assistant"]');
            var curEl     = msgsNow[msgsNow.length - 1];
            var len       = curEl ? curEl.textContent.length : 0;

            if (len > 0 && len === lastLen) stableTicks++; else { stableTicks = 0; lastLen = len; }

            if (doneNow && len > 0) break;               // turn action bar rendered = done
            if (!streaming && stableTicks >= 3) break;   // stream ended + settled
            if (stableTicks >= 8) break;                 // settled long enough (fallback)
            await sleep(500);
        }
        await sleep(400);  // final settle

        /* 6. Extract final response text — strip code-block chrome
           (language labels, copy buttons, sticky headers) that innerText
           includes but the user doesn't want in the raw response. */
        var finalMsgs = document.querySelectorAll('[data-message-author-role="assistant"]');
        var last = finalMsgs[finalMsgs.length - 1];
        if (!last) return { error: "no assistant message found" };

        var clone = last.cloneNode(true);
        clone.querySelectorAll("pre div.sticky").forEach(function(el) { el.remove(); });
        clone.querySelectorAll('button[aria-label="Copy"]').forEach(function(el) { el.remove(); });
        clone.querySelectorAll("button").forEach(function(btn) {
            var t = btn.textContent.trim().toLowerCase();
            if (t === "copy code" || t === "copy" || t === "copied!") btn.remove();
        });

        /* Walk text nodes, convert <br> to newline */
        function walkText(node) {
            var out = "";
            if (node.nodeType === 3) return node.nodeValue;
            if (node.nodeType !== 1) return "";
            if (node.nodeName === "BR") return "\\n";
            node.childNodes.forEach(function(c) { out += walkText(c); });
            return out;
        }

        /* Replace code blocks with their clean text content */
        clone.querySelectorAll(".cm-content").forEach(function(cm) {
            var lines = cm.querySelectorAll(".cm-line");
            if (lines.length > 0) {
                var parts = [];
                lines.forEach(function(d) { parts.push(d.textContent); });
                cm.textContent = parts.join("\\n");
                return;
            }
            cm.textContent = walkText(cm);
        });
        clone.querySelectorAll("pre").forEach(function(pre) {
            if (/__CLEANED__/.test(pre.textContent)) return;
            var code = pre.querySelector("code") || pre;
            pre.textContent = walkText(code);
        });

        var text = clone.innerText.trim();
        text = text.replace(/^\`\`\`[\\w]*\\n?/gm, "").replace(/^\`\`\`\\s*$/gm, "");
        return { text: text };
    })()`;

    const { result, error } = await _browser_eval_in_tab(_browsergpt_tab_id, script);

    if (error) {
        console.error("service_llm_browsergpt: eval error:", error);
        return await _browsergpt_last_response_fallback();
    }
    if (!result) return await _browsergpt_last_response_fallback();
    if (result.cancelled) return null;
    if (result.error) {
        console.error("service_llm_browsergpt:", result.error);
        return await _browsergpt_last_response_fallback();
    }
    return result.text || null;
}

/** Last-resort: read the latest assistant message directly from the
 *  browsergpt iframe. Used when the main automation script timed out or
 *  errored but the response may have actually arrived. */
async function _browsergpt_last_response_fallback() {
    if (_browsergpt_tab_id === null) return null;
    try {
        const readScript = `(function() {
            var msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
            var last = msgs[msgs.length - 1];
            if (!last) return null;
            var clone = last.cloneNode(true);
            clone.querySelectorAll("pre div.sticky").forEach(function(el) { el.remove(); });
            clone.querySelectorAll('button[aria-label="Copy"]').forEach(function(el) { el.remove(); });
            clone.querySelectorAll("button").forEach(function(btn) {
                var t = btn.textContent.trim().toLowerCase();
                if (t === "copy code" || t === "copy" || t === "copied!") btn.remove();
            });
            clone.querySelectorAll(".cm-content").forEach(function(cm) {
                var lines = cm.querySelectorAll(".cm-line");
                if (lines.length > 0) {
                    var parts = [];
                    lines.forEach(function(d) { parts.push(d.textContent); });
                    cm.textContent = parts.join("\\n");
                    return;
                }
            });
            var text = clone.innerText.trim();
            text = text.replace(/^\`\`\`[\\w]*\\n?/gm, "").replace(/^\`\`\`\\s*$/gm, "");
            return text || null;
        })()`;
        const { result } = await _browser_eval_in_tab(_browsergpt_tab_id, readScript);
        if (result) {
            console.log("service_llm_browsergpt: recovered response via fallback read");
            return result;
        }
    } catch (_) {}
    return null;
}

/* Called by cancelCurrentLlmJob — sets the cancel flag on the iframe
   so the in-flight browsergpt script stops polling and returns early. */
function _browsergpt_cancel() {
    if (_browsergpt_tab_id === null) return;
    try {
        const tab = _browser_get_tab(_browsergpt_tab_id);
        if (tab && tab.iframe && tab.iframe.contentWindow) {
            tab.iframe.contentWindow.__tm_browsergpt_cancel = true;
        }
    } catch (_) {}
}

// ===== src/service_llm_nvidia_build.js =====
// -----------------------------------------------------------------------------
// service_llm_nvidia_build.js — LLM provider for build.nvidia.com playground.
//
// Implements the same contract as the ChatGPT provider (service_llm.js):
//   sendMessage_nvidia(prompt) → string | null
//
// DOM selectors (build.nvidia.com):
//   Textarea:      textarea[data-testid="nv-text-area-element"]
//   Send button:   button[aria-label="Send"]
//   Cancel button: button[aria-label="cancel"]
//   Prompt bubble: div[data-testid="chat-bubble-prompt"]
//   Response:      div[data-testid="chat-bubble-response"]
//   Loading:       div[data-testid="chat-bubble-loading"]
//   Error toast:   [data-sonner-toast][data-type=error]
// -----------------------------------------------------------------------------

function sleep_nvidia(ms) { return new Promise(r => setTimeout(r, ms)); }

async function insertText_nvidia(prompt) {

    const textarea = document.querySelector('textarea[data-testid="nv-text-area-element"]');

    if (!textarea) {
        alert("NVIDIA Build prompt textarea not found");
        return false;
    }

    textarea.focus();

    /* Clear existing content */
    textarea.value = "";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    /* Use native setter to trigger React state update */
    const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
    ).set;
    nativeSetter.call(textarea, prompt);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));

    return true;
}

async function waitForSendButton_nvidia() {

    for (let i = 0; i < 40; i++) {

        const btn = document.querySelector(
            'button[aria-label="Send"]:not([disabled])'
        );

        if (btn) return btn;

        await sleep_nvidia(200);
    }

    return null;
}

function extractCleanText_nvidia(responseEl) {

    const clone = responseEl.cloneNode(true);

    /* Remove all buttons (Copy, thumbs, language tabs like "JSON") */
    clone.querySelectorAll("button").forEach(btn => btn.remove());

    /* Remove SVG icons */
    clone.querySelectorAll("svg").forEach(svg => svg.remove());

    /* Remove the code block header bar (contains "JSON" tab, "Copy" text).
       It sits inside the bordered container above the <pre>. */
    clone.querySelectorAll(".space-between").forEach(bar => bar.remove());

    /* Also remove any aria-hidden spans (e.g. "Copied" ghost text) */
    clone.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());

    /* Remove the performance stats bar (e.g. "5.88 s  4.94 TPS  16 ms TTFT") */
    clone.querySelectorAll('[data-testid="nv-tooltip-trigger"]').forEach(el => el.remove());

    /* Remove vertical separator divs between action buttons */
    clone.querySelectorAll('div[role="separator"]').forEach(el => el.remove());

    /* Code blocks: extract textContent from <pre><code> which gives clean
       text even when tokens are wrapped in <span class="token ...">. */
    clone.querySelectorAll('pre[data-testid="highlighted-code"] code').forEach(code => {
        const text = code.textContent;
        code.parentElement.textContent = text;
    });

    let result = clone.innerText || clone.textContent || "";

    /* Strip markdown fences if present */
    result = result.replace(/^```[\w]*\n?/gm, "").replace(/^```\s*$/gm, "");

    return result.trim();
}

function waitForResponse_nvidia(previousCount) {

    const isCancelled = () => !!(_llm_currentJob && _llm_currentJob.cancelled);

    return new Promise(resolve => {

        let phase = 1;

        const interval = setInterval(() => {

            if (isCancelled()) {
                clearInterval(interval);
                resolve(null);
                return;
            }

            const responses = document.querySelectorAll(
                'div[data-testid="chat-bubble-response"]'
            );

            if (phase === 1) {
                /* Wait for a new response bubble or loading indicator */
                const loading = document.querySelector(
                    'div[data-testid="chat-bubble-loading"]'
                );
                if (responses.length > previousCount || loading) {
                    phase = 2;
                }
                return;
            }

            if (phase === 2) {
                /* Wait for generation to finish:
                   - cancel button disappears
                   - loading bubble disappears
                   - no active streaming indicators */
                const cancelBtn = document.querySelector(
                    'button[aria-label="cancel"]'
                );
                const loading = document.querySelector(
                    'div[data-testid="chat-bubble-loading"]'
                );

                if (!cancelBtn && !loading) {
                    phase = 3;

                    /* Brief delay for final DOM settle */
                    setTimeout(() => {

                        if (isCancelled()) {
                            clearInterval(interval);
                            resolve(null);
                            return;
                        }

                        clearInterval(interval);

                        /* Check for error toast */
                        const errorToast = document.querySelector(
                            '[data-sonner-toast][data-type="error"]'
                        );
                        if (errorToast) {
                            const desc = errorToast.querySelector("[data-description]");
                            const errMsg = desc ? desc.textContent.trim() : "Generation error";
                            console.error("NVIDIA Build error:", errMsg);
                            resolve(null);
                            return;
                        }

                        const finalResponses = document.querySelectorAll(
                            'div[data-testid="chat-bubble-response"]'
                        );

                        const last = finalResponses[finalResponses.length - 1];
                        resolve(last ? extractCleanText_nvidia(last) : "");

                    }, 500);
                }

                return;
            }

        }, 500);
    });
}

async function sendMessage_nvidia(prompt) {

    const previousCount = document.querySelectorAll(
        'div[data-testid="chat-bubble-response"]'
    ).length;

    const ok = await insertText_nvidia(prompt);
    if (!ok) return null;

    const sendButton = await waitForSendButton_nvidia();

    if (!sendButton) {
        alert("Send button not found on NVIDIA Build");
        return null;
    }

    sendButton.click();

    return await waitForResponse_nvidia(previousCount);
}

// ===== src/service_menu.js =====
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
        /* z-index: ServiceMenu is a transient popup that must paint above
           every other shell layer — the focused window (ServiceWindow uses
           a live ._zCounter that grows on every focus), the Start menu
           (which itself syncs to _zCounter + 10 on open), and the
           notifications pane (z=1000060). Sync past the live max so a
           ServiceMenu opened from the Start menu's arrow lands ON TOP of
           the Start menu instead of behind it. */
        const baseZ = (typeof ServiceWindow !== "undefined" && ServiceWindow._zCounter)
            ? (ServiceWindow._zCounter + 20)
            : 1000020;
        Object.assign(popup.style, {
            position: "fixed",
            left: x + "px",
            top:  y + "px",
            minWidth: "200px",
            zIndex: String(baseZ),
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

// ===== src/service_session_console.js =====
// -----------------------------------------------------------------------------
// service_session_console.js — FIFO command queue for the session console.
//
// Mirrors service_console.js but scoped per-tab. Each tab's commands run
// strictly one-at-a-time in FIFO order.
//
// Public API:
//
//     const ctx = await submitSessionConsoleMessage(tabId, "document.title");
//     // ctx === { tabId, command, result, error, cancelled }
//
//     flushSessionConsoleQueue(tabId?)  // drop pending for one or all tabs
//
// The actual eval + output rendering live in component_session_console.js.
// This service is purely the queue.
// -----------------------------------------------------------------------------

const _session_console_queue = [];
let _session_console_processing = false;

function submitSessionConsoleMessage(tabId, command, onstart, onend) {

    return new Promise(resolve => {
        _session_console_queue.push({ tabId, command, onstart, onend, resolve });
        _session_console_drain_queue();
    });
}

async function _session_console_drain_queue() {

    if (_session_console_processing) return;
    if (_session_console_queue.length === 0) return;

    _session_console_processing = true;

    while (_session_console_queue.length > 0) {

        const job = _session_console_queue.shift();
        const ctx = {
            tabId:     job.tabId,
            command:   job.command,
            result:    undefined,
            error:     null,
            cancelled: false
        };

        if (typeof job.onstart === "function") {
            try { job.onstart(ctx); }
            catch (e) { console.error("submitSessionConsoleMessage onstart threw:", e); }
        }

        try {
            const out = await component_session_console_execute(job.tabId, job.command);
            ctx.result = out.result;
            ctx.error  = out.error;
        } catch (err) {
            ctx.error = err;
            console.error("submitSessionConsoleMessage job failed:", err);
        }

        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("submitSessionConsoleMessage onend threw:", e); }
        }

        try { job.resolve(ctx); } catch (_) { }

        /* Yield to event loop between jobs */
        await new Promise(r => setTimeout(r, 0));
    }

    _session_console_processing = false;
}

function flushSessionConsoleQueue(tabId) {

    const indices = [];
    for (let i = _session_console_queue.length - 1; i >= 0; i--) {
        if (tabId === undefined || _session_console_queue[i].tabId === tabId) {
            indices.push(i);
        }
    }

    indices.forEach(i => {
        const job = _session_console_queue.splice(i, 1)[0];
        const ctx = {
            tabId:     job.tabId,
            command:   job.command,
            result:    undefined,
            error:     null,
            cancelled: true
        };
        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("flushSessionConsoleQueue onend threw:", e); }
        }
        try { job.resolve(ctx); } catch (_) { }
    });
}

// ===== src/service_toast.js =====
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
// (after framework_taskbar_init has built the clock element). It attaches the
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
       same IIFE (framework_taskbar.js). Guard for the case where the shell
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

// ===== src/service_undoredo.js =====
// -----------------------------------------------------------------------------
// service_undoredo.js — reusable in-memory undo/redo stack class.
//
// Each instance owns its own undo/redo stacks, debounce timer, and re-entry
// guard. Methods take the textarea as an argument (rather than the class
// holding a reference) so the same instance survives DOM rebuilds and so the
// textarea can be created lazily — the instance is constructed at module-eval
// time, before createEditor() runs.
//
// One instance is created at the bottom of this file — `editorUndoRedoStack`
// — and is the one wired up to the main Editor textarea. Additional
// independent stacks (e.g. per column, per tab) can be instantiated by any
// other component if/when needed.
// -----------------------------------------------------------------------------

class UndoRedoStack {
    constructor({ max = 200, debounceMs = 300, storageKey = null } = {}) {
        this.undoStack = [];
        this.redoStack = [];
        this.max = max;
        this.debounceMs = debounceMs;
        this.storageKey = storageKey; // optional — persisted on undo/redo
        this.timer = null;
        this.isUndoRedo = false;
    }

    pushUndo(value, cursorPos) {
        if (this.isUndoRedo) return;
        const top = this.undoStack[this.undoStack.length - 1];
        if (top && top.value === value) return;
        this.undoStack.push({ value: value, cursor: cursorPos });
        if (this.undoStack.length > this.max) this.undoStack.shift();
        this.redoStack.length = 0;
    }

    pushUndoDebounced(ta) {
        if (this.isUndoRedo) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.pushUndo(ta.value, ta.selectionStart);
        }, this.debounceMs);
    }

    doUndo(ta) {
        if (this.undoStack.length === 0) return;

        this.redoStack.push({ value: ta.value, cursor: ta.selectionStart });

        const entry = this.undoStack.pop();
        this.isUndoRedo = true;
        ta.value = entry.value;
        ta.selectionStart = ta.selectionEnd = entry.cursor;
        if (this.storageKey) localStorage.setItem(this.storageKey, ta.value);
        this.isUndoRedo = false;
    }

    doRedo(ta) {
        if (this.redoStack.length === 0) return;

        this.undoStack.push({ value: ta.value, cursor: ta.selectionStart });

        const entry = this.redoStack.pop();
        this.isUndoRedo = true;
        ta.value = entry.value;
        ta.selectionStart = ta.selectionEnd = entry.cursor;
        if (this.storageKey) localStorage.setItem(this.storageKey, ta.value);
        this.isUndoRedo = false;
    }
}

// The Editor tab's stack. Persisted-on-apply so undo/redo also rewrites
// localStorage["tm_editor_content"] (matches the original behaviour).
const editorUndoRedoStack = new UndoRedoStack({
    max: 200,
    debounceMs: 300,
    storageKey: "tm_editor_content",
});

// ===== src/service_window.js =====
// -----------------------------------------------------------------------------
// service_window.js — generic floating-window mechanics. No knowledge of
// `windowMode`, tabs, or any editor-specific content. Functions are
// parameter-driven so they can support any future ServiceWindow instance.
//
// Step A: skeleton class + parameter-pure utilities only. Steps B–D
// will populate the class with .create(), .registerTab(), .registerAction(),
// and migrate `windowMode` / `previousBounds` to instance state.
// -----------------------------------------------------------------------------

class ServiceWindow {

    /* ---- Static app registry ----
       Each window registers itself by app name + a launcher function.
       framework_system_restore.js iterates this list at boot time to
       re-open windows that were visible on the last session. */
    static _apps = [];

    static registerApp(appName, launchFn) {
        ServiceWindow._apps.push({ appName, launchFn });
    }

    static _stateKey(appName) {
        return "tm_window_" + appName;
    }

    constructor() {
        this.appName         = null;
        this.container       = null;
        this.headerEl        = null;
        this.tabBarEl        = null;
        this.actionBarEl     = null;
        this.minBtn          = null;
        this.maxBtn          = null;
        this.closeBtn        = null;
        this.resizeHandle    = null;
        this.mode            = "normal";   // "normal" | "maximized" | "minimized"
        this.previousBounds  = null;
        this.visible         = false;
        this.titleEl         = null;
        this._tabs           = [];   // [{ id, button }]
        this._activeTabId    = null;
        this._lastActiveAt   = 0;    // timestamp set on each _markActive call
        this._shell          = null; // shell object for programmatic API
    }

    /* Build container + header + min/max/close + drag wiring + resize handle.

       opts:
         appName             — REQUIRED. Used to form the localStorage key
                               "tm_window_<appName>" for persisted geometry,
                               mode, and visibility. Two windows must not
                               share an appName.
         width, height       — initial size (defaults 500/350).
         title               — optional string. If provided, a title label is
                               appended to the tab bar slot (useful for minimal
                               apps that don't have real tabs).
         isDraggable()       — gate for drag start.
         isResizable()       — gate for resize start.
         onDragEnd()         — called after drag mouseup (in addition to
                               automatic state persistence).
         onResizeEnd()       — called after resize mouseup (in addition to
                               automatic state persistence).
         minWidth, minHeight — resize floor (defaults 300/150). */
    create(opts) {

        opts = opts || {};

        if (!opts.appName) {
            throw new Error("ServiceWindow.create: opts.appName is required");
        }
        this.appName = opts.appName;
        this._shell  = opts.shell || null;

        const width  = opts.width  || 500;
        const height = opts.height || 350;

        /* Container */
        this.container = document.createElement("div");
        Object.assign(this.container.style, {
            position: "fixed",
            width:  width  + "px",
            height: height + "px",
            background: "#1e1e1e",
            border: "1px solid #333",
            borderRadius: "0",
            zIndex: "999999",
            display: "none",
            flexDirection: "column",
            boxShadow: "0 10px 30px rgba(0,0,0,.5)",
            overflow: "hidden"
        });

        /* Header */
        this.headerEl = document.createElement("div");
        Object.assign(this.headerEl.style, {
            height: "36px",
            flexShrink: "0",
            background: "#2a2a2a",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 10px",
            cursor: "move",
            fontSize: "13px"
        });

        this.container.appendChild(this.headerEl);
        document.body.appendChild(this.container);

        /* Register so static _repaintBorders() can find every live instance
           when the active window changes. */
        ServiceWindow._instances.push(this);

        /* Mark this window active on any mousedown inside it. Capture phase
           so we observe even clicks that get e.stopPropagation'd by inner
           controls. */
        this.container.addEventListener("mousedown", () => this._markActive(), true);

        /* Tab bar (left side of header) — registerTab() appends buttons here. */
        this.tabBarEl = document.createElement("div");
        this.tabBarEl.className = "tm-tab-bar";
        Object.assign(this.tabBarEl.style, {
            display: "flex",
            gap: "0",
            flexShrink: "0"
        });
        this.headerEl.appendChild(this.tabBarEl);

        /* Optional title label — appended to the tab bar slot. Convenient for
           minimal apps that don't register any real tabs. */
        if (opts.title) {
            const titleEl = document.createElement("div");
            titleEl.textContent = opts.title;
            Object.assign(titleEl.style, {
                color: "white",
                fontSize: "12px",
                padding: "4px 10px"
            });
            this.tabBarEl.appendChild(titleEl);
            this.titleEl = titleEl;
        }

        /* Action bar (sits next to tab bar) — registerAction() appends here. */
        this.actionBarEl = document.createElement("div");
        this.actionBarEl.className = "tm-action-btns";
        Object.assign(this.actionBarEl.style, {
            display: "flex",
            gap: "4px",
            marginLeft: "10px",
            alignItems: "center"
        });
        this.headerEl.appendChild(this.actionBarEl);

        /* Drag — wrap caller's onDragEnd with auto-persist. */
        const userDragEnd = opts.onDragEnd || (() => {});
        service_window_make_draggable(this.container, this.headerEl, {
            isDraggable: opts.isDraggable,
            onDragEnd:   () => { userDragEnd(); this.persistState(); }
        });

        /* Resize handle — wrap caller's onResizeEnd with auto-persist. */
        const userResizeEnd = opts.onResizeEnd || (() => {});
        this.resizeHandle = service_window_create_resize_handle(this.container, {
            isResizable: opts.isResizable,
            onResizeEnd: () => { userResizeEnd(); this.persistState(); },
            minWidth:    opts.minWidth,
            minHeight:   opts.minHeight
        });

        /* Window control buttons (min / max / close) — onclick wired by caller.
           These are NOT appended yet; caller calls .appendControls() after it
           has populated the rest of the header so they end up last. */
        const controls = document.createElement("div");
        this._controlsEl = controls;

        this.minBtn   = document.createElement("button"); this.minBtn.textContent   = "—";
        this.maxBtn   = document.createElement("button"); this.maxBtn.textContent   = "□";
        this.closeBtn = document.createElement("button"); this.closeBtn.textContent = "×";

        [this.minBtn, this.maxBtn, this.closeBtn].forEach(btn => {
            Object.assign(btn.style, {
                marginLeft: "6px",
                background: "#444",
                color: "white",
                border: "none",
                width: "24px",
                height: "24px",
                cursor: "pointer"
            });
            controls.appendChild(btn);
        });

        /* Default min/max/close behaviour. Minimal apps (e.g. component_calc)
           get sensible defaults out-of-the-box and don't need to wire anything.
           Apps with extra concerns (e.g. component_window's tab content
           visibility + column layout) can either:
             - replace the onclick entirely (legacy pattern), or
             - call this.defaultMinimize() / .defaultMaximize() / .defaultClose()
               from their own handler and add extras around it. */
        this.minBtn.onclick   = () => this.defaultMinimize();
        this.maxBtn.onclick   = () => this.defaultMaximize();
        this.closeBtn.onclick = () => this.defaultClose();

        /* ---- Tray-mode wiring ----
           Two entry shapes:
             - opts.tray === true: register a brand-new tray icon now.
             - opts.trayButton: adopt an existing tray button (typically
               registered at init time so the icon shows up before the
               window is lazily created).
           Either way, click toggles the window: if hidden/minimized, show +
           snap above tray; if visible, hide. Outside-click anywhere not in
           the window or tray button hides the window. defaultClose is
           patched so closing also removes the tray icon. */
        if (opts.trayButton) {
            this._adoptTrayButton(opts.trayButton, opts.trayHandle || null);
        } else if (opts.tray) {
            this._installTrayMode({
                icon:  opts.trayIcon  || (opts.appName || "?").charAt(0).toUpperCase(),
                title: opts.trayTitle || opts.appName
            });
        }

        return this;
    }

    _installTrayMode(opts) {

        const handle = framework_taskbar_register_tray_icon({
            icon:    opts.icon,
            title:   opts.title,
            onClick: (btn) => this._toggleFromTray(btn)
        });
        if (!handle) return;
        this._adoptTrayButton(handle.button, handle);
    }

    /* Wire an existing tray button (e.g. one registered at init time before
       the window was lazily created) to this window. Replaces the button's
       onClick with our toggle, installs the outside-click hider, builds the
       tail, and patches defaultClose/hide to clean up. */
    _adoptTrayButton(btn, handle) {

        /* Re-adoption: when the registry hides+re-shows an app's tray icon,
           the DOM node changes. Update the live reference and re-wire the
           click handler, but don't re-install the one-time tail/outside-
           click/hide/close patches. */
        if (this._trayAdopted) {
            this._trayBtn = btn;
            this._trayHandle = handle || {
                button: btn,
                remove() { if (btn.parentElement) btn.parentElement.removeChild(btn); }
            };
            btn.onclick = (e) => {
                e.stopPropagation();
                this._toggleFromTray(btn);
            };
            return;
        }
        this._trayAdopted = true;
        this._trayBtn     = btn;

        this._trayHandle = handle || {
            button: btn,
            remove() { if (btn.parentElement) btn.parentElement.removeChild(btn); }
        };

        btn.onclick = (e) => {
            e.stopPropagation();
            this._toggleFromTray(this._trayBtn);
        };

        /* Tray apps don't need min/max — they're toggled by the tray icon
           and naturally close via outside-click. Hide the buttons but leave
           them in the DOM so any code referencing this.minBtn / this.maxBtn
           doesn't crash. */
        if (this.minBtn) this.minBtn.style.display = "none";
        if (this.maxBtn) this.maxBtn.style.display = "none";

        /* Hide the tail as soon as the user starts dragging the window —
           the tail is anchored to the tray, so once the window moves the
           anchor visualisation is wrong (and the half-tail that was
           hidden behind the window's bottom edge would otherwise
           reappear as a rhombus). Mirrors XP "tear off the balloon"
           UX. */
        if (this.headerEl) {
            this.headerEl.addEventListener("mousedown", () => {
                if (this._trayTailEl) this._trayTailEl.style.display = "none";
            });
        }

        /* Build the tail decoration once. Absolutely positioned inside the
           container, anchored to its bottom edge, pointing down toward the
           tray icon. The tail is a 14px square rotated 45deg with the same
           background as the container; only its bottom-right edge shows
           below the container, forming a triangle. The container's
           overflow:hidden would clip the tail, so we put the tail in a
           sibling element that's positioned relative to the container at
           show-time. */
        const tail = document.createElement("div");
        Object.assign(tail.style, {
            position: "fixed",
            width: "14px",
            height: "14px",
            background: "#1e1e1e",
            border: "1px solid #333",
            borderTop: "none",
            borderLeft: "none",
            transform: "rotate(45deg)",
            transformOrigin: "center",
            zIndex: "999998",
            display: "none",
            pointerEvents: "none"
        });
        document.body.appendChild(tail);
        this._trayTailEl = tail;

        /* Outside-click hide. Capture phase + checking the original target
           so we observe clicks before any inner stopPropagation can swallow
           them. We must NOT hide if the click landed inside this window's
           container, the tray button, or the tail itself. Per the user's
           choice (strict), clicks on other ServiceWindows DO hide this one. */
        this._trayOutsideHandler = (e) => {
            if (!this.visible) return;
            if (this.mode === "minimized") return;
            if (this.container && this.container.contains(e.target)) return;
            if (this._trayBtn && this._trayBtn.contains(e.target)) return;
            if (tail.contains(e.target)) return;
            this.hide();
        };
        document.addEventListener("mousedown", this._trayOutsideHandler, true);

        /* Patch defaultClose to also hide the tail. The tray icon itself
           PERSISTS — it's how the user re-launches the app. The icon is
           only removed if/when the entire app tears down (not currently
           wired). hide() already runs inside defaultClose via this.hide(). */
        const origClose = this.defaultClose.bind(this);
        this.defaultClose = () => {
            origClose();
            if (this._trayTailEl) this._trayTailEl.style.display = "none";
        };

        /* Patch hide() to also hide the tail. show() positioning happens via
           _toggleFromTray, which paints the tail; if the user calls show()
           directly (e.g. system_restore), we still re-snap to the tray. */
        const origHide = this.hide.bind(this);
        this.hide = () => {
            origHide();
            if (this._trayTailEl) this._trayTailEl.style.display = "none";
        };
    }

    /* Snap the window above the tray button and show it. Always re-snaps
       (per user's choice) — any drag is forgotten on next tray click. */
    _toggleFromTray(btn) {

        /* Hide every OTHER visible tray-mode window first. With mouse clicks
           the outside-click handler takes care of this, but keyboard shortcuts
           (Ctrl+1..9) don't fire mousedown so we must do it explicitly. */
        for (const sw of ServiceWindow._instances) {
            if (sw === this) continue;
            if (sw._trayAdopted && sw.visible && sw.mode !== "minimized") {
                sw.hide();
            }
        }

        if (this.visible && this.mode !== "minimized") {
            this.hide();
            return;
        }

        /* Show first so offsetWidth/Height are valid for the snap math.
           Animation plays from the fixed bottom-center origin (taskbar). */
        this.show();

        if (this.mode === "maximized") return;   // maximized fills viewport; no snap
        if (this.mode === "minimized") return;   // header-only strip; no snap

        /* If no tray button is currently attached (icon hidden via registry),
           skip the snap+tail and just leave the window where the user last
           dragged it / where restoreState put it. */
        if (!btn) {
            if (this._trayTailEl) this._trayTailEl.style.display = "none";
            this.persistState();
            return;
        }

        const r = btn.getBoundingClientRect();
        const cw = this.container.offsetWidth;
        const ch = this.container.offsetHeight;
        const vw = window.innerWidth;

        /* Tail geometry. The tail is a `tailSide`-px square rotated 45°.
           After rotation its bounding diamond is `tailSide * √2` tall,
           so it extends `tailHalfDiag` px above AND below center. We
           want only the BOTTOM half visible (a downward triangle), so
           we place the tail's CSS center exactly at the window's bottom
           edge — the top half is then hidden behind the opaque window
           container, and the bottom half pokes down toward the tray. */
        const tailSide     = 14;
        const tailHalfDiag = Math.round(tailSide * Math.SQRT2 / 2);   // ~10
        /* Gap between the window's bottom edge and the tray button top.
           Needs room for the visible bottom half (`tailHalfDiag`) plus
           a few px of breathing room. */
        const tailGap = tailHalfDiag + 6;

        let left = Math.round(r.left + r.width / 2 - cw / 2);
        left = Math.max(8, Math.min(left, vw - cw - 8));

        /* Window bottom sits `tailGap` px above the tray-button top so the
           full rotated tail fits cleanly in the gap. */
        let top = Math.round(r.top - tailGap - ch);
        top = Math.max(8, top);

        this.container.style.left = left + "px";
        this.container.style.top  = top  + "px";

        /* Tail: anchored to the horizontal center of the tray button. We
           position it so the top of the visible diamond aligns with the
           window's bottom edge (tail appears to "grow out of" the window)
           and the tip points down at the tray icon. Hidden if the window
           had to clamp far enough that the tail center would no longer be
           horizontally under the window. */
        if (this._trayTailEl) {
            const tailCenterX  = Math.round(r.left + r.width / 2);
            const windowBottom = top + ch;
            /* Place the tail's CSS center exactly at the window's bottom
               edge. After rotation, only the bottom half of the diamond
               extends below the window — that's the visible triangle.
               The top half is occluded by the opaque window container. */
            const tailCenterY  = windowBottom;
            const tailLeft = tailCenterX - tailSide / 2;
            const tailTop  = tailCenterY - tailSide / 2;

            const tailWithinWindow =
                tailCenterX >= left + tailHalfDiag &&
                tailCenterX <= left + cw - tailHalfDiag;

            if (tailWithinWindow) {
                this._trayTailEl.style.width  = tailSide + "px";
                this._trayTailEl.style.height = tailSide + "px";
                this._trayTailEl.style.left = tailLeft + "px";
                this._trayTailEl.style.top  = tailTop  + "px";
                this._trayTailEl.style.display = "block";
            } else {
                this._trayTailEl.style.display = "none";
            }
        }

        this.persistState();

        /* Auto-focus the first text input inside the window so the user can
           start typing immediately after a tray click / Ctrl+1..9 launch.
           rAF lets layout settle (the snap above just changed left/top) so
           focus() doesn't trigger a scroll-into-view glitch on the page
           underneath. Skip if focus already landed inside the window
           between show() and this rAF tick. */
        requestAnimationFrame(() => {
            if (!this.visible || !this.container) return;
            const ae = document.activeElement;
            if (ae && ae !== document.body && this.container.contains(ae)) return;
            this._focusFirstInput();
        });
    }

    /* Find and focus the first visible input/textarea/contenteditable inside
       the container. Selects existing text on <input type=text|number> and
       <textarea> so the user can overwrite immediately. Used by tray-mode
       openers (_toggleFromTray); safe to call any time. */
    _focusFirstInput() {
        if (!this.container) return;
        const sel = "input:not([type=hidden]):not([disabled]):not([readonly])," +
                    "textarea:not([disabled]):not([readonly])," +
                    "[contenteditable=\"true\"]";
        const candidates = this.container.querySelectorAll(sel);
        for (const el of candidates) {
            if (el.offsetParent === null) continue;   // hidden subtree
            try {
                el.focus({ preventScroll: true });
                if (typeof el.select === "function" &&
                    (el.tagName === "TEXTAREA" ||
                     (el.tagName === "INPUT" &&
                      /^(text|number|search|email|url|tel|password)$/i.test(el.type)))) {
                    el.select();
                }
            } catch (e) {}
            return;
        }
    }

    /* ---- Active window tracking ----
       The "active" window is the most recently shown or interacted-with
       ServiceWindow. Hotkey handlers (e.g. Alt+Q to close) read this so
       there's a clear target when the user has multiple windows open.
       _instances is an internal registry so _markActive can repaint every
       window's border on each focus change. */
    static _active = null;
    static _instances = [];
    /* Monotonic z-index counter. Bumped on every _markActive so the most
       recently focused window always paints on top. Starts at the original
       fixed z-index used for windows so we stay below the taskbar (which
       sits at 1000000+). The counter is unbounded but practically can't
       overflow within a session. */
    static _zCounter = 999999;

    static activeWindow() {
        return ServiceWindow._active;
    }

    _markActive() {
        ServiceWindow._active = this;
        this._lastActiveAt = Date.now();
        if (this.container) {
            ServiceWindow._zCounter++;
            this.container.style.zIndex = String(ServiceWindow._zCounter);
        }
        ServiceWindow._repaintBorders();
    }

    static _repaintBorders() {
        for (const w of ServiceWindow._instances) {
            if (!w.container) continue;
            /* Maximised windows reach to the viewport edges — a 1px cyan
               accent there reads as a stray line, not as focus. Tray-mode
               windows are popups, not persistent app windows, so the cyan
               focus border reads as noise on them too. Cyan only paints on
               active, not-maximised, non-tray windows. */
            const isActive =
                (w === ServiceWindow._active) &&
                (w.mode !== "maximized") &&
                !w._trayHandle;
            w.container.style.borderColor = isActive ? "#4fc3f7" : "#333";
        }
    }

    /* ---- Open/close animations ----
       Scale + fade from a fixed bottom-center origin (taskbar area). Fast
       (120ms open, 100ms close) so frequent launcher / Ctrl+1..9 use never
       feels sluggish. Honours `prefers-reduced-motion` by skipping entirely.
       The transform / transformOrigin / opacity are cleared after the
       animation so drag/resize/inspection see a clean container. */

    static _ANIM_OPEN_MS   = 120;
    static _ANIM_CLOSE_MS  = 100;
    static _ANIM_ORIGIN    = "50% 100%";   // bottom-center of container

    static _reducedMotion() {
        try {
            return window.matchMedia &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        } catch (e) { return false; }
    }

    _playOpenAnim() {
        if (!this.container) return;
        if (ServiceWindow._reducedMotion()) return;

        /* Cancel any in-flight close animation first. */
        if (this._animTimer) { clearTimeout(this._animTimer); this._animTimer = null; }

        const c = this.container;
        const dur = ServiceWindow._ANIM_OPEN_MS;
        c.style.transformOrigin = ServiceWindow._ANIM_ORIGIN;
        c.style.transition      = "none";
        c.style.transform       = "scale(0.85)";
        c.style.opacity         = "0";
        /* Force layout flush so the starting state is committed before we
           switch to the transitioned end state. */
        // eslint-disable-next-line no-unused-expressions
        c.offsetWidth;
        c.style.transition = "transform " + dur + "ms cubic-bezier(.2,.8,.2,1), opacity " + dur + "ms ease-out";
        c.style.transform  = "scale(1)";
        c.style.opacity    = "1";

        this._animTimer = setTimeout(() => {
            this._animTimer = null;
            if (!this.container) return;
            this.container.style.transition      = "";
            this.container.style.transform       = "";
            this.container.style.transformOrigin = "";
            this.container.style.opacity         = "";
        }, dur + 20);
    }

    _playCloseAnim(done) {
        if (!this.container) { if (done) done(); return; }
        if (ServiceWindow._reducedMotion()) { if (done) done(); return; }

        if (this._animTimer) { clearTimeout(this._animTimer); this._animTimer = null; }

        const c = this.container;
        const dur = ServiceWindow._ANIM_CLOSE_MS;
        c.style.transformOrigin = ServiceWindow._ANIM_ORIGIN;
        c.style.transition      = "transform " + dur + "ms ease-in, opacity " + dur + "ms ease-in";
        c.style.transform       = "scale(0.9)";
        c.style.opacity         = "0";

        this._animTimer = setTimeout(() => {
            this._animTimer = null;
            if (this.container) {
                this.container.style.transition      = "";
                this.container.style.transform       = "";
                this.container.style.transformOrigin = "";
                this.container.style.opacity         = "";
            }
            if (done) done();
        }, dur + 10);
    }

    /* ---- Show / hide (auto-persists visibility) ---- */

    show() {
        if (!this.container) return;
        const wasVisible = this.visible;
        this.container.style.display = "flex";
        this.visible = true;
        this._markActive();
        /* If the persisted position has drifted off-screen (e.g. browser was
           resized smaller while the window was closed), pull the window back
           to the centre of the viewport. Maximised windows are always
           full-viewport, so they're exempt. */
        if (this.mode !== "maximized") {
            this._ensureOnScreen();
        }
        this.persistState();

        /* Open animation. Skipped if the window was already visible
           (e.g. show() called twice during a maximize transition). */
        if (!wasVisible) {
            this._playOpenAnim();
        }
    }

    /* Recenter the window if its current bounds aren't fully inside the
       viewport. Uses the live offsetWidth/Height (post-layout) rather than
       the inline style so percentages and "100vw" resolve correctly. */
    _ensureOnScreen() {
        const w = this.container.offsetWidth;
        const h = this.container.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const left = parseInt(this.container.style.left, 10);
        const top  = parseInt(this.container.style.top,  10);

        const offscreen =
            isNaN(left) || isNaN(top) ||
            left < 0 || top < 0 ||
            left + w > vw || top + h > vh;

        if (offscreen) {
            const newLeft = Math.max(0, (vw - w) / 2);
            const newTop  = Math.max(0, (vh - h) / 2);
            this.container.style.left = newLeft + "px";
            this.container.style.top  = newTop  + "px";
        }
    }

    hide() {
        if (!this.container) return;
        const wasVisible = this.visible;
        this.visible = false;

        if (wasVisible) {
            this._playCloseAnim(() => {
                /* Only actually hide if nobody re-showed the window during
                   the brief animation. */
                if (!this.visible && this.container) {
                    this.container.style.display = "none";
                }
            });
        } else {
            this.container.style.display = "none";
        }
        /* Promote the most-recently-interacted-with visible peer to active.
           Picking by max _lastActiveAt matches OS focus-fallback semantics:
           when you close the front window, the previously front-most one
           returns to focus, not an arbitrary other. If nothing is visible
           any more, _active clears. */
        if (ServiceWindow._active === this) {
            const next = ServiceWindow._pickPromotion(this);
            if (next) {
                next._markActive();   // sets _active + repaints
            } else {
                ServiceWindow._active = null;
                ServiceWindow._repaintBorders();
            }
        }
        this.persistState();
    }

    /* Choose which visible peer (excluding `closing`) should become active
       after `closing` is hidden. Returns null when no eligible peer exists. */
    static _pickPromotion(closing) {
        let best = null;
        let bestAt = -1;
        for (const w of ServiceWindow._instances) {
            if (w === closing) continue;
            if (!w.visible) continue;
            if (!w.container) continue;
            if (w._lastActiveAt > bestAt) {
                best = w;
                bestAt = w._lastActiveAt;
            }
        }
        return best;
    }

    /* ---- Default window-control behaviours ---- */

    defaultClose() {
        this.hide();
    }

    defaultMaximize() {

        if (!this.container) return;

        if (this.mode !== "maximized") {

            this.previousBounds = {
                left:   this.container.style.left,
                top:    this.container.style.top,
                width:  this.container.style.width,
                height: this.container.style.height
            };

            this.container.style.left   = "0";
            this.container.style.top    = "0";
            this.container.style.width  = "100vw";
            this.container.style.height = "100vh";

            if (this.resizeHandle) this.resizeHandle.style.display = "none";
            this.mode = "maximized";
        }
        else {

            if (this.previousBounds) {
                this.container.style.left   = this.previousBounds.left;
                this.container.style.top    = this.previousBounds.top;
                this.container.style.width  = this.previousBounds.width;
                this.container.style.height = this.previousBounds.height;
            }

            if (this.resizeHandle) this.resizeHandle.style.display = "block";
            this.mode = "normal";
        }

        ServiceWindow._repaintBorders();
        this.persistState();
    }

    defaultMinimize() {

        if (!this.container) return;

        if (this.mode !== "minimized") {

            this.previousBounds = {
                left:   this.container.style.left,
                top:    this.container.style.top,
                width:  this.container.style.width,
                height: this.container.style.height
            };

            this.container.style.height = "36px";
            if (this.resizeHandle) this.resizeHandle.style.display = "none";
            this.mode = "minimized";
        }
        else {

            if (this.previousBounds) {
                this.container.style.left   = this.previousBounds.left;
                this.container.style.top    = this.previousBounds.top;
                this.container.style.width  = this.previousBounds.width;
                this.container.style.height = this.previousBounds.height;
            } else {
                this.container.style.height = "350px";
            }

            if (this.resizeHandle) this.resizeHandle.style.display = "block";
            this.mode = "normal";
        }

        ServiceWindow._repaintBorders();
        this.persistState();
    }

    /* ---- State persistence ----
       Event-driven, not periodic. Called automatically after drag end,
       resize end, min/max/close, and show/hide. Components that mutate
       window geometry directly (e.g. component_window's column-layout
       transitions) should call .persistState() at the end of their handler. */

    persistState() {
        if (!this.appName || !this.container) return;
        const key = ServiceWindow._stateKey(this.appName);

        /* Tray-mode windows snap above the tray icon on every show, so
           persisting geometry is pointless. They also should not auto-restore
           on page load, so skip the visible flag entirely. */
        if (this._trayAdopted) return;

        const state = {
            left:           this.container.style.left,
            top:            this.container.style.top,
            width:          this.container.style.width,
            height:         this.container.style.height,
            mode:           this.mode,
            previousBounds: this.previousBounds,
            visible:        this.visible
        };
        try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {}
    }

    /* Restore geometry + mode + previousBounds + visible flag from
       localStorage. Returns the parsed state object (or null if none).
       Does NOT call .show() — caller decides whether to re-open the window
       based on state.visible (typically driven by framework_system_restore). */
    restoreState() {
        if (!this.appName || !this.container) return null;
        if (this._trayAdopted) return null;

        const key = ServiceWindow._stateKey(this.appName);
        let state;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            state = JSON.parse(raw);
        } catch (e) { return null; }

        if (state.left)   this.container.style.left   = state.left;
        if (state.top)    this.container.style.top    = state.top;
        if (state.width)  this.container.style.width  = state.width;
        if (state.height) this.container.style.height = state.height;

        this.mode           = state.mode || "normal";
        this.previousBounds = state.previousBounds || null;
        this.visible        = !!state.visible;

        if (this.mode === "maximized") {
            this.container.style.left   = "0";
            this.container.style.top    = "0";
            this.container.style.width  = "100vw";
            this.container.style.height = "100vh";
            if (this.resizeHandle) this.resizeHandle.style.display = "none";
        } else if (this.mode === "minimized") {
            this.container.style.height = "36px";
            if (this.resizeHandle) this.resizeHandle.style.display = "none";
        }

        return state;
    }

    /* Caller invokes this after appending its own header content so the
       min/max/close cluster ends up at the right edge of the header. */
    appendControls() {
        this.headerEl.appendChild(this._controlsEl);
        if (this._shell) this._buildShellAPI();
    }

    /* Re-scan [data-shell] elements and rebuild the shell namespace.
       Call after dynamically adding new data-shell elements. */
    refreshShellAPI() {
        if (this._shell) this._buildShellAPI();
    }

    /* Walk this.container for [data-shell] elements and generate
       getter/setter/action methods on shell.<appName>. */
    _buildShellAPI() {
        const self = this;
        const ns = {};

        /* Utility: "operand1" → "Operand1" for method name suffixes */
        function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

        this.container.querySelectorAll("[data-shell]").forEach(function (el) {
            const name = el.dataset.shell;
            const tag  = el.tagName.toLowerCase();
            const type = (el.type || "").toLowerCase();

            if (tag === "input" && type === "checkbox") {
                ns["is" + cap(name)]  = function ()  { return el.checked; };
                ns["set" + cap(name)] = function (v) { el.checked = !!v; };
            } else if (tag === "input" || tag === "textarea") {
                ns["get" + cap(name)] = function ()  { return el.value; };
                ns["set" + cap(name)] = function (v) { el.value = v; };
            } else if (tag === "select") {
                ns["get" + cap(name)] = function ()  { return el.value; };
                ns["set" + cap(name)] = function (v) { el.value = v; };
            } else if (tag === "button") {
                ns["click" + cap(name)] = function () { el.click(); };
            } else {
                /* div, span, label, or any other element — read-only text */
                ns["get" + cap(name)] = function () { return el.textContent; };
            }
        });

        /* Window-level helpers */
        ns.show      = function () { self.show(); };
        ns.hide      = function () { self.hide(); };
        ns.isVisible = function () { return self.visible; };

        this._shell[this.appName] = ns;
    }

    /* Create a body <div> below the header, append it to the container,
       and return it. Convenient for minimal apps so they don't have to
       hand-roll a flex-column wrapper.

       opts (all optional):
         padding   — default "12px"
         gap       — default "8px"
         color     — default "white"
         fontSize  — default "13px"
         direction — "column" (default) | "row"
         style     — additional Object.assign overrides applied last */
    createBody(opts) {

        opts = opts || {};
        const body = document.createElement("div");

        Object.assign(body.style, {
            flex: "1",
            display: "flex",
            flexDirection: opts.direction || "column",
            gap:       opts.gap      || "8px",
            padding:   opts.padding  || "12px",
            color:     opts.color    || "white",
            fontSize:  opts.fontSize || "13px",
            overflow: "auto"
        });

        if (opts.style) Object.assign(body.style, opts.style);

        this.container.appendChild(body);
        this.bodyEl = body;
        return body;
    }

    /* Create a styled label <div>. Caller updates .textContent later to
       reflect dynamic state.
       shellName — optional data-shell key for the shell API. */
    createLabel(text, shellName) {

        const el = document.createElement("div");
        el.textContent = text || "";
        if (shellName) el.dataset.shell = shellName;

        Object.assign(el.style, {
            marginTop: "4px",
            color: "#ddd",
            fontSize: "13px"
        });

        return el;
    }

    /* Create a styled <input type="text"> textbox. Caller sets .type /
       .value / .onchange / extra attributes after construction.
       shellName — optional data-shell key for the shell API. */
    createTextbox(placeholder, shellName) {

        const input = document.createElement("input");
        input.type = "text";
        if (placeholder) input.placeholder = placeholder;
        if (shellName) input.dataset.shell = shellName;

        Object.assign(input.style, {
            background: "#2a2a2a",
            color: "white",
            border: "1px solid #444",
            borderRadius: "4px",
            padding: "4px 6px",
            fontSize: "13px",
            width: "100%",
            boxSizing: "border-box"
        });

        return input;
    }

    /* Create a primary action button (filled, accent-coloured). Caller wires
       .onclick / .title / extra styles after construction.
       shellName — optional data-shell key for the shell API. */
    createPrimaryButton(label, shellName) {

        const btn = document.createElement("button");
        btn.textContent = label || "OK";
        if (shellName) btn.dataset.shell = shellName;

        Object.assign(btn.style, {
            background: "#4fc3f7",
            color: "#000",
            border: "none",
            borderRadius: "4px",
            padding: "6px 10px",
            cursor: "pointer",
            fontWeight: "bold"
        });

        return btn;
    }

    /* Create a checkbox wrapper: <div> containing <input type="checkbox"> +
       <span> label. The checkbox input is stored as wrapper.checkbox for
       programmatic access.
       shellName — optional data-shell key for the shell API. */
    createCheckbox(label, shellName) {

        const wrapper = document.createElement("div");
        Object.assign(wrapper.style, {
            display: "flex",
            alignItems: "center",
            gap: "6px"
        });

        const cb = document.createElement("input");
        cb.type = "checkbox";
        if (shellName) cb.dataset.shell = shellName;

        const span = document.createElement("span");
        span.textContent = label || "";
        Object.assign(span.style, { color: "#ddd", fontSize: "13px" });

        wrapper.appendChild(cb);
        wrapper.appendChild(span);
        wrapper.checkbox = cb;

        return wrapper;
    }

    /* Create a styled <select> element. `options` is an array of
       {value, label} objects or plain strings.
       shellName — optional data-shell key for the shell API. */
    createSelect(options, shellName) {

        const sel = document.createElement("select");
        if (shellName) sel.dataset.shell = shellName;

        (options || []).forEach(function (opt) {
            const o = document.createElement("option");
            if (typeof opt === "string") {
                o.value = opt;
                o.textContent = opt;
            } else {
                o.value = opt.value;
                o.textContent = opt.label || opt.value;
            }
            sel.appendChild(o);
        });

        Object.assign(sel.style, {
            background: "#2a2a2a",
            color: "white",
            border: "1px solid #444",
            borderRadius: "4px",
            padding: "4px 6px",
            fontSize: "13px"
        });

        return sel;
    }

    /* Register a tab. Adds a styled button to .tabBarEl that, when clicked,
       calls opts.onClick(opts.id). The first registered tab is auto-styled
       as active.

       This is a UI-construction helper. It does NOT manage tab content
       visibility — that stays with the caller's switchTab() / onClick. Use
       setActiveTabHighlight(id) to update the button styling after a switch.

       opts:
         id     — string identifier passed back via onClick.
         label  — button text.
         title  — tooltip (e.g., "Alt+1").
         onClick(id) — invoked on button click. */
    registerTab(opts) {

        const btn = document.createElement("button");
        btn.textContent = opts.label;
        if (opts.title) btn.title = opts.title;

        Object.assign(btn.style, {
            background: "transparent",
            color: "#999",
            border: "none",
            borderBottom: "2px solid transparent",
            padding: "4px 10px",
            cursor: "pointer",
            fontSize: "12px",
            fontFamily: "inherit"
        });

        const tab = { id: opts.id, button: btn };

        btn.onclick = (e) => {
            e.stopPropagation();
            if (opts.onClick) opts.onClick(opts.id);
        };

        this.tabBarEl.appendChild(btn);
        this._tabs.push(tab);

        if (this._activeTabId === null) {
            this._activeTabId = opts.id;
            btn.style.color = "white";
            btn.style.borderBottomColor = "#4fc3f7";
        }

        return btn;
    }

    /* Update tab-button highlighting to mark `id` as the active tab.
       Caller (switchTab) invokes this after a successful tab change. */
    setActiveTabHighlight(id) {
        this._activeTabId = id;
        for (const t of this._tabs) {
            const isActive = (t.id === id);
            t.button.style.color = isActive ? "white" : "#999";
            t.button.style.borderBottomColor = isActive ? "#4fc3f7" : "transparent";
        }
    }

    activeTabId() {
        return this._activeTabId;
    }

    /* Register an action button (sits next to the tab bar in the header).
       opts: { label, title, onClick, html, style }
         - pass `html` (e.g. an SVG) instead of `label` for icon buttons.
         - `style` is an Object.assign spread; defaults to the standard pill. */
    registerAction(opts) {

        const btn = document.createElement("button");

        if (opts.html) {
            btn.innerHTML = opts.html;
        } else {
            btn.textContent = opts.label;
        }
        if (opts.title) btn.title = opts.title;

        Object.assign(btn.style, opts.style || {
            background: "#555",
            color: "white",
            border: "none",
            borderRadius: "3px",
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: "11px"
        });

        btn.onclick = (e) => {
            e.stopPropagation();
            if (opts.onClick) opts.onClick();
        };

        this.actionBarEl.appendChild(btn);
        return btn;
    }
}

/* ---- Drag ----
   Mouse + touch. The header element gets `touch-action: none` so the
   browser doesn't claim the gesture for scrolling/panning — without that,
   touchmove only fires once before the browser takes over. touchmove +
   touchstart listeners are registered with { passive: false } so we can
   call preventDefault() and keep the page from scrolling under the finger
   while the title bar is being dragged. */

/* ---- Iframe pointer-event suppression during drag/resize ---- */
/* Iframes capture mousemove events, breaking drag/resize on the parent
   document. During any drag or resize operation we disable pointer events
   on ALL iframes so the parent's mousemove handler sees every event. */

function _sw_disable_iframes() {
    document.querySelectorAll("iframe").forEach(f => {
        f._sw_saved_pe = f.style.pointerEvents;
        f.style.pointerEvents = "none";
    });
}
function _sw_enable_iframes() {
    document.querySelectorAll("iframe").forEach(f => {
        f.style.pointerEvents = f._sw_saved_pe || "";
        delete f._sw_saved_pe;
    });
}

/* ---- Dragging ---- */

function service_window_make_draggable(element, handle, opts) {

    const isDraggable = (opts && opts.isDraggable) || (() => true);
    const onDragEnd   = (opts && opts.onDragEnd)   || (() => {});

    handle.style.touchAction = "none";

    let isDown = false;
    let offsetX = 0, offsetY = 0;

    const start = (clientX, clientY) => {
        if (!isDraggable()) return false;
        isDown = true;
        offsetX = clientX - element.offsetLeft;
        offsetY = clientY - element.offsetTop;
        return true;
    };
    const move = (clientX, clientY) => {
        if (!isDown || !isDraggable()) return;
        element.style.left = (clientX - offsetX) + "px";
        element.style.top  = (clientY - offsetY) + "px";
    };
    const end = () => {
        if (isDown) onDragEnd();
        isDown = false;
    };

    /* Mouse */
    handle.addEventListener("mousedown", (e) => {
        if (start(e.clientX, e.clientY)) _sw_disable_iframes();
    });
    document.addEventListener("mousemove", (e) => {
        move(e.clientX, e.clientY);
    });
    document.addEventListener("mouseup", () => {
        _sw_enable_iframes();
        end();
    });

    /* Touch — touchstart and touchmove are non-passive so preventDefault
       can suppress the page-level scroll/pan that would otherwise eat the
       drag. touchcancel mirrors touchend so a system-interrupted drag
       doesn't leave isDown stuck true.

       Skip the drag entirely when the touch target is a <button> inside
       the header (min/max/close, tab buttons, action buttons). Calling
       preventDefault on such touches would suppress the synthetic click
       the browser fires, breaking taps. The buttons themselves keep
       default touch-action so their tap → click synthesis still works. */
    handle.addEventListener("touchstart", (e) => {
        if (e.target && e.target.closest && e.target.closest("button")) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        if (start(t.clientX, t.clientY)) { _sw_disable_iframes(); e.preventDefault(); }
    }, { passive: false });

    document.addEventListener("touchmove", (e) => {
        if (!isDown) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        move(t.clientX, t.clientY);
        e.preventDefault();
    }, { passive: false });

    document.addEventListener("touchend",    () => { _sw_enable_iframes(); end(); });
    document.addEventListener("touchcancel", () => { _sw_enable_iframes(); end(); });
}

/* ---- Resize handle ---- */

function service_window_create_resize_handle(container, opts) {

    const isResizable = (opts && opts.isResizable) || (() => true);
    const onResizeEnd = (opts && opts.onResizeEnd) || (() => {});
    const minWidth    = (opts && opts.minWidth)    || 300;
    const minHeight   = (opts && opts.minHeight)   || 150;

    const handle = document.createElement("div");

    Object.assign(handle.style, {
        position: "absolute",
        width: "14px",
        height: "14px",
        right: "0",
        bottom: "0",
        cursor: "nwse-resize"
    });

    container.appendChild(handle);

    let resizing = false;
    let startX, startY, startWidth, startHeight;

    handle.addEventListener("mousedown", (e) => {
        if (!isResizable()) return;
        resizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth  = container.offsetWidth;
        startHeight = container.offsetHeight;
        _sw_disable_iframes();
        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!resizing) return;
        const newWidth  = startWidth  + (e.clientX - startX);
        const newHeight = startHeight + (e.clientY - startY);
        container.style.width  = Math.max(minWidth,  newWidth)  + "px";
        container.style.height = Math.max(minHeight, newHeight) + "px";
    });

    document.addEventListener("mouseup", () => {
        if (resizing) { _sw_enable_iframes(); onResizeEnd(); }
        resizing = false;
    });

    return handle;
}

/* ---- Centering ---- */

function service_window_center(element, width, height) {
    element.style.left = (window.innerWidth  - width)  / 2 + "px";
    element.style.top  = (window.innerHeight - height) / 2 + "px";
}

/* ---- Geometry persistence ---- */

function service_window_persist_geometry(key, element, extras) {

    if (!element) return;

    const state = Object.assign({
        left:   element.style.left,
        top:    element.style.top,
        width:  element.style.width,
        height: element.style.height
    }, extras || {});

    localStorage.setItem(key, JSON.stringify(state));
}

function service_window_restore_geometry(key, element) {

    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const state = JSON.parse(raw);

    element.style.left   = state.left;
    element.style.top    = state.top;
    element.style.width  = state.width;
    element.style.height = state.height;

    return state;
}

// ===== src/shell_toast.js =====
// -----------------------------------------------------------------------------
// shell_toast.js — window.shell.shelltoast facade for service_toast.
//
// Exposes a small, AI-friendly subset of service_toast.js on window.shell so
// scripts (and LLM-generated snippets pasted into the console) can fire
// notifications without having to know the internal function names.
//
// Public surface (window.shell.shelltoast.*):
//   showToastSimple(message)          — fire a default 3s toast.
//   showToast(message, opts)          — full options: { duration, title, icon }.
//                                       Returns { dismiss } so callers can
//                                       early-dismiss.
//   clearHistory()                    — wipe the notifications history pane.
//
// Intentionally OMITTED (kept off the AI surface to avoid side-quests):
//   - location getters/setters: the user picks the on-screen anchor from the
//     notifications pane; programmatic override would just confuse callers.
//   - history pane open/close toggles: that's a UI concern, not a scripting
//     concern.
//
// Wired up in framework_shell.js (shelltoast: shell_toast_build()).
// -----------------------------------------------------------------------------

function shell_toast_build() {
    return {
        help() {
            return "shell.shelltoast — Toast notifications\n\n" +
                "Methods:\n" +
                "  showToastSimple(message)           — Show a 3-second toast.\n" +
                "  showToast(message, opts?)           — Full options: {duration, title, icon}.\n" +
                "                                       Returns {dismiss} to early-dismiss.\n" +
                "  clearHistory()                      — Wipe the notifications history.\n\n" +
                "Recipes:\n" +
                "  shell.shelltoast.showToastSimple('Hello!')\n" +
                "  var t = shell.shelltoast.showToast('Done', {duration: 5000, title: 'Task'})\n" +
                "  t.dismiss()  // early dismiss";
        },
        showToastSimple(message) {
            return service_toast_show(String(message == null ? "" : message));
        },
        showToast(message, opts) {
            return service_toast_show(
                String(message == null ? "" : message),
                opts || {}
            );
        },
        clearHistory() {
            service_toast_clear_history();
        }
    };
}

// ===== src/footer.js =====
// -----------------------------------------------------------------------------
// footer.js — bootstraps the framework and closes the IIFE opened in header.js.
// This file MUST be the last chunk concatenated by build.go.
// -----------------------------------------------------------------------------

    framework_init();

})();
