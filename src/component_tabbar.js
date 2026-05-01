// -----------------------------------------------------------------------------
// component_tabbar.js — tab switching, per-tab cursor/scroll persistence,
// regenerate-current dispatch, and shared helpers (simpleHash, getEditorContent).
// -----------------------------------------------------------------------------

function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(36);
}

function getEditorContent() {
    if (windowMode === "maximized") {
        return mergeColumnContent();
    }
    return textarea.value;
}

function updateTabStyles() {
    [editorTabBtn, asciiTabBtn, questionTabBtn, snippetsTabBtn, spreviewTabBtn].forEach(btn => {
        btn.style.color = "#999";
        btn.style.borderBottomColor = "transparent";
    });
    const active = {
        editor: editorTabBtn,
        ascii: asciiTabBtn,
        question: questionTabBtn,
        snippets: snippetsTabBtn,
        spreview: spreviewTabBtn
    }[activeTab];
    if (active) {
        active.style.color = "white";
        active.style.borderBottomColor = "#4fc3f7";
    }
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

        if (waitAbortController) waitAbortController.abort();

        asciiTA.style.display = "none";
        questionTA.style.display = "none";
        snippetsTA.style.display = "none";
        spreviewFrame.style.display = "none";

        if (windowMode === "maximized") {
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
