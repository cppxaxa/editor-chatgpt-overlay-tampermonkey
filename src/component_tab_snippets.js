// -----------------------------------------------------------------------------
// component_tab_snippets.js — Snippets tab generator.
// -----------------------------------------------------------------------------

/* ---- Snippets-tab-owned state ---- */

let snippetsTA;
let snippetsCache = { hash: null, content: "" };
const SNIPPETS_CACHE_KEY = "tm_snippets_cache";

function generateSnippets(code, hash) {

    const prompt = "Analyze the following code and understand what problem it is solving. " +
        "Then provide reusable, well-known algorithm and utility functions that would help solve this problem. " +
        "These should be GENERIC helper functions that a developer would commonly memorize and reuse across many " +
        "LeetCode problems or projects — things like BFS, DFS, Union-Find, binary search, LIS, topological sort, " +
        "segment tree operations, GCD/LCM, prefix sums, sliding window helpers, trie operations, Dijkstra, " +
        "Floyd-Warshall, KMP, matrix exponentiation, etc.\n\n" +
        "IMPORTANT — Also scan the code for:\n" +
        "1. Functions that are CALLED but never defined (missing implementations)\n" +
        "2. Functions that have EMPTY bodies or only placeholder/stub content (e.g. TODO, throw NotImplemented, pass, return default)\n" +
        "Provide full working implementations for ALL such functions too, placed BEFORE the generic helpers.\n\n" +
        "Rules:\n" +
        "- Wrap all functions inside a `class Helper` with static methods\n" +
        "- Each function must be self-contained — only depends on its inputs, no external state\n" +
        "- Match the programming language used in the code. If the language is unclear, default to C#\n" +
        "- Include FULL function bodies (not stubs) — complete, working implementations\n" +
        "- Add a brief one-line comment above each function describing what it does\n" +
        "- For missing/empty functions found in the code, add a comment like: // [Missing from code] or // [Stub in code]\n" +
        "- Only include generic helpers genuinely relevant to solving this type of problem\n" +
        "- These should be the kind of well-known algorithms that experienced developers recall from memory\n" +
        "- Enclose your ENTIRE response inside ```md and ``` so it is treated as code\n\n" +
        "Code:\n" + code;

    const onstart = (ctx) => {
        waitAbortController = new AbortController();
        showWaitingUI();
    };

    const onend = (ctx) => {
        const wasAborted = waitAbortController && waitAbortController.signal.aborted;
        waitAbortController = null;
        hideWaitingUI();

        if (wasAborted || ctx.cancelled) return;

        if (ctx.error) {
            if (activeTab === "snippets") snippetsTA.value = "(Error generating snippets: " + ctx.error.message + ")";
            return;
        }

        if (ctx.result) {
            snippetsCache = { hash: hash, content: ctx.result };
            try { localStorage.setItem(SNIPPETS_CACHE_KEY, JSON.stringify(snippetsCache)); } catch (e) {}
            if (activeTab === "snippets") snippetsTA.value = ctx.result;
        } else {
            if (activeTab === "snippets") snippetsTA.value = "(Failed to generate snippets)";
        }
    };

    submitMessage(prompt, onstart, onend);
}
