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

    aiLabel.title = "Send input to AI — responds with JS commands to execute";
    aiLabel.onclick = function (e) {
        e.preventDefault();
        consoleAiMode = !consoleAiMode;
        aiTrack.style.background = consoleAiMode ? "#4fc3f7" : "rgba(255,255,255,0.18)";
        aiKnob.style.left = consoleAiMode ? "16px" : "2px";
        localStorage.setItem("tm_console_ai_mode", consoleAiMode ? "true" : "false");
    };

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
        "- isFinal: true if the task is done after these commands. false if you need to see the output to decide next steps.\n" +
        "- Do NOT use semicolons at the end of statements.\n" +
        "- Use console.log() for output the user should see.\n" +
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
