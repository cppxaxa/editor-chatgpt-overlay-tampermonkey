// -----------------------------------------------------------------------------
// service_session_console.js — FIFO command queue for the session console.
//
// Mirrors service_console.js but scoped per-tab. Each tab's commands run
// strictly one-at-a-time in FIFO order.
//
// Public API:
//
//     const ctx = await submitSessionConsoleMessage(tabId, "document.title");
//     // ctx === { tabId, command, result, error, cancelled }
//
//     flushSessionConsoleQueue(tabId?)  // drop pending for one or all tabs
//
// The actual eval + output rendering live in component_session_console.js.
// This service is purely the queue.
// -----------------------------------------------------------------------------

const _session_console_queue = [];
let _session_console_processing = false;

function submitSessionConsoleMessage(tabId, command, onstart, onend) {

    return new Promise(resolve => {
        _session_console_queue.push({ tabId, command, onstart, onend, resolve });
        _session_console_drain_queue();
    });
}

async function _session_console_drain_queue() {

    if (_session_console_processing) return;
    if (_session_console_queue.length === 0) return;

    _session_console_processing = true;

    while (_session_console_queue.length > 0) {

        const job = _session_console_queue.shift();
        const ctx = {
            tabId:     job.tabId,
            command:   job.command,
            result:    undefined,
            error:     null,
            cancelled: false
        };

        if (typeof job.onstart === "function") {
            try { job.onstart(ctx); }
            catch (e) { console.error("submitSessionConsoleMessage onstart threw:", e); }
        }

        try {
            const out = await component_session_console_execute(job.tabId, job.command);
            ctx.result = out.result;
            ctx.error  = out.error;
        } catch (err) {
            ctx.error = err;
            console.error("submitSessionConsoleMessage job failed:", err);
        }

        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("submitSessionConsoleMessage onend threw:", e); }
        }

        try { job.resolve(ctx); } catch (_) { }

        /* Yield to event loop between jobs */
        await new Promise(r => setTimeout(r, 0));
    }

    _session_console_processing = false;
}

function flushSessionConsoleQueue(tabId) {

    const indices = [];
    for (let i = _session_console_queue.length - 1; i >= 0; i--) {
        if (tabId === undefined || _session_console_queue[i].tabId === tabId) {
            indices.push(i);
        }
    }

    indices.forEach(i => {
        const job = _session_console_queue.splice(i, 1)[0];
        const ctx = {
            tabId:     job.tabId,
            command:   job.command,
            result:    undefined,
            error:     null,
            cancelled: true
        };
        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("flushSessionConsoleQueue onend threw:", e); }
        }
        try { job.resolve(ctx); } catch (_) { }
    });
}
