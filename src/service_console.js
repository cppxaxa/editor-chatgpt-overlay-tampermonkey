// -----------------------------------------------------------------------------
// service_console.js — FIFO command queue for the JS console window.
//
// Public API:
//
//     const ctx = await submitConsoleMessage("alert('h')");
//     // ctx === { command, result, error, cancelled }
//
//     submitConsoleMessage(
//         "var x = 1;\nfor (let i = 0; i < 3; i++) console.log(x + i);",
//         (ctx) => { /* onstart */ },
//         (ctx) => { /* onend */ }
//     );
//
// Each call to submitConsoleMessage() enqueues ONE job. The string may contain
// any number of newlines — the entire block is eval'd as a single unit (so
// `var`/`let`/`const`/`function` declarations span the whole block). Jobs run
// strictly one at a time in FIFO order — additional submissions wait their
// turn whether they came from the textbox in component_console or from another
// component calling submitConsoleMessage() directly.
//
// flushConsoleQueue() drops every PENDING job (each receives
// onend({ cancelled: true })) but does not interrupt a running job. Eval is
// synchronous, so a "running" job effectively means "scheduled this microtask"
// — there is no abort-mid-eval semantics.
//
// The actual eval + colored output rendering live in component_console.js
// (component_console_execute). This service is purely the queue.
// -----------------------------------------------------------------------------

const _console_queue = [];
let _console_processing = false;

function submitConsoleMessage(command, onstart, onend) {

    return new Promise(resolve => {
        _console_queue.push({ command, onstart, onend, resolve });
        _console_drain_queue();
    });
}

async function _console_drain_queue() {

    if (_console_processing) return;
    if (_console_queue.length === 0) return;

    _console_processing = true;

    while (_console_queue.length > 0) {

        const job = _console_queue.shift();
        const ctx = {
            command: job.command,
            result: undefined,
            error: null,
            cancelled: false
        };

        if (typeof job.onstart === "function") {
            try { job.onstart(ctx); }
            catch (e) { console.error("submitConsoleMessage onstart threw:", e); }
        }

        try {
            /* component_console_execute renders the input echo, captures
               console.*, and returns { result, error }. If the component
               window has not been created yet, lazy-create it so output is
               visible. */
            if (typeof component_console_create === "function" &&
                typeof consoleContainer !== "undefined" &&
                consoleContainer === null) {
                component_console_create();
            }

            const out = component_console_execute(job.command);
            ctx.result = out.result;
            ctx.error  = out.error;

        } catch (err) {
            ctx.error = err;
            console.error("submitConsoleMessage job failed:", err);
        }

        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("submitConsoleMessage onend threw:", e); }
        }

        try { job.resolve(ctx); } catch (_) { }

        /* Yield to the event loop between jobs so the UI can paint the new
           output line and the user can interact with the window between
           commands. */
        await new Promise(r => setTimeout(r, 0));
    }

    _console_processing = false;
}

function flushConsoleQueue() {

    const pending = _console_queue.splice(0, _console_queue.length);

    pending.forEach(job => {

        const ctx = {
            command: job.command,
            result: undefined,
            error: null,
            cancelled: true
        };

        if (typeof job.onend === "function") {
            try { job.onend(ctx); }
            catch (e) { console.error("flushConsoleQueue onend threw:", e); }
        }

        try { job.resolve(ctx); } catch (_) { }
    });
}
