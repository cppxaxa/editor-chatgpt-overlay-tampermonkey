// -----------------------------------------------------------------------------
// service_llm_nvidia_build.js — LLM provider for build.nvidia.com playground.
//
// Implements the same contract as the ChatGPT provider (service_llm.js):
//   sendMessage_nvidia(prompt) → string | null
//
// DOM selectors (build.nvidia.com):
//   Textarea:      textarea[data-testid="nv-text-area-element"]
//   Send button:   button[aria-label="Send"]
//   Cancel button: button[aria-label="cancel"]
//   Prompt bubble: div[data-testid="chat-bubble-prompt"]
//   Response:      div[data-testid="chat-bubble-response"]
//   Loading:       div[data-testid="chat-bubble-loading"]
//   Error toast:   [data-sonner-toast][data-type=error]
// -----------------------------------------------------------------------------

function sleep_nvidia(ms) { return new Promise(r => setTimeout(r, ms)); }

async function insertText_nvidia(prompt) {

    const textarea = document.querySelector('textarea[data-testid="nv-text-area-element"]');

    if (!textarea) {
        alert("NVIDIA Build prompt textarea not found");
        return false;
    }

    textarea.focus();

    /* Clear existing content */
    textarea.value = "";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    /* Use native setter to trigger React state update */
    const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
    ).set;
    nativeSetter.call(textarea, prompt);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));

    return true;
}

async function waitForSendButton_nvidia() {

    for (let i = 0; i < 40; i++) {

        const btn = document.querySelector(
            'button[aria-label="Send"]:not([disabled])'
        );

        if (btn) return btn;

        await sleep_nvidia(200);
    }

    return null;
}

function extractCleanText_nvidia(responseEl) {

    const clone = responseEl.cloneNode(true);

    /* Remove all buttons (Copy, thumbs, language tabs like "JSON") */
    clone.querySelectorAll("button").forEach(btn => btn.remove());

    /* Remove SVG icons */
    clone.querySelectorAll("svg").forEach(svg => svg.remove());

    /* Remove the code block header bar (contains "JSON" tab, "Copy" text).
       It sits inside the bordered container above the <pre>. */
    clone.querySelectorAll(".space-between").forEach(bar => bar.remove());

    /* Also remove any aria-hidden spans (e.g. "Copied" ghost text) */
    clone.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());

    /* Remove the performance stats bar (e.g. "5.88 s  4.94 TPS  16 ms TTFT") */
    clone.querySelectorAll('[data-testid="nv-tooltip-trigger"]').forEach(el => el.remove());

    /* Remove vertical separator divs between action buttons */
    clone.querySelectorAll('div[role="separator"]').forEach(el => el.remove());

    /* Code blocks: extract textContent from <pre><code> which gives clean
       text even when tokens are wrapped in <span class="token ...">. */
    clone.querySelectorAll('pre[data-testid="highlighted-code"] code').forEach(code => {
        const text = code.textContent;
        code.parentElement.textContent = text;
    });

    let result = clone.innerText || clone.textContent || "";

    /* Strip markdown fences if present */
    result = result.replace(/^```[\w]*\n?/gm, "").replace(/^```\s*$/gm, "");

    return result.trim();
}

function waitForResponse_nvidia(previousCount) {

    const isCancelled = () => !!(_llm_currentJob && _llm_currentJob.cancelled);

    return new Promise(resolve => {

        let phase = 1;

        const interval = setInterval(() => {

            if (isCancelled()) {
                clearInterval(interval);
                resolve(null);
                return;
            }

            const responses = document.querySelectorAll(
                'div[data-testid="chat-bubble-response"]'
            );

            if (phase === 1) {
                /* Wait for a new response bubble or loading indicator */
                const loading = document.querySelector(
                    'div[data-testid="chat-bubble-loading"]'
                );
                if (responses.length > previousCount || loading) {
                    phase = 2;
                }
                return;
            }

            if (phase === 2) {
                /* Wait for generation to finish:
                   - cancel button disappears
                   - loading bubble disappears
                   - no active streaming indicators */
                const cancelBtn = document.querySelector(
                    'button[aria-label="cancel"]'
                );
                const loading = document.querySelector(
                    'div[data-testid="chat-bubble-loading"]'
                );

                if (!cancelBtn && !loading) {
                    phase = 3;

                    /* Brief delay for final DOM settle */
                    setTimeout(() => {

                        if (isCancelled()) {
                            clearInterval(interval);
                            resolve(null);
                            return;
                        }

                        clearInterval(interval);

                        /* Check for error toast */
                        const errorToast = document.querySelector(
                            '[data-sonner-toast][data-type="error"]'
                        );
                        if (errorToast) {
                            const desc = errorToast.querySelector("[data-description]");
                            const errMsg = desc ? desc.textContent.trim() : "Generation error";
                            console.error("NVIDIA Build error:", errMsg);
                            resolve(null);
                            return;
                        }

                        const finalResponses = document.querySelectorAll(
                            'div[data-testid="chat-bubble-response"]'
                        );

                        const last = finalResponses[finalResponses.length - 1];
                        resolve(last ? extractCleanText_nvidia(last) : "");

                    }, 500);
                }

                return;
            }

        }, 500);
    });
}

async function sendMessage_nvidia(prompt) {

    const previousCount = document.querySelectorAll(
        'div[data-testid="chat-bubble-response"]'
    ).length;

    const ok = await insertText_nvidia(prompt);
    if (!ok) return null;

    const sendButton = await waitForSendButton_nvidia();

    if (!sendButton) {
        alert("Send button not found on NVIDIA Build");
        return null;
    }

    sendButton.click();

    return await waitForResponse_nvidia(previousCount);
}
