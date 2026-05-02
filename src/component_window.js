// -----------------------------------------------------------------------------
// component_window.js — floating container, header, min/max/close, drag,
// resize, persisted geometry, and the master createEditor() that wires the
// whole UI together.
// -----------------------------------------------------------------------------

/* ---- Window-owned state ----
   These are populated by createEditor() and read by other components. The
   window component is the sole writer; everyone else is a reader. */

const EDITOR_STATE_KEY = "tm_editor_window_state";

let container;
let textarea;
let resizeHandle;
let headerEl;
let windowMode = "normal";
let previousBounds = null;

function createEditor() {

    container = document.createElement("div");

    Object.assign(container.style, {
        position: "fixed",
        width: "500px",
        height: "350px",
        background: "#1e1e1e",
        border: "1px solid #333",
        borderRadius: "8px",
        zIndex: "999999",
        display: "none",
        flexDirection: "column",
        boxShadow: "0 10px 30px rgba(0,0,0,.5)",
        overflow: "hidden"
    });

    const header = document.createElement("div");
    headerEl = header;

    Object.assign(header.style, {
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

    /* Tab bar */

    const tabBar = document.createElement("div");
    tabBar.className = "tm-tab-bar";
    Object.assign(tabBar.style, {
        display: "flex",
        gap: "0",
        flexShrink: "0"
    });

    editorTabBtn = document.createElement("button");
    editorTabBtn.textContent = "Editor";

    asciiTabBtn = document.createElement("button");
    asciiTabBtn.textContent = "Ascii design";

    questionTabBtn = document.createElement("button");
    questionTabBtn.textContent = "Question";

    snippetsTabBtn = document.createElement("button");
    snippetsTabBtn.textContent = "Snippets";

    spreviewTabBtn = document.createElement("button");
    spreviewTabBtn.textContent = "S-Preview";

    [editorTabBtn, asciiTabBtn, questionTabBtn, snippetsTabBtn, spreviewTabBtn].forEach(btn => {
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
    });

    editorTabBtn.title = "Alt+1";
    asciiTabBtn.title = "Alt+2";
    questionTabBtn.title = "Alt+3";
    snippetsTabBtn.title = "Alt+4";
    spreviewTabBtn.title = "Alt+5";

    editorTabBtn.style.color = "white";
    editorTabBtn.style.borderBottomColor = "#4fc3f7";

    editorTabBtn.onclick    = (e) => { e.stopPropagation(); switchTab("editor"); };
    asciiTabBtn.onclick     = (e) => { e.stopPropagation(); switchTab("ascii"); };
    questionTabBtn.onclick  = (e) => { e.stopPropagation(); switchTab("question"); };
    snippetsTabBtn.onclick  = (e) => { e.stopPropagation(); switchTab("snippets"); };
    spreviewTabBtn.onclick  = (e) => { e.stopPropagation(); switchTab("spreview"); };

    tabBar.appendChild(editorTabBtn);
    tabBar.appendChild(asciiTabBtn);
    tabBar.appendChild(questionTabBtn);
    tabBar.appendChild(snippetsTabBtn);
    tabBar.appendChild(spreviewTabBtn);
    header.appendChild(tabBar);

    /* Action buttons */

    const actionBtns = document.createElement("div");
    actionBtns.className = "tm-action-btns";
    Object.assign(actionBtns.style, {
        display: "flex",
        gap: "4px",
        marginLeft: "10px",
        alignItems: "center"
    });

    const runBtn = document.createElement("button");
    runBtn.textContent = "Command";
    runBtn.title = "Execute line command (Alt+I)";

    const checkBtn = document.createElement("button");
    checkBtn.textContent = "Check";
    checkBtn.title = "Code check (Alt+C)";

    [runBtn, checkBtn].forEach(btn => {
        Object.assign(btn.style, {
            background: "#555",
            color: "white",
            border: "none",
            borderRadius: "3px",
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: "11px"
        });
    });

    runBtn.onclick   = (e) => { e.stopPropagation(); handleLineAction(); };
    checkBtn.onclick = (e) => { e.stopPropagation(); handleCodeCheck(); };

    const ghBtn = document.createElement("button");
    ghBtn.title = "Project page on GitHub";
    ghBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="white"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

    Object.assign(ghBtn.style, {
        background: "#555",
        color: "white",
        border: "none",
        borderRadius: "3px",
        padding: "3px 6px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center"
    });

    ghBtn.onclick = (e) => {
        e.stopPropagation();
        window.open("https://github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey", "_blank");
    };

    const regenBtn = document.createElement("button");
    regenBtn.textContent = "↻";
    regenBtn.title = "Regenerate Ascii/Question/Snippets (Alt+R)";

    Object.assign(regenBtn.style, {
        background: "#555",
        color: "white",
        border: "none",
        borderRadius: "3px",
        padding: "2px 8px",
        cursor: "pointer",
        fontSize: "13px"
    });

    regenBtn.onclick = (e) => { e.stopPropagation(); regenerateCurrentTab(); };

    actionBtns.appendChild(regenBtn);
    actionBtns.appendChild(runBtn);
    actionBtns.appendChild(checkBtn);
    actionBtns.appendChild(ghBtn);
    header.appendChild(actionBtns);

    /* Window control buttons */

    const buttons = document.createElement("div");

    const minBtn = document.createElement("button");
    minBtn.textContent = "—";

    const maxBtn = document.createElement("button");
    maxBtn.textContent = "□";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";

    [minBtn, maxBtn, closeBtn].forEach(btn => {
        Object.assign(btn.style, {
            marginLeft: "6px",
            background: "#444",
            color: "white",
            border: "none",
            width: "24px",
            height: "24px",
            cursor: "pointer"
        });
        buttons.appendChild(btn);
    });

    header.appendChild(buttons);

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

    container.appendChild(header);
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

        if (windowMode !== "maximized") return;

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

        if (windowMode !== "maximized") return;
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

    createResizeHandle();

    document.body.appendChild(container);

    const restored = restoreEditorState();
    if (!restored) centerEditor();

    /* Window control button handlers */

    minBtn.onclick = () => {

        if (windowMode === "minimized") {

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
            if (previousBounds) {
                container.style.left = previousBounds.left;
                container.style.top = previousBounds.top;
                container.style.width = previousBounds.width;
                container.style.height = previousBounds.height;
            } else {
                container.style.height = "350px";
            }
            resizeHandle.style.display = "block";
            windowMode = "normal";
        }
        else {

            if (windowMode === "maximized" && activeTab === "editor") {
                exitMaximizedColumnLayout();
            }

            previousBounds = {
                left: container.style.left,
                top: container.style.top,
                width: container.style.width,
                height: container.style.height
            };

            textarea.style.display = "none";
            columnContainer.style.display = "none";
            asciiTA.style.display = "none";
            questionTA.style.display = "none";
            snippetsTA.style.display = "none";
            spreviewFrame.style.display = "none";
            resizeHandle.style.display = "none";
            container.style.height = "36px";

            windowMode = "minimized";
        }

        saveEditorState();
    };

    maxBtn.onclick = () => {

        if (windowMode !== "maximized") {

            previousBounds = {
                left: container.style.left,
                top: container.style.top,
                width: container.style.width,
                height: container.style.height
            };

            container.style.left = "0";
            container.style.top = "0";
            container.style.width = "100vw";
            container.style.height = "100vh";

            resizeHandle.style.display = "none";

            windowMode = "maximized";
            if (activeTab === "editor") enterMaximizedColumnLayout();
        }
        else {

            if (activeTab === "editor") exitMaximizedColumnLayout();

            if (previousBounds) {
                container.style.left = previousBounds.left;
                container.style.top = previousBounds.top;
                container.style.width = previousBounds.width;
                container.style.height = previousBounds.height;
            }

            resizeHandle.style.display = "block";
            windowMode = "normal";
        }

        saveEditorState();
    };

    closeBtn.onclick = () => container.style.display = "none";

    makeDraggable(container, header);
}

/* ---- Resize handle ---- */

function createResizeHandle() {

    resizeHandle = document.createElement("div");

    Object.assign(resizeHandle.style, {
        position: "absolute",
        width: "14px",
        height: "14px",
        right: "0",
        bottom: "0",
        cursor: "nwse-resize"
    });

    container.appendChild(resizeHandle);

    let resizing = false;
    let startX, startY, startWidth, startHeight;

    resizeHandle.addEventListener("mousedown", (e) => {

        if (windowMode !== "normal") return;

        resizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = container.offsetWidth;
        startHeight = container.offsetHeight;

        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!resizing) return;
        const newWidth = startWidth + (e.clientX - startX);
        const newHeight = startHeight + (e.clientY - startY);
        container.style.width = Math.max(300, newWidth) + "px";
        container.style.height = Math.max(150, newHeight) + "px";
    });

    document.addEventListener("mouseup", () => {
        if (resizing) saveEditorState();
        resizing = false;
    });
}

/* ---- Drag ---- */

function makeDraggable(element, handle) {

    let isDown = false;
    let offsetX, offsetY;

    handle.addEventListener("mousedown", (e) => {
        if (windowMode === "maximized") return;
        isDown = true;
        offsetX = e.clientX - element.offsetLeft;
        offsetY = e.clientY - element.offsetTop;
    });

    document.addEventListener("mouseup", () => {
        if (isDown) saveEditorState();
        isDown = false;
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDown || windowMode === "maximized") return;
        element.style.left = e.clientX - offsetX + "px";
        element.style.top = e.clientY - offsetY + "px";
    });
}

/* ---- Initial centering ---- */

function centerEditor() {
    const width = 500;
    const height = 350;
    container.style.left = (window.innerWidth - width) / 2 + "px";
    container.style.top = (window.innerHeight - height) / 2 + "px";
}

/* ---- Geometry persistence ---- */

function saveEditorState() {

    if (!container) return;

    const state = {
        left: container.style.left,
        top: container.style.top,
        width: container.style.width,
        height: container.style.height,
        windowMode,
        previousBounds
    };

    localStorage.setItem(EDITOR_STATE_KEY, JSON.stringify(state));
}

function restoreEditorState() {

    const raw = localStorage.getItem(EDITOR_STATE_KEY);
    if (!raw) return false;

    const state = JSON.parse(raw);

    container.style.left = state.left;
    container.style.top = state.top;
    container.style.width = state.width;
    container.style.height = state.height;

    windowMode = state.windowMode || "normal";
    previousBounds = state.previousBounds || null;

    if (windowMode === "maximized") {
        container.style.left = "0";
        container.style.top = "0";
        container.style.width = "100vw";
        container.style.height = "100vh";
        resizeHandle.style.display = "none";
        enterMaximizedColumnLayout();
    }

    if (windowMode === "minimized") {
        textarea.style.display = "none";
        container.style.height = "36px";
        resizeHandle.style.display = "none";
    }

    return true;
}
