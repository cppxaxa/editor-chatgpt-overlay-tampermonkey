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
