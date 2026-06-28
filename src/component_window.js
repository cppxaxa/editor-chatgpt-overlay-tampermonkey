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

        if (wasMinimized) {
            /* Restoring — instant, no animation. Show content in the callback. */
            editorServiceWindow.defaultMinimize(() => {
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
                    textarea.focus();
                    if (editorServiceWindow.mode === "normal" && activeTab === "editor") {
                        redistributeColumns();
                    }
                }
                saveEditorState();
            });
        } else {
            /* Minimizing — hide content after the collapse animation finishes. */
            editorServiceWindow.defaultMinimize(() => {
                textarea.style.display        = "none";
                columnContainer.style.display = "none";
                asciiTA.style.display         = "none";
                questionTA.style.display      = "none";
                snippetsTA.style.display      = "none";
                spreviewFrame.style.display   = "none";
                saveEditorState();
            });
        }
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
