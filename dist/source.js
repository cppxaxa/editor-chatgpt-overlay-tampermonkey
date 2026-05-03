// ===== src/header.js =====
// ==UserScript==
// @name         ChatGPT Floating Scratchpad
// @namespace    https://github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey
// @version      0.1.0
// @description  Floating code editor overlay for chatgpt.com with prompt automation, code review, and tabbed generated views.
// @author       cppxaxa
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

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
    /* Calc lives in the system tray (registered in component_calc_handle_init).
       Skip the Start-menu launcher to avoid double representation. */
    framework_launcher_register("Local Storage", component_localstorage_launch, {
        appName: "localstorage",
        icon:    "🗂️",
        title:   "Local Storage"
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

    component_waitingui_handle_init();
    component_linecommand_handle_init();
    component_window_handle_init();
    component_calc_handle_init();
    component_console_handle_init();
    component_chat_handle_init();
    component_localstorage_handle_init();
    service_toast_handle_init();
}

function framework_init() {
    framework_register_launcher();

    window.addEventListener("resize", framework_on_window_resized);

    framework_on_init();

    /* Sweep stale per-app localStorage entries now that every component
       has registered. Runs once per page load. */
    framework_orphan_cleanup();

    handle_kiosk();
    handle_system_restore();
}

// ===== src/component_calc.js =====
// -----------------------------------------------------------------------------
// component_calc.js — minimal demo app showing how to build a window with
// ServiceWindow. Two number inputs, a Sum button, and a result label.
//
// Registered with the framework launcher as "C". Lazily creates the window on
// first launch.
// -----------------------------------------------------------------------------

let calcServiceWindow = null;
let calcContainer     = null;

/* Inline SVG calculator: 14x14 viewBox, currentColor strokes so it inherits
   whatever container's text colour (tray button, taskbar running-app
   button, hover state). Body rectangle, a screen, and a 3x3 button grid
   drawn as small dots. Used both as the tray icon and as the running-apps
   icon in the taskbar. */
const CALC_ICON_SVG =
    "<svg width='14' height='14' viewBox='0 0 14 14' " +
    "xmlns='http://www.w3.org/2000/svg' style='display:block'>" +
        "<rect x='2' y='1' width='10' height='12' rx='1.5' " +
        "fill='none' stroke='currentColor' stroke-width='1'/>" +
        "<rect x='3.2' y='2.4' width='7.6' height='2.2' rx='0.4' " +
        "fill='currentColor' opacity='0.75'/>" +
        "<circle cx='4'   cy='6.6'  r='0.6' fill='currentColor'/>" +
        "<circle cx='7'   cy='6.6'  r='0.6' fill='currentColor'/>" +
        "<circle cx='10'  cy='6.6'  r='0.6' fill='currentColor'/>" +
        "<circle cx='4'   cy='8.8'  r='0.6' fill='currentColor'/>" +
        "<circle cx='7'   cy='8.8'  r='0.6' fill='currentColor'/>" +
        "<circle cx='10'  cy='8.8'  r='0.6' fill='currentColor'/>" +
        "<circle cx='4'   cy='11'   r='0.6' fill='currentColor'/>" +
        "<circle cx='7'   cy='11'   r='0.6' fill='currentColor'/>" +
        "<circle cx='10'  cy='11'   r='0.6' fill='currentColor'/>" +
    "</svg>";

function component_calc_launch() {
    if (!calcContainer) component_calc_create();
    calcServiceWindow.show();
}

function component_calc_create() {

    /* Look up the current tray button (may be null if the user has hidden
       the icon via the overflow popup). Pass it through opts.trayButton so
       create() installs the tray-mode patches: hidden min/max, outside-click
       hide, downward tail, defaultClose tail-hide. The registry's onAdopt
       will keep this in sync if the button is later replaced. */
    const trayBtn = (typeof service_taskbar_get_tray_button === "function")
        ? service_taskbar_get_tray_button("calc")
        : null;

    calcServiceWindow = new ServiceWindow();
    calcServiceWindow.create({
        appName: "calc",
        width:  320,
        height: 200,
        isDraggable: () => true,
        isResizable: () => true,
        trayButton: trayBtn   // null is fine — tray patches install on next adopt
    });

    /* If no tray button existed at create() time, install the tray-mode
       behaviour anyway by calling _adoptTrayButton(null) — but we can't
       pass null because the patches need a button to anchor against.
       Instead, the registry's onAdopt handles future button creations.
       For the "hidden at boot" case the user can re-show via overflow. */

    calcServiceWindow.registerTab({ id: "calc", label: "Calc" });

    /* Min/max/close cluster — defaults from ServiceWindow are fine for a
       minimal demo (close hides the container; max toggles fullscreen; min
       collapses to header height). No wiring needed here. */
    calcServiceWindow.appendControls();

    calcContainer = calcServiceWindow.container;

    /* Body */
    const body = calcServiceWindow.createBody();

    const inputA = calcServiceWindow.createTextbox("a");
    inputA.type = "number";

    const inputB = calcServiceWindow.createTextbox("b");
    inputB.type = "number";

    const resultLabel = calcServiceWindow.createLabel("Result: —");

    const sumBtn = calcServiceWindow.createPrimaryButton("Sum");

    sumBtn.onclick = () => {
        const a = parseFloat(inputA.value) || 0;
        const b = parseFloat(inputB.value) || 0;
        resultLabel.textContent = "Result: " + (a + b);
    };

    body.appendChild(inputA);
    body.appendChild(inputB);
    body.appendChild(sumBtn);
    body.appendChild(resultLabel);

    /* Restore previously saved geometry/mode; otherwise center. */
    if (!calcServiceWindow.restoreState()) {
        service_window_center(calcContainer, 320, 200);
    }
}

/* Framework lifecycle reactor — registers calc with the system-restore
   registry so framework_system_restore.js can re-open this window at boot
   if it was visible in the last session. Also registers the tray icon
   immediately so it's visible in the system tray before the window has
   been lazily created. Clicking the tray icon lazy-creates the window
   (which will adopt this same button via opts.trayButton). */
function component_calc_handle_init() {
    ServiceWindow.registerApp("calc", component_calc_launch);

    if (typeof service_taskbar_register_tray_app === "function") {
        service_taskbar_register_tray_app({
            appName: "calc",
            label:   "Calc",
            icon:    CALC_ICON_SVG,
            title:   "Calculator",
            onClick: (btn) => {
                if (!calcContainer) component_calc_create();
                calcServiceWindow._toggleFromTray(btn);
            },
            /* Called on initial registration AND every time the user
               re-shows the icon via the overflow popup (the DOM node
               changes each time). Tell the live ServiceWindow about the
               new button so its outside-click handler and tray-click
               wiring stay in sync. */
            onAdopt: (btn) => {
                if (calcServiceWindow) {
                    calcServiceWindow._adoptTrayButton(btn, null);
                }
            }
        });
    }
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

    const trayBtn = (typeof service_taskbar_get_tray_button === "function")
        ? service_taskbar_get_tray_button("chat")
        : null;

    chatServiceWindow = new ServiceWindow();
    chatServiceWindow.create({
        appName:     "chat",
        width:       480,
        height:      400,
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

                if (!chatVisible && typeof service_toast_show === "function") {
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

    if (typeof service_taskbar_register_tray_app === "function") {
        service_taskbar_register_tray_app({
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

    const trayBtn = (typeof service_taskbar_get_tray_button === "function")
        ? service_taskbar_get_tray_button("console")
        : null;

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

    body.appendChild(out);
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
            /* Route through the queue so textbox-typed commands and
               programmatic submitConsoleMessage() calls share one FIFO. */
            submitConsoleMessage(cmd);
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

function component_console_handle_init() {
    ServiceWindow.registerApp("console", component_console_launch);

    if (typeof service_taskbar_register_tray_app === "function") {
        service_taskbar_register_tray_app({
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
        if (isEditorTA && e.ctrlKey && !e.shiftKey && !e.altKey) {
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
    registerLineReaderHotkey();
}

function registerLineReaderHotkey() {

    document.addEventListener("keydown", (e) => {

        if (e.altKey && e.key.toLowerCase() === "i") {
            e.preventDefault();
            handleLineAction();
        }

        if (e.altKey && e.key.toLowerCase() === "c") {
            e.preventDefault();
            handleCodeCheck();
        }

        if (e.altKey && e.key === "1") { e.preventDefault(); switchTab("editor"); }
        if (e.altKey && e.key === "2") { e.preventDefault(); switchTab("ascii"); }
        if (e.altKey && e.key === "3") { e.preventDefault(); switchTab("question"); }
        if (e.altKey && e.key === "4") { e.preventDefault(); switchTab("snippets"); }
        if (e.altKey && e.key === "5") { e.preventDefault(); switchTab("spreview"); }

        if (e.altKey && e.key.toLowerCase() === "r") { e.preventDefault(); regenerateCurrentTab(); }
    });
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
// Thin wrapper around service_taskbar.js. The taskbar service owns all DOM:
// wallpaper, bottom taskbar, Start button + Start menu (search + scrollable
// app list), running-apps list, system tray, up arrow for overflow, and
// clock. This file just exposes the registration entrypoint that
// framework_launcher.js delegates to.
// -----------------------------------------------------------------------------

function framework_launcher_kdeubuntu_register(textContent, onlaunch, opts) {

    service_taskbar_init();
    service_taskbar_register_app(textContent, onlaunch, opts);
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
//     registry. Tray apps register through service_taskbar_register_tray_app,
//     which keeps an internal _tray_apps list — we expose
//     service_taskbar_list_tray_apps() so this file doesn't need to reach
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
    if (typeof service_taskbar_list_tray_apps === "function") {
        try {
            const liveTrayNames = new Set(
                service_taskbar_list_tray_apps().map(a => a.appName)
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
    }

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
            if (typeof component_console_create === "function" &&
                typeof consoleContainer !== "undefined" &&
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

// ===== src/service_llm.js =====
// -----------------------------------------------------------------------------
// service_llm.js — small library for talking to the ChatGPT web UI.
//
// Public API:
//
//     const answer = await sendMessage("Your prompt here");
//     // answer === string on success, null on failure / cancel.
//
// Internally this drives ChatGPT's prompt textarea, clicks send, watches the
// DOM for a new assistant message, waits for streaming to finish, and returns
// the cleaned text.
//
// Cancellation: the queue tracks the currently-running job. Calling
// `cancelCurrentLlmJob()` flips a flag that `waitForAssistantResponse_llm`
// observes on its next poll tick and bails out, resolving with `null`.
//
// All helpers are named with a `_llm` suffix so they don't collide with the
// equivalents in component_chatgpt.js when both files are concatenated into
// the same IIFE. `sendMessage` is the only public symbol.
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
    return await sendMessage_chatgpt(prompt);
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

// ===== src/service_taskbar.js =====
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
    if (typeof service_fs_get === "function") {
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

    if (typeof ServiceWindow === "undefined") return;

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
        } else if (opts.tray && typeof service_taskbar_register_tray_icon === "function") {
            this._installTrayMode({
                icon:  opts.trayIcon  || (opts.appName || "?").charAt(0).toUpperCase(),
                title: opts.trayTitle || opts.appName
            });
        }

        return this;
    }

    _installTrayMode(opts) {

        const handle = service_taskbar_register_tray_icon({
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
       reflect dynamic state. */
    createLabel(text) {

        const el = document.createElement("div");
        el.textContent = text || "";

        Object.assign(el.style, {
            marginTop: "4px",
            color: "#ddd",
            fontSize: "13px"
        });

        return el;
    }

    /* Create a styled <input type="text"> textbox. Caller sets .type /
       .value / .onchange / extra attributes after construction. */
    createTextbox(placeholder) {

        const input = document.createElement("input");
        input.type = "text";
        if (placeholder) input.placeholder = placeholder;

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
       .onclick / .title / extra styles after construction. */
    createPrimaryButton(label) {

        const btn = document.createElement("button");
        btn.textContent = label || "OK";

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
        start(e.clientX, e.clientY);
    });
    document.addEventListener("mousemove", (e) => {
        move(e.clientX, e.clientY);
    });
    document.addEventListener("mouseup", end);

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
        if (start(t.clientX, t.clientY)) e.preventDefault();
    }, { passive: false });

    document.addEventListener("touchmove", (e) => {
        if (!isDown) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        move(t.clientX, t.clientY);
        e.preventDefault();
    }, { passive: false });

    document.addEventListener("touchend",    end);
    document.addEventListener("touchcancel", end);
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
        if (resizing) onResizeEnd();
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

// ===== src/footer.js =====
// -----------------------------------------------------------------------------
// footer.js — bootstraps the framework and closes the IIFE opened in header.js.
// This file MUST be the last chunk concatenated by build.go.
// -----------------------------------------------------------------------------

    framework_init();

})();
