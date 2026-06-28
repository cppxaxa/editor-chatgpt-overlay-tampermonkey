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
