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

async function handleLineAction() {

    if (!textarea) return;

    const activeTA = document.activeElement;
    const isEditor = (activeTA === textarea || activeTA === leftTA || activeTA === rightTA);
    const editorTA = isEditor ? activeTA : lastFocusedTA;
    if (!editorTA) return;

    const ta = (windowMode === "maximized") ? editorTA : textarea;

    const cursor = ta.selectionStart;
    const text = ta.value;

    const start = text.lastIndexOf("\n", cursor - 1) + 1;
    const end = text.indexOf("\n", cursor);

    const lineEnd = end === -1 ? text.length : end;
    const line = text.substring(start, lineEnd);

    const indent = line.match(/^[ ]*/)[0];
    const trimmed = line.trimStart();

    if (trimmed.startsWith("/p ")) {

        const prompt = trimmed.substring(3);

        const fullContent = windowMode === "maximized"
            ? mergeColumnContent()
            : textarea.value;

        const allLines = fullContent.split("\n");

        let cmdLineIdx = text.substring(0, start).split("\n").length - 1;
        if (windowMode === "maximized" && ta === rightTA) {
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

        waitAbortController = new AbortController();
        showWaitingUI();

        await yieldFrame();

        const response = await sendPromptToChatGPT(contextualPrompt);

        hideWaitingUI();
        waitAbortController = null;

        if (response) {

            const indented = applyIndent(response, indent);

            ta.value =
                text.substring(0, start) +
                indented +
                text.substring(lineEnd);

            ta.dispatchEvent(new Event("input"));
            localStorage.setItem("tm_editor_content",
                windowMode === "maximized" ? mergeColumnContent() : textarea.value);
        }

        return;
    }

    if (trimmed.startsWith("/r ")) {

        const prompt = trimmed.substring(3);

        waitAbortController = new AbortController();
        showWaitingUI();

        await yieldFrame();

        const response = await sendPromptToChatGPT(prompt);

        hideWaitingUI();
        waitAbortController = null;

        if (response) {

            const indented = applyIndent(response, indent);

            ta.value =
                text.substring(0, start) +
                indented +
                text.substring(lineEnd);

            ta.dispatchEvent(new Event("input"));
            localStorage.setItem("tm_editor_content",
                windowMode === "maximized" ? mergeColumnContent() : textarea.value);
        }

        return;
    }

    alert(line + "\n\n— Tip: /r {prompt} = raw prompt | /p {prompt} = prompt with context\n— Tabs: Alt+1 Editor | Alt+2 Ascii | Alt+3 Question | Alt+4 Snippets | Alt+5 S-Preview\n— Alt+I = Execute command | Alt+C = Code check | Alt+R = Regenerate tab\n— More: github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey");
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
