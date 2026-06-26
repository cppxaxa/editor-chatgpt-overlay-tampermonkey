// ===== framework_windowmanager.js =====
// Window-management utilities that operate on ServiceWindow instances.

/**
 * Ensure the window is fully within the visible viewport. If any edge is
 * off-screen, clamp left/top so the entire window is visible. Also caps
 * width/height to the viewport if the window is larger than the screen.
 */
function framework_windowmanager_ensure_in_viewport(sw) {
    if (!sw || !sw.container) return;
    const c = sw.container;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = parseInt(c.style.left, 10) || 0;
    let top  = parseInt(c.style.top, 10)  || 0;
    let w    = c.offsetWidth;
    let h    = c.offsetHeight;

    if (w > vw) { c.style.width  = vw + "px"; w = vw; }
    if (h > vh) { c.style.height = vh + "px"; h = vh; }

    if (left < 0)          left = 0;
    if (top  < 0)          top  = 0;
    if (left + w > vw)     left = vw - w;
    if (top  + h > vh)     top  = vh - h;

    c.style.left = left + "px";
    c.style.top  = top  + "px";

    sw.persistState();
}
