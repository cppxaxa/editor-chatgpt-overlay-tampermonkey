// -----------------------------------------------------------------------------
// component_tab_spreview.js — S-Preview tab generator (syntax-highlighted
// HTML rendered in a sandboxed iframe).
// -----------------------------------------------------------------------------

function setSpreviewContent(html) {
    const cssReset = '<style>pre,code{white-space:pre!important;tab-size:4!important}td pre{margin:0!important}</style>';
    if (html.indexOf('<head') !== -1) {
        html = html.replace(/<head[^>]*>/i, m => m + cssReset);
    } else if (html.indexOf('<html') !== -1) {
        html = html.replace(/<html[^>]*>/i, m => m + cssReset);
    } else {
        html = cssReset + html;
    }
    spreviewFrame.srcdoc = html;
}

async function generateSpreview(code, hash) {

    waitAbortController = new AbortController();
    showWaitingUI();

    const prompt = "Take the following source code and produce a single, self-contained HTML document that displays it " +
        "with advanced, IDE-quality syntax highlighting. Requirements:\n\n" +
        "1. Use inline CSS only (no external stylesheets or JS)\n" +
        "2. Light background (#fff) with high-contrast, WCAG AA compliant colors\n" +
        "3. Color categories (colorblind-friendly palette):\n" +
        "   - Language keywords (if, else, for, return, new, var, class, public, static, async, etc.): bold blue (#0550ae)\n" +
        "   - Type names, class names, framework types (int, long, string, bool, List, Dictionary, PriorityQueue, " +
        "HashSet, Array, Tuple, Task, etc.): teal (#0e7c6b) — color EVERY occurrence including in generics like List<int>\n" +
        "   - Numbers, numeric constants, and built-in constants (long.MaxValue, int.MinValue, null, true, false): purple (#6f42c1)\n" +
        "   - Strings and char literals: dark red (#a31515)\n" +
        "   - Method calls and function names (.Add, .Enqueue, .TryDequeue, .ToString, .Count, etc.): orange (#953800) — " +
        "color the dot AND the method name for EVERY call site\n" +
        "   - Comments: italic dark gray (#57606a)\n" +
        "   - Properties and member access (.Length, .Count, .Value): orange (#953800)\n" +
        "   - Regular identifiers: black (#24292f)\n" +
        "4. Important variables: Identify the semantically important variables in the code (function parameters, " +
        "key data structures, accumulators, result variables, graph/source/target/dist/result etc.). " +
        "Assign EACH important variable its own distinct soft pastel background color so they are visually " +
        "distinguishable at a glance. Use colors like: #fff3cd (warm yellow), #d1ecf1 (light blue), " +
        "#d4edda (light green), #f8d7da (light pink), #e2d9f3 (light lavender), #fde2c8 (light peach), " +
        "#d6eaf8 (sky blue), #dcedc8 (pale lime). Each variable gets ONE consistent color across ALL its " +
        "occurrences throughout the entire code — not just at declaration but EVERY usage. " +
        "Limit to 6-8 most important variables to avoid visual clutter.\n" +
        "Additionally, among those important variables, identify the ones that hold CORE algorithmic data structures " +
        "— the ones driving the algorithm's main logic (e.g. pq/priorityQueue in Dijkstra, visited/seen HashSet, " +
        "dp array, stack in DFS, queue in BFS, memo cache, adjacency list, tree node pointers, linked list head/curr). " +
        "Render these variables in BOLD with a slightly darker/richer background version of their assigned color. " +
        "This makes them instantly stand out as the 'engine' variables of the algorithm.\n" +
        "5. Use a monospace font (Consolas, monospace), line numbers in a gutter column, and comfortable line spacing (1.5)\n" +
        "6. Detect the programming language automatically\n" +
        "7. CRITICAL: Preserve ALL indentation exactly. Use a <pre> element with white-space:pre. " +
        "Use a <table> layout where column 1 is the line number (right-aligned, gray, padding-right:1em) " +
        "and column 2 is the code line inside a <pre> with margin:0 and white-space:pre. " +
        "Do NOT trim or collapse any leading spaces or tabs.\n" +
        "8. CRITICAL: You MUST include EVERY SINGLE LINE of the source code in the HTML output — from the very first " +
        "line to the very last line. Do NOT truncate, summarize, skip, or abbreviate ANY part of the code. " +
        "If the code has multiple functions or classes, ALL of them must appear in full. " +
        "The HTML line count must match the source code line count exactly. Do NOT add comments like " +
        "'// rest of code...' or '// similar for other functions'. Output the COMPLETE code.\n" +
        "9. Respond ONLY with the complete HTML document, nothing else — no explanations, no markdown fences\n\n" +
        "Code:\n" + code;

    try {
        const response = await sendMessage(prompt);

        if (waitAbortController && waitAbortController.signal.aborted) return;

        if (response) {
            let html = response
                .replace(/^```html?\n?/i, "")
                .replace(/```\s*$/, "")
                .trim();

            spreviewCache = { hash: hash, content: html };

            try { localStorage.setItem(SPREVIEW_CACHE_KEY, JSON.stringify(spreviewCache)); } catch (e) {}

            if (activeTab === "spreview") setSpreviewContent(html);
        } else {
            if (activeTab === "spreview") setSpreviewContent("<p style='font-family:monospace;padding:20px;color:red'>(Failed to generate preview)</p>");
        }
    } catch (e) {
        if (activeTab === "spreview") setSpreviewContent("<p style='font-family:monospace;padding:20px;color:red'>(Error: " + e.message + ")</p>");
    } finally {
        waitAbortController = null;
        hideWaitingUI();
    }
}
