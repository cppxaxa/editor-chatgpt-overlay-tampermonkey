// -----------------------------------------------------------------------------
// component_tab_ascii.js — Ascii design tab generator.
// -----------------------------------------------------------------------------

async function generateAsciiDiagram(code, hash) {

    waitAbortController = new AbortController();
    showWaitingUI();

    const prompt = "Analyze the following code and create an ASCII box diagram showing its architecture, " +
        "main components, and their relationships. Use simple ASCII box drawing characters " +
        "(+, -, |, >, arrows). Keep it concise and readable. Respond ONLY with the ASCII " +
        "diagram, no explanations enclosed inside triple quotes pair : \"```md and ```\", denoting code." +
        "\n\nCode:\n" + code;

    try {
        const response = await sendPromptToChatGPT(prompt);

        if (waitAbortController && waitAbortController.signal.aborted) return;

        if (response) {
            asciiCache = { hash: hash, content: response };
            try { localStorage.setItem(ASCII_CACHE_KEY, JSON.stringify(asciiCache)); } catch (e) {}
            if (activeTab === "ascii") asciiTA.value = response;
        } else {
            if (activeTab === "ascii") asciiTA.value = "(Failed to generate ASCII diagram)";
        }
    } catch (e) {
        if (activeTab === "ascii") asciiTA.value = "(Error generating ASCII diagram: " + e.message + ")";
    } finally {
        waitAbortController = null;
        hideWaitingUI();
    }
}
