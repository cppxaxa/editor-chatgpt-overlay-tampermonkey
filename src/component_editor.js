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
