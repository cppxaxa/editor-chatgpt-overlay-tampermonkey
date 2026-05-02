// -----------------------------------------------------------------------------
// component_tab_question.js — Question tab generator.
// -----------------------------------------------------------------------------

async function generateQuestion(code, hash) {

    waitAbortController = new AbortController();
    showWaitingUI();

    const prompt = "Analyze the following code (it may be partial/half-written) and figure out what problem it is solving. " +
        "If it is a LeetCode problem, identify the question number and title. Follow this EXACT format:\n\n" +
        "Title: [LeetCode #number] Problem Title\n" +
        "(If you cannot identify the exact LeetCode question, use: [x] Unable to identify LeetCode question - Best guess: <title>)\n\n" +
        "## Question\n<Full problem statement>\n\n" +
        "## Constraints\n<List all constraints>\n\n" +
        "## Example 1\nInput: ...\nOutput: ...\nExplanation: ...\n\n" +
        "## Example 2\nInput: ...\nOutput: ...\nExplanation: ...\n\n" +
        "## Hints\n<2-3 hints>\n\n" +
        "## Companies Asked\n<List of companies known to ask this>\n\n" +
        "## Expected Complexity (Interview)\nTime: O(...)\nSpace: O(...)\n\n" +
        "## Topics\n<List of relevant topics/tags>\n\n" +
        "If it is NOT a LeetCode question, still frame the problem the code is trying to solve with corner cases, expected TC and SC.\n" +
        "You may use ASCII diagrams where helpful.\n" +
        "Enclose your ENTIRE response inside ```md and ``` so it is treated as markdown code.\n\n" +
        "Code:\n" + code;

    try {
        const response = await sendMessage(prompt);

        if (waitAbortController && waitAbortController.signal.aborted) return;

        if (response) {
            questionCache = { hash: hash, content: response };
            try { localStorage.setItem(QUESTION_CACHE_KEY, JSON.stringify(questionCache)); } catch (e) {}
            if (activeTab === "question") questionTA.value = response;
        } else {
            if (activeTab === "question") questionTA.value = "(Failed to generate question)";
        }
    } catch (e) {
        if (activeTab === "question") questionTA.value = "(Error generating question: " + e.message + ")";
    } finally {
        waitAbortController = null;
        hideWaitingUI();
    }
}
