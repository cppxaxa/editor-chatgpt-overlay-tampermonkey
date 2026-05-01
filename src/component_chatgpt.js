// -----------------------------------------------------------------------------
// component_chatgpt.js — ChatGPT DOM automation. The bridge between the
// scratchpad and ChatGPT's UI.
// -----------------------------------------------------------------------------

const STOP_BTN_SELECTOR = [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop"]'
].join(",");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function yieldFrame() { return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); }

async function insertTextIntoChatGPT(prompt) {

    const input = document.querySelector("#prompt-textarea");

    if (!input) {
        alert("ChatGPT prompt box not found");
        return false;
    }

    input.focus();
    input.innerHTML = "";

    document.execCommand("insertText", false, prompt);

    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    return true;
}

async function waitForSendButton() {

    for (let i = 0; i < 40; i++) {

        const btn = document.querySelector(
            'button[data-testid="send-button"]:not([disabled])'
        );

        if (btn) return btn;

        await sleep(200);
    }

    return null;
}

async function sendPromptToChatGPT(prompt) {

    const previousCount = document.querySelectorAll(
        '[data-message-author-role="assistant"]'
    ).length;

    const ok = await insertTextIntoChatGPT(prompt);
    if (!ok) return null;

    const sendButton = await waitForSendButton();

    if (!sendButton) {
        alert("Send button not found");
        return null;
    }

    sendButton.click();

    return await waitForAssistantResponse(previousCount);
}

function extractCleanText(messageEl) {

    const clone = messageEl.cloneNode(true);

    clone.querySelectorAll("pre div.sticky").forEach(el => el.remove());
    clone.querySelectorAll('button[aria-label="Copy"]').forEach(el => el.remove());

    clone.querySelectorAll("button").forEach(btn => {
        const text = btn.textContent.trim().toLowerCase();
        if (text === "copy code" || text === "copy" || text === "copied!") {
            btn.remove();
        }
    });

    /* Code blocks use CodeMirror (cm-content) with <br> for line breaks.
       innerText can lose these breaks, so we extract code blocks separately. */
    const codeBlocks = clone.querySelectorAll(".cm-content");
    const codePlaceholders = [];

    codeBlocks.forEach(cm => {

        const lines = [];
        let currentLine = "";

        cm.childNodes.forEach(node => {
            if (node.nodeName === "BR") {
                lines.push(currentLine);
                currentLine = "";
            } else {
                currentLine += node.textContent;
            }
        });

        if (currentLine) lines.push(currentLine);

        const codeText = lines.join("\n");
        const placeholder = "__CODE_BLOCK_" + codePlaceholders.length + "__";
        codePlaceholders.push(codeText);

        cm.textContent = placeholder;
    });

    let result = clone.innerText.trim();

    codePlaceholders.forEach((code, i) => {
        result = result.replace("__CODE_BLOCK_" + i + "__", code);
    });

    result = result.replace(/^```[\w]*\n?/gm, "").replace(/^```\s*$/gm, "");

    return result.trim();
}

function waitForAssistantResponse(previousCount) {

    const signal = waitAbortController ? waitAbortController.signal : null;

    return new Promise(resolve => {

        let phase = 1;

        const interval = setInterval(() => {

            if (signal && signal.aborted) {
                clearInterval(interval);
                resolve(null);
                return;
            }

            const messages = document.querySelectorAll(
                '[data-message-author-role="assistant"]'
            );

            if (phase === 1) {
                if (messages.length > previousCount) phase = 2;
                return;
            }

            if (phase === 2) {

                const stopBtn = document.querySelector(STOP_BTN_SELECTOR);

                if (!stopBtn) {
                    phase = 3;

                    setTimeout(() => {

                        if (signal && signal.aborted) {
                            clearInterval(interval);
                            resolve(null);
                            return;
                        }

                        clearInterval(interval);

                        const finalMessages = document.querySelectorAll(
                            '[data-message-author-role="assistant"]'
                        );

                        const last = finalMessages[finalMessages.length - 1];
                        resolve(last ? extractCleanText(last) : "");

                    }, 500);
                }

                return;
            }

        }, 500);
    });
}
