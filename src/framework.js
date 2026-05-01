// -----------------------------------------------------------------------------
// framework.js — global state, lifecycle bootstrap, and the @keyframes style.
//
// NOTE: We are intentionally porting the original monolith function/variable
// names verbatim into per-component files first. The rename to the
// framework_*/component_* naming scheme described in PROPOSAL.md will be a
// follow-up pass once the split is verified to behave identically.
// -----------------------------------------------------------------------------

/* ---- Global state (was top-of-file in the monolith) ---- */

const EDITOR_STATE_KEY = "tm_editor_window_state";

let container;
let textarea;
let resizeHandle;

let headerEl;
let windowMode = "normal";
let previousBounds = null;
let waitAbortController = null;

let columnContainer;  // flex wrapper for the two column textareas
let leftTA;           // left textarea
let rightTA;          // right textarea
let syncing = false;  // guard against recursive input during redistribution
let lastFocusedTA = null; // track last focused textarea for button clicks

const MARKER_CHAR = "⭐"; // ⭐

let activeTab = "editor";
let asciiTA;
let asciiCache = { hash: null, content: "" };
const ASCII_CACHE_KEY = "tm_ascii_cache";
let checkCache = { hash: null, parsed: null, body: "" };
let editorTabBtn;
let asciiTabBtn;
let questionTabBtn;
let snippetsTabBtn;
let spreviewTabBtn;
let questionTA;
let questionCache = { hash: null, content: "" };
const QUESTION_CACHE_KEY = "tm_question_cache";
let snippetsTA;
let snippetsCache = { hash: null, content: "" };
const SNIPPETS_CACHE_KEY = "tm_snippets_cache";
let spreviewFrame;
let spreviewCache = { hash: null, content: "" };
const SPREVIEW_CACHE_KEY = "tm_spreview_cache";

const tabState = {
    editor:   { scrollTop: 0, selStart: 0, selEnd: 0 },
    ascii:    { scrollTop: 0, selStart: 0, selEnd: 0 },
    question: { scrollTop: 0, selStart: 0, selEnd: 0 },
    snippets: { scrollTop: 0, selStart: 0, selEnd: 0 },
    spreview: { scrollTop: 0, selStart: 0, selEnd: 0 }
};

const undoStack = [];
const redoStack = [];
const UNDO_MAX = 200;
let undoTimer = null;
let isUndoRedo = false;

/* ---- Bootstrap ---- */

function framework_init() {
    createLauncher();
    registerLineReaderHotkey();

    window.addEventListener("resize", () => {
        if (windowMode === "maximized") redistributeColumns();
    });

    const tmStyle = document.createElement("style");
    tmStyle.textContent = `@keyframes tm-spin{to{transform:rotate(360deg)}}`;
    document.head.appendChild(tmStyle);
}
