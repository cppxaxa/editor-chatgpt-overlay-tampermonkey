// -----------------------------------------------------------------------------
// service_llm.js — LLM provider abstraction layer.
//
// This is the ONLY file that contains site-specific DOM selectors. Every other
// component in the codebase talks to the LLM exclusively through the public
// queue API (submitMessage / flushLlmQueue / cancelCurrentLlmJob). To port the
// entire UI stack to a different LLM website (e.g. Gemini, Claude, Copilot),
// rewrite the 5 provider functions below and update header.js @match — nothing
// else needs to change.
//
// ── Provider functions (site-specific, ~170 lines) ──────────────────────────
//
//   insertTextIntoChatGPT_llm(prompt)
//       Insert `prompt` text into the site's input textarea / contenteditable.
//       Current selector: #prompt-textarea
//
//   waitForSendButton_llm()
//       Poll until the send button is enabled and return it (or null on timeout).
//       Current selector: button[data-testid="send-button"]:not([disabled])
//
//   waitForAssistantResponse_llm(previousCount)
//       Two-phase poll: (1) wait for a new assistant message to appear,
//       (2) wait for streaming to stop (stop button disappears), then return
//       the cleaned response text.
//       Current selector: [data-message-author-role="assistant"]
//       Stop button: STOP_BTN_SELECTOR_llm
//
//   extractCleanText_llm(messageEl)
//       Clone a response DOM node, strip UI chrome (copy buttons, sticky
//       headers), extract text preserving code block formatting.
//       Depends on the site's response HTML structure (CodeMirror, markdown
//       <pre><code>, etc.).
//
//   sendMessage_chatgpt(prompt)
//       Orchestrator: calls insertText → waitForSendButton → click →
//       waitForAssistantResponse. Returns the cleaned response string.
//
//   sendMessage(prompt)
//       Thin dispatch — calls sendMessage_chatgpt(). To switch providers,
//       point this at your replacement (e.g. sendMessage_gemini).
//
// ── Queue API (site-agnostic, do NOT modify for porting) ────────────────────
//
//   submitMessage(prompt, onstart, onend)  — FIFO queue, one job at a time.
//   flushLlmQueue()                        — drop all pending jobs.
//   cancelCurrentLlmJob()                  — cancel the in-flight job.
//
// ── Lift-and-shift checklist ────────────────────────────────────────────────
//
//   1. Copy this file and rewrite the 5 provider functions for the target site.
//   2. Update src/header.js: change @match to the new site's URL.
//   3. If the new site has a different CSP policy, check the nonce-based eval
//      in component_console.js (component_console_eval).
//   4. Everything else (editor, tabs, clock, calc, console, shell, taskbar,
//      toast, etc.) works unchanged — they only call submitMessage().
//
// -----------------------------------------------------------------------------

const STOP_BTN_SELECTOR_llm = [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop"]'
].join(",");

function sleep_llm(ms) { return new Promise(r => setTimeout(r, ms)); }

async function insertTextIntoChatGPT_llm(prompt) {

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

async function waitForSendButton_llm() {

    for (let i = 0; i < 40; i++) {

        const btn = document.querySelector(
            'button[data-testid="send-button"]:not([disabled])'
        );

        if (btn) return btn;

        await sleep_llm(200);
    }

    return null;
}

function extractCleanText_llm(messageEl) {

    const clone = messageEl.cloneNode(true);

    /* Walk a subtree and concatenate text nodes, converting <br> to "\n".
       Necessary because ChatGPT's rendered code blocks often use <br> as the
       only line separator inside <pre><code><span>line</span><br>… and
       textContent silently drops <br>, collapsing the block to one line. */
    function extractTextWithBR(root) {
        let out = "";
        const walk = (node) => {
            if (node.nodeType === 3) {           // TEXT_NODE
                out += node.nodeValue;
                return;
            }
            if (node.nodeType !== 1) return;     // anything else: skip
            if (node.nodeName === "BR") {
                out += "\n";
                return;
            }
            node.childNodes.forEach(walk);
        };
        walk(root);
        return out;
    }

    clone.querySelectorAll("pre div.sticky").forEach(el => el.remove());
    clone.querySelectorAll('button[aria-label="Copy"]').forEach(el => el.remove());

    clone.querySelectorAll("button").forEach(btn => {
        const text = btn.textContent.trim().toLowerCase();
        if (text === "copy code" || text === "copy" || text === "copied!") {
            btn.remove();
        }
    });

    /* Code blocks arrive in any of these shapes:

         (a) <pre><code>…<br>…</code></pre>                    (markdown render)
         (b) <div class="cm-content">…<br>…</div>              (CodeMirror, old)
         (c) <div class="cm-content"><div class="cm-line">…    (CodeMirror, new)

       The unifying primitive is extractTextWithBR — text nodes pass through,
       <br> becomes "\n", everything else recurses. This handles all three
       shapes uniformly and avoids relying on innerText/textContent quirks
       (textContent drops <br>; innerText behaviour depends on CSS context
       and is unreliable inside Tampermonkey's sandbox).

       Process the most specific selectors first so a single block isn't
       captured twice. */

    const codePlaceholders = [];

    function captureCode(el, text) {
        const placeholder = "__CODE_BLOCK_" + codePlaceholders.length + "__";
        codePlaceholders.push(text);
        el.textContent = placeholder;
    }

    /* (b)/(c): CodeMirror containers. */
    clone.querySelectorAll(".cm-content").forEach(cm => {

        /* Newer CodeMirror layout: each line is a div.cm-line with no <br>
           between lines. Join their textContent with "\n" explicitly. */
        const cmLines = cm.querySelectorAll(".cm-line");
        if (cmLines.length > 0) {
            const lines = [];
            cmLines.forEach(div => lines.push(div.textContent));
            captureCode(cm, lines.join("\n"));
            return;
        }

        /* Older CodeMirror layout (or any other shape) — let the BR walker
           handle it. */
        captureCode(cm, extractTextWithBR(cm));
    });

    /* (a): Markdown <pre><code>. */
    clone.querySelectorAll("pre").forEach(pre => {

        /* Skip <pre> already replaced via the .cm-content pass above. */
        if (/__CODE_BLOCK_\d+__/.test(pre.textContent)) return;

        const code = pre.querySelector("code") || pre;
        const text = extractTextWithBR(code);
        if (!text) return;

        captureCode(pre, text);
    });

    let result = clone.innerText.trim();

    codePlaceholders.forEach((code, i) => {
        result = result.replace("__CODE_BLOCK_" + i + "__", code);
    });

    result = result.replace(/^```[\w]*\n?/gm, "").replace(/^```\s*$/gm, "");

    return result.trim();
}

function waitForAssistantResponse_llm(previousCount) {

    const isCancelled = () => !!(_llm_currentJob && _llm_currentJob.cancelled);

    return new Promise(resolve => {

        let phase = 1;

        const interval = setInterval(() => {

            if (isCancelled()) {
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

                const stopBtn = document.querySelector(STOP_BTN_SELECTOR_llm);

                if (!stopBtn) {
                    phase = 3;

                    setTimeout(() => {

                        if (isCancelled()) {
                            clearInterval(interval);
                            resolve(null);
                            return;
                        }

                        clearInterval(interval);

                        const finalMessages = document.querySelectorAll(
                            '[data-message-author-role="assistant"]'
                        );

                        const last = finalMessages[finalMessages.length - 1];
                        resolve(last ? extractCleanText_llm(last) : "");

                    }, 500);
                }

                return;
            }

        }, 500);
    });
}

async function sendMessage_chatgpt(prompt) {

    const previousCount = document.querySelectorAll(
        '[data-message-author-role="assistant"]'
    ).length;

    const ok = await insertTextIntoChatGPT_llm(prompt);
    if (!ok) return null;

    const sendButton = await waitForSendButton_llm();

    if (!sendButton) {
        alert("Send button not found");
        return null;
    }

    sendButton.click();

    return await waitForAssistantResponse_llm(previousCount);
}

async function sendMessage(prompt) {
    const host = location.hostname;
    if (host.includes("chatgpt.com"))      return await sendMessage_browsergpt(prompt);
    if (host.includes("build.nvidia.com")) return await sendMessage_nvidia(prompt);
    console.error("service_llm: no provider for " + host);
    return null;
}

// -----------------------------------------------------------------------------
// Public entry point.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Queued public entry point.
//
// submitMessage(prompt, onstart, onend) enqueues a prompt for sequential
// processing. Only one job runs at a time — additional submissions wait their
// turn in FIFO order.
//
//   onstart(ctx)  is invoked just before the prompt is dispatched to ChatGPT.
//   onend(ctx)    is invoked after the response arrives (success or error).
//
// `ctx` is an object: { prompt, result, error, cancelled }.
//   - On `onstart`, only `prompt` is meaningful.
//   - On `onend`, `result` is the cleaned response text (or null on
//     failure/cancel), `error` is the thrown error if any, and `cancelled`
//     is true if the user cancelled the wait (via cancelCurrentLlmJob)
//     or if the queue was flushed before the job ran.
//
// Returns a Promise that resolves with the same `ctx` passed to `onend`, so
// callers may either use callbacks, await the promise, or both.
// -----------------------------------------------------------------------------

const _llm_queue = [];
let _llm_processing = false;
let _llm_currentJob = null;   // { ctx, cancelled } while a job is in flight

function submitMessage(prompt, onstart, onend) {

    return new Promise(resolve => {

        _llm_queue.push({ prompt, onstart, onend, resolve });
        _llm_drain_queue();
    });
}

async function _llm_drain_queue() {

    if (_llm_processing) return;
    if (_llm_queue.length === 0) return;

    _llm_processing = true;

    while (_llm_queue.length > 0) {

        const job = _llm_queue.shift();
        const ctx = { prompt: job.prompt, result: null, error: null, cancelled: false };

        _llm_currentJob = { ctx, cancelled: false };

        try {
            if (typeof job.onstart === "function") {
                try { job.onstart(ctx); }
                catch (e) { console.error("submitMessage onstart threw:", e); }
            }

            const result = await sendMessage(job.prompt);

            ctx.result = result;
            if (_llm_currentJob.cancelled) {
                ctx.cancelled = true;
            } else if (result === null) {
                ctx.cancelled = true;
            }

        } catch (err) {
            ctx.error = err;
            console.error("submitMessage job failed:", err);
        }

        _llm_currentJob = null;

        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("submitMessage onend threw:", e); }
        }

        try { job.resolve(ctx); } catch (_) { }
    }

    _llm_processing = false;
}

// -----------------------------------------------------------------------------
// cancelCurrentLlmJob() — flip the cancel flag on the currently-running job
// (if any). The polling loop in waitForAssistantResponse_llm observes this on
// its next tick and bails out, resolving with null. No-op if no job is in
// flight.
// -----------------------------------------------------------------------------
function cancelCurrentLlmJob() {
    if (_llm_currentJob) _llm_currentJob.cancelled = true;
    if (typeof _browsergpt_cancel === "function") _browsergpt_cancel();
}

// -----------------------------------------------------------------------------
// flushLlmQueue() — drop all PENDING submitMessage jobs (does not touch the
// currently-running one; cancel that via cancelCurrentLlmJob()).
// Each dropped job receives an `onend({ cancelled: true })` so its caller can
// tear down UI state, then its promise resolves.
// -----------------------------------------------------------------------------
function flushLlmQueue() {

    const pending = _llm_queue.splice(0, _llm_queue.length);

    pending.forEach(job => {

        const ctx = { prompt: job.prompt, result: null, error: null, cancelled: true };

        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("flushLlmQueue onend threw:", e); }
        }

        try { job.resolve(ctx); } catch (_) { }
    });
}