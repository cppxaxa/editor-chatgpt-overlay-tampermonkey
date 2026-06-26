// ===== service_llm_browsergpt.js =====
// LLM provider that opens chatgpt.com inside a component_browser iframe tab
// and automates it via nonce-based eval. The parent page's ChatGPT stays
// untouched — all automation happens silently in the background iframe.
//
// Public API:
//   sendMessage_browsergpt(prompt) → string | null
//
// Lazily creates a browser tab + session console binding on first call.
// Reuses both on subsequent calls.

var _browsergpt_tab_id   = null;   // component_browser tab id
var _browsergpt_ready    = false;  // true once the iframe has loaded

/* Restore persisted tab id on load */
(function _browsergpt_restore() {
    try {
        const saved = localStorage.getItem("tm_browsergpt_tab_id");
        if (saved !== null) {
            const id = parseInt(saved, 10);
            if (!isNaN(id)) _browsergpt_tab_id = id;
        }
    } catch (_) {}
})();

function _browsergpt_persist() {
    if (_browsergpt_tab_id !== null) {
        localStorage.setItem("tm_browsergpt_tab_id", String(_browsergpt_tab_id));
    } else {
        localStorage.removeItem("tm_browsergpt_tab_id");
    }
}

async function _browsergpt_ensure_tab() {
    /* Reuse existing tab if still alive */
    if (_browsergpt_tab_id !== null) {
        const tabs = shell.browser.listTabs();
        if (tabs.some(t => t.id === _browsergpt_tab_id)) {
            /* Tab exists — make sure it's loaded */
            if (!_browsergpt_ready) await _browsergpt_wait_for_load();
            return _browsergpt_tab_id;
        }
        _browsergpt_tab_id = null;
        _browsergpt_ready  = false;
        _browsergpt_persist();
    }

    /* Create a new browser tab */
    _browsergpt_tab_id = shell.browser.newTab("https://chatgpt.com", "BrowserGPT");
    _browsergpt_ready  = false;
    _browsergpt_persist();

    /* Wait for the page to be interactive */
    await _browsergpt_wait_for_load();
    return _browsergpt_tab_id;
}

async function _browsergpt_wait_for_load() {
    /* Poll until the iframe's document reports "complete" and the prompt
       textarea is present (ChatGPT SPA fully booted). */
    for (let i = 0; i < 120; i++) {   // up to 60 seconds
        const { result } = await _browser_eval_in_tab(
            _browsergpt_tab_id,
            '(document.readyState === "complete" && !!document.querySelector("#prompt-textarea")) ? "ready" : "waiting"'
        );
        if (result === "ready") {
            _browsergpt_ready = true;
            return;
        }
        await new Promise(r => setTimeout(r, 500));
    }
    console.warn("service_llm_browsergpt: page load timed out");
    _browsergpt_ready = true;  // proceed anyway
}

async function sendMessage_browsergpt(prompt) {
    await _browsergpt_ensure_tab();

    /* Set up a cancel flag on the iframe's window that the injected script
       checks in its polling loops. cancelCurrentLlmJob() will set this. */
    const tab = _browser_get_tab(_browsergpt_tab_id);
    if (tab && tab.iframe && tab.iframe.contentWindow) {
        tab.iframe.contentWindow.__tm_browsergpt_cancel = false;
    }

    /* Inject and run the full automation as a single async IIFE inside
       the iframe. This avoids repeated eval round-trips for each step. */
    const escapedPrompt = JSON.stringify(prompt);
    const stopSelectors = JSON.stringify(
        'button[data-testid="stop-button"],' +
        'button[aria-label="Stop streaming"],' +
        'button[aria-label="Stop generating"],' +
        'button[aria-label="Stop"]'
    );

    const script = `(async function() {
        function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
        function cancelled() { return !!window.__tm_browsergpt_cancel; }

        /* 1. Insert text — use direct DOM manipulation instead of
           execCommand, which requires document focus (unavailable when
           the iframe is inside a hidden ServiceWindow container). */
        var input = document.querySelector("#prompt-textarea");
        if (!input) return { error: "prompt textarea not found" };
        input.innerHTML = "";
        var p = document.createElement("p");
        p.textContent = ${escapedPrompt};
        input.appendChild(p);
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));

        /* 2. Wait for send button */
        var sendBtn = null;
        for (var i = 0; i < 40; i++) {
            if (cancelled()) return { cancelled: true };
            sendBtn = document.querySelector('button[data-testid="send-button"]:not([disabled])');
            if (sendBtn) break;
            await sleep(200);
        }
        if (!sendBtn) return { error: "send button not found" };

        /* 3. Count existing responses, then click send */
        var prevCount = document.querySelectorAll('[data-message-author-role="assistant"]').length;
        sendBtn.click();

        /* 4. Wait for new assistant message to appear */
        for (var j = 0; j < 120; j++) {   // up to 60s
            if (cancelled()) return { cancelled: true };
            var msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
            if (msgs.length > prevCount) break;
            await sleep(500);
        }

        /* 5. Wait for streaming to finish (stop button disappears) */
        for (var k = 0; k < 240; k++) {   // up to 120s
            if (cancelled()) return { cancelled: true };
            var stopBtn = document.querySelector(${stopSelectors});
            if (!stopBtn) break;
            await sleep(500);
        }
        await sleep(500);  // settle

        /* 6. Extract final response text — strip code-block chrome
           (language labels, copy buttons, sticky headers) that innerText
           includes but the user doesn't want in the raw response. */
        var finalMsgs = document.querySelectorAll('[data-message-author-role="assistant"]');
        var last = finalMsgs[finalMsgs.length - 1];
        if (!last) return { error: "no assistant message found" };

        var clone = last.cloneNode(true);
        clone.querySelectorAll("pre div.sticky").forEach(function(el) { el.remove(); });
        clone.querySelectorAll('button[aria-label="Copy"]').forEach(function(el) { el.remove(); });
        clone.querySelectorAll("button").forEach(function(btn) {
            var t = btn.textContent.trim().toLowerCase();
            if (t === "copy code" || t === "copy" || t === "copied!") btn.remove();
        });

        /* Walk text nodes, convert <br> to newline */
        function walkText(node) {
            var out = "";
            if (node.nodeType === 3) return node.nodeValue;
            if (node.nodeType !== 1) return "";
            if (node.nodeName === "BR") return "\\n";
            node.childNodes.forEach(function(c) { out += walkText(c); });
            return out;
        }

        /* Replace code blocks with their clean text content */
        clone.querySelectorAll(".cm-content").forEach(function(cm) {
            var lines = cm.querySelectorAll(".cm-line");
            if (lines.length > 0) {
                var parts = [];
                lines.forEach(function(d) { parts.push(d.textContent); });
                cm.textContent = parts.join("\\n");
                return;
            }
            cm.textContent = walkText(cm);
        });
        clone.querySelectorAll("pre").forEach(function(pre) {
            if (/__CLEANED__/.test(pre.textContent)) return;
            var code = pre.querySelector("code") || pre;
            pre.textContent = walkText(code);
        });

        var text = clone.innerText.trim();
        text = text.replace(/^\`\`\`[\\w]*\\n?/gm, "").replace(/^\`\`\`\\s*$/gm, "");
        return { text: text };
    })()`;

    const { result, error } = await _browser_eval_in_tab(_browsergpt_tab_id, script);

    if (error) {
        console.error("service_llm_browsergpt: eval error:", error);
        return await _browsergpt_last_response_fallback();
    }
    if (!result) return await _browsergpt_last_response_fallback();
    if (result.cancelled) return null;
    if (result.error) {
        console.error("service_llm_browsergpt:", result.error);
        return await _browsergpt_last_response_fallback();
    }
    return result.text || null;
}

/** Last-resort: read the latest assistant message directly from the
 *  browsergpt iframe. Used when the main automation script timed out or
 *  errored but the response may have actually arrived. */
async function _browsergpt_last_response_fallback() {
    if (_browsergpt_tab_id === null) return null;
    try {
        const readScript = `(function() {
            var msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
            var last = msgs[msgs.length - 1];
            if (!last) return null;
            var clone = last.cloneNode(true);
            clone.querySelectorAll("pre div.sticky").forEach(function(el) { el.remove(); });
            clone.querySelectorAll('button[aria-label="Copy"]').forEach(function(el) { el.remove(); });
            clone.querySelectorAll("button").forEach(function(btn) {
                var t = btn.textContent.trim().toLowerCase();
                if (t === "copy code" || t === "copy" || t === "copied!") btn.remove();
            });
            clone.querySelectorAll(".cm-content").forEach(function(cm) {
                var lines = cm.querySelectorAll(".cm-line");
                if (lines.length > 0) {
                    var parts = [];
                    lines.forEach(function(d) { parts.push(d.textContent); });
                    cm.textContent = parts.join("\\n");
                    return;
                }
            });
            var text = clone.innerText.trim();
            text = text.replace(/^\`\`\`[\\w]*\\n?/gm, "").replace(/^\`\`\`\\s*$/gm, "");
            return text || null;
        })()`;
        const { result } = await _browser_eval_in_tab(_browsergpt_tab_id, readScript);
        if (result) {
            console.log("service_llm_browsergpt: recovered response via fallback read");
            return result;
        }
    } catch (_) {}
    return null;
}

/* Called by cancelCurrentLlmJob — sets the cancel flag on the iframe
   so the in-flight browsergpt script stops polling and returns early. */
function _browsergpt_cancel() {
    if (_browsergpt_tab_id === null) return;
    try {
        const tab = _browser_get_tab(_browsergpt_tab_id);
        if (tab && tab.iframe && tab.iframe.contentWindow) {
            tab.iframe.contentWindow.__tm_browsergpt_cancel = true;
        }
    } catch (_) {}
}
