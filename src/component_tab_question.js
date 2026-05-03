// -----------------------------------------------------------------------------
// component_tab_question.js — Question tab generator.
// -----------------------------------------------------------------------------

/* ---- Question-tab-owned state ---- */

let questionTA;
let questionCache = { hash: null, content: "" };
const QUESTION_CACHE_KEY = "tm_question_cache";

function generateQuestion(code, hash) {

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

    const onstart = (ctx) => {
        showWaitingUI();
    };

    const onend = (ctx) => {
        hideWaitingUI();

        if (ctx.cancelled) return;

        if (ctx.error) {
            if (activeTab === "question") questionTA.value = "(Error generating question: " + ctx.error.message + ")";
            return;
        }

        if (ctx.result) {
            questionCache = { hash: hash, content: ctx.result };
            try { localStorage.setItem(QUESTION_CACHE_KEY, JSON.stringify(questionCache)); } catch (e) {}
            if (activeTab === "question") questionTA.value = ctx.result;
        } else {
            if (activeTab === "question") questionTA.value = "(Failed to generate question)";
        }
    };

    submitMessage(prompt, onstart, onend);
}
