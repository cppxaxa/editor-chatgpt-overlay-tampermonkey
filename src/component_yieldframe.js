// -----------------------------------------------------------------------------
// component_yieldframe.js — tiny UI-paint helper.
//
// yieldFrame() awaits one requestAnimationFrame plus a setTimeout(0). Use it
// after mutating the DOM (e.g. swapping the action-button row for a spinner
// via showWaitingUI) and before kicking off a long synchronous-looking
// async chain — it gives the browser a chance to paint the new state, so the
// user actually sees the spinner before the next await blocks the event loop.
//
// Lives in its own file so any component can use it without pulling in the
// rest of component_chatgpt.js.
// -----------------------------------------------------------------------------

function yieldFrame() { return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); }
