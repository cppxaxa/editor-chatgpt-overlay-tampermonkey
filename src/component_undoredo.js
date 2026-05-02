// -----------------------------------------------------------------------------
// component_undoredo.js — custom in-memory undo/redo stack for the Editor tab.
// -----------------------------------------------------------------------------

/* ---- Undo/redo-owned state ---- */

const undoStack = [];
const redoStack = [];
const UNDO_MAX = 200;
let undoTimer = null;
let isUndoRedo = false;

function pushUndo(value, cursorPos) {
    if (isUndoRedo) return;
    if (undoStack.length > 0 && undoStack[undoStack.length - 1].value === value) return;
    undoStack.push({ value: value, cursor: cursorPos });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
}

function pushUndoDebounced(ta) {
    if (isUndoRedo) return;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
        pushUndo(ta.value, ta.selectionStart);
    }, 300);
}

function doUndo(ta) {
    if (undoStack.length === 0) return;

    redoStack.push({ value: ta.value, cursor: ta.selectionStart });

    const entry = undoStack.pop();
    isUndoRedo = true;
    ta.value = entry.value;
    ta.selectionStart = ta.selectionEnd = entry.cursor;
    localStorage.setItem("tm_editor_content", ta.value);
    isUndoRedo = false;
}

function doRedo(ta) {
    if (redoStack.length === 0) return;

    undoStack.push({ value: ta.value, cursor: ta.selectionStart });

    const entry = redoStack.pop();
    isUndoRedo = true;
    ta.value = entry.value;
    ta.selectionStart = ta.selectionEnd = entry.cursor;
    localStorage.setItem("tm_editor_content", ta.value);
    isUndoRedo = false;
}
