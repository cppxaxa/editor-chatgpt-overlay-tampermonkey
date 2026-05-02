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
