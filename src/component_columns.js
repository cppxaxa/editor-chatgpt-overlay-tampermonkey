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
