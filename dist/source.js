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

    framework_launcher_register("E", component_window_launch);
    framework_launcher_register("C", component_calc_launch);

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
}

function framework_init() {
    framework_register_launcher();

    window.addEventListener("resize", framework_on_window_resized);

    framework_on_init();

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
   if it was visible in the last session. Called from framework_on_init(). */
function component_calc_handle_init() {
    ServiceWindow.registerApp("calc", component_calc_launch);
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
        appName: "editor",
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

function framework_launcher_register(textContent, onlaunch) {

    const slotIndex = _framework_launcher_count;
    _framework_launcher_count++;

    const bottom = FRAMEWORK_LAUNCHER_BASE_BOTTOM
        + slotIndex * (FRAMEWORK_LAUNCHER_SIZE + FRAMEWORK_LAUNCHER_GAP);

    const btn = document.createElement("button");

    btn.textContent = textContent;

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
        fontWeight: "bold"
    });

    btn.onclick = () => {
        if (typeof onlaunch === "function") {
            try { onlaunch(); }
            catch (e) { console.error("framework_launcher onlaunch threw:", e); }
        }
    };

    document.body.appendChild(btn);
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
            borderRadius: "8px",
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

        return this;
    }

    /* ---- Show / hide (auto-persists visibility) ---- */

    show() {
        if (!this.container) return;
        this.container.style.display = "flex";
        this.visible = true;
        this.persistState();
    }

    hide() {
        if (!this.container) return;
        this.container.style.display = "none";
        this.visible = false;
        this.persistState();
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

/* ---- Drag ---- */

function service_window_make_draggable(element, handle, opts) {

    const isDraggable = (opts && opts.isDraggable) || (() => true);
    const onDragEnd   = (opts && opts.onDragEnd)   || (() => {});

    let isDown = false;
    let offsetX, offsetY;

    handle.addEventListener("mousedown", (e) => {
        if (!isDraggable()) return;
        isDown = true;
        offsetX = e.clientX - element.offsetLeft;
        offsetY = e.clientY - element.offsetTop;
    });

    document.addEventListener("mouseup", () => {
        if (isDown) onDragEnd();
        isDown = false;
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDown || !isDraggable()) return;
        element.style.left = e.clientX - offsetX + "px";
        element.style.top  = e.clientY - offsetY + "px";
    });
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
