// -----------------------------------------------------------------------------
// component_codecheck.js — code review via ChatGPT with structured-JSON
// response parsing and ⭐ marker insertion.
// -----------------------------------------------------------------------------

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

async function handleCodeCheck() {

    if (!textarea) return;

    const activeTA = document.activeElement;
    const isEditor = (activeTA === textarea || activeTA === leftTA || activeTA === rightTA);
    if (!isEditor && !lastFocusedTA) return;

    if (windowMode === "maximized") {
        clearAllMarkers(leftTA);
        clearAllMarkers(rightTA);
        redistributeColumns();
    } else {
        clearAllMarkers(textarea);
    }

    const code = windowMode === "maximized"
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
            if (windowMode === "maximized") {
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

    waitAbortController = new AbortController();
    showWaitingUI();

    await yieldFrame();

    const numberedCode = code.split("\n").map((line, i) => (i + 1) + "> " + line).join("\n");

    const response = await sendMessage(CODE_CHECK_PROMPT + numberedCode + "\n```");

    hideWaitingUI();
    waitAbortController = null;

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

        if (windowMode === "maximized") {
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
}
