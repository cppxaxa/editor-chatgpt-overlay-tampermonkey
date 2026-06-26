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
