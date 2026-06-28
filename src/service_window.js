// -----------------------------------------------------------------------------
// service_window.js — generic floating-window mechanics. No knowledge of
// `windowMode`, tabs, or any editor-specific content. Functions are
// parameter-driven so they can support any future ServiceWindow instance.
//
// Step A: skeleton class + parameter-pure utilities only. Steps B–D
// will populate the class with .create(), .registerTab(), .registerAction(),
// and migrate `windowMode` / `previousBounds` to instance state.
// -----------------------------------------------------------------------------

class ServiceWindow {

    /* ---- Static app registry ----
       Each window registers itself by app name + a launcher function.
       framework_system_restore.js iterates this list at boot time to
       re-open windows that were visible on the last session. */
    static _apps = [];

    static registerApp(appName, launchFn) {
        ServiceWindow._apps.push({ appName, launchFn });
    }

    static _stateKey(appName) {
        return "tm_window_" + appName;
    }

    constructor() {
        this.appName         = null;
        this.container       = null;
        this.headerEl        = null;
        this.tabBarEl        = null;
        this.actionBarEl     = null;
        this.minBtn          = null;
        this.maxBtn          = null;
        this.closeBtn        = null;
        this.resizeHandle    = null;
        this.mode            = "normal";   // "normal" | "maximized" | "minimized"
        this.previousBounds  = null;
        this.visible         = false;
        this.titleEl         = null;
        this._tabs           = [];   // [{ id, button }]
        this._activeTabId    = null;
        this._lastActiveAt   = 0;    // timestamp set on each _markActive call
        this._shell          = null; // shell object for programmatic API
        this._minAnimTimer   = null; // in-flight minimize/restore animation timer
    }

    /* Build container + header + min/max/close + drag wiring + resize handle.

       opts:
         appName             — REQUIRED. Used to form the localStorage key
                               "tm_window_<appName>" for persisted geometry,
                               mode, and visibility. Two windows must not
                               share an appName.
         width, height       — initial size (defaults 500/350).
         title               — optional string. If provided, a title label is
                               appended to the tab bar slot (useful for minimal
                               apps that don't have real tabs).
         isDraggable()       — gate for drag start.
         isResizable()       — gate for resize start.
         onDragEnd()         — called after drag mouseup (in addition to
                               automatic state persistence).
         onResizeEnd()       — called after resize mouseup (in addition to
                               automatic state persistence).
         minWidth, minHeight — resize floor (defaults 300/150). */
    create(opts) {

        opts = opts || {};

        if (!opts.appName) {
            throw new Error("ServiceWindow.create: opts.appName is required");
        }
        this.appName = opts.appName;
        this._shell  = opts.shell || null;

        const width  = opts.width  || 500;
        const height = opts.height || 350;

        /* Container */
        this.container = document.createElement("div");
        Object.assign(this.container.style, {
            position: "fixed",
            width:  width  + "px",
            height: height + "px",
            background: "#1e1e1e",
            border: "1px solid #333",
            borderRadius: "0",
            zIndex: "999999",
            display: "none",
            flexDirection: "column",
            boxShadow: "0 10px 30px rgba(0,0,0,.5)",
            overflow: "hidden"
        });

        /* Header */
        this.headerEl = document.createElement("div");
        Object.assign(this.headerEl.style, {
            height: "36px",
            flexShrink: "0",
            background: "#2a2a2a",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 10px",
            cursor: "move",
            fontSize: "13px"
        });

        this.container.appendChild(this.headerEl);
        document.body.appendChild(this.container);

        /* Register so static _repaintBorders() can find every live instance
           when the active window changes. */
        ServiceWindow._instances.push(this);

        /* Mark this window active on any mousedown inside it. Capture phase
           so we observe even clicks that get e.stopPropagation'd by inner
           controls. */
        this.container.addEventListener("mousedown", () => this._markActive(), true);

        /* Tab bar (left side of header) — registerTab() appends buttons here. */
        this.tabBarEl = document.createElement("div");
        this.tabBarEl.className = "tm-tab-bar";
        Object.assign(this.tabBarEl.style, {
            display: "flex",
            gap: "0",
            flexShrink: "0"
        });
        this.headerEl.appendChild(this.tabBarEl);

        /* Optional title label — appended to the tab bar slot. Convenient for
           minimal apps that don't register any real tabs. */
        if (opts.title) {
            const titleEl = document.createElement("div");
            titleEl.textContent = opts.title;
            Object.assign(titleEl.style, {
                color: "white",
                fontSize: "12px",
                padding: "4px 10px"
            });
            this.tabBarEl.appendChild(titleEl);
            this.titleEl = titleEl;
        }

        /* Action bar (sits next to tab bar) — registerAction() appends here. */
        this.actionBarEl = document.createElement("div");
        this.actionBarEl.className = "tm-action-btns";
        Object.assign(this.actionBarEl.style, {
            display: "flex",
            gap: "4px",
            marginLeft: "10px",
            alignItems: "center"
        });
        this.headerEl.appendChild(this.actionBarEl);

        /* Drag — wrap caller's onDragEnd with auto-persist. */
        const userDragEnd = opts.onDragEnd || (() => {});
        service_window_make_draggable(this.container, this.headerEl, {
            isDraggable: opts.isDraggable,
            onDragEnd:   () => { userDragEnd(); this.persistState(); }
        });

        /* Resize handle — wrap caller's onResizeEnd with auto-persist. */
        const userResizeEnd = opts.onResizeEnd || (() => {});
        this.resizeHandle = service_window_create_resize_handle(this.container, {
            isResizable: opts.isResizable,
            onResizeEnd: () => { userResizeEnd(); this.persistState(); },
            minWidth:    opts.minWidth,
            minHeight:   opts.minHeight
        });

        /* Window control buttons (min / max / close) — onclick wired by caller.
           These are NOT appended yet; caller calls .appendControls() after it
           has populated the rest of the header so they end up last. */
        const controls = document.createElement("div");
        this._controlsEl = controls;

        this.minBtn   = document.createElement("button"); this.minBtn.textContent   = "—";
        this.maxBtn   = document.createElement("button"); this.maxBtn.textContent   = "□";
        this.closeBtn = document.createElement("button"); this.closeBtn.textContent = "×";

        [this.minBtn, this.maxBtn, this.closeBtn].forEach(btn => {
            Object.assign(btn.style, {
                marginLeft: "6px",
                background: "#444",
                color: "white",
                border: "none",
                width: "24px",
                height: "24px",
                cursor: "pointer"
            });
            controls.appendChild(btn);
        });

        /* Default min/max/close behaviour. Minimal apps (e.g. component_calc)
           get sensible defaults out-of-the-box and don't need to wire anything.
           Apps with extra concerns (e.g. component_window's tab content
           visibility + column layout) can either:
             - replace the onclick entirely (legacy pattern), or
             - call this.defaultMinimize() / .defaultMaximize() / .defaultClose()
               from their own handler and add extras around it. */
        this.minBtn.onclick   = () => this.defaultMinimize();
        this.maxBtn.onclick   = () => this.defaultMaximize();
        this.closeBtn.onclick = () => this.defaultClose();

        /* ---- Tray-mode wiring ----
           Two entry shapes:
             - opts.tray === true: register a brand-new tray icon now.
             - opts.trayButton: adopt an existing tray button (typically
               registered at init time so the icon shows up before the
               window is lazily created).
           Either way, click toggles the window: if hidden/minimized, show +
           snap above tray; if visible, hide. Outside-click anywhere not in
           the window or tray button hides the window. defaultClose is
           patched so closing also removes the tray icon. */
        if (opts.trayButton) {
            this._adoptTrayButton(opts.trayButton, opts.trayHandle || null);
        } else if (opts.tray) {
            this._installTrayMode({
                icon:  opts.trayIcon  || (opts.appName || "?").charAt(0).toUpperCase(),
                title: opts.trayTitle || opts.appName
            });
        }

        return this;
    }

    _installTrayMode(opts) {

        const handle = framework_taskbar_register_tray_icon({
            icon:    opts.icon,
            title:   opts.title,
            onClick: (btn) => this._toggleFromTray(btn)
        });
        if (!handle) return;
        this._adoptTrayButton(handle.button, handle);
    }

    /* Wire an existing tray button (e.g. one registered at init time before
       the window was lazily created) to this window. Replaces the button's
       onClick with our toggle, installs the outside-click hider, builds the
       tail, and patches defaultClose/hide to clean up. */
    _adoptTrayButton(btn, handle) {

        /* Re-adoption: when the registry hides+re-shows an app's tray icon,
           the DOM node changes. Update the live reference and re-wire the
           click handler, but don't re-install the one-time tail/outside-
           click/hide/close patches. */
        if (this._trayAdopted) {
            this._trayBtn = btn;
            this._trayHandle = handle || {
                button: btn,
                remove() { if (btn.parentElement) btn.parentElement.removeChild(btn); }
            };
            btn.onclick = (e) => {
                e.stopPropagation();
                this._toggleFromTray(btn);
            };
            return;
        }
        this._trayAdopted = true;
        this._trayBtn     = btn;

        this._trayHandle = handle || {
            button: btn,
            remove() { if (btn.parentElement) btn.parentElement.removeChild(btn); }
        };

        btn.onclick = (e) => {
            e.stopPropagation();
            this._toggleFromTray(this._trayBtn);
        };

        /* Tray apps don't need min/max — they're toggled by the tray icon
           and naturally close via outside-click. Hide the buttons but leave
           them in the DOM so any code referencing this.minBtn / this.maxBtn
           doesn't crash. */
        if (this.minBtn) this.minBtn.style.display = "none";
        if (this.maxBtn) this.maxBtn.style.display = "none";

        /* Hide the tail as soon as the user starts dragging the window —
           the tail is anchored to the tray, so once the window moves the
           anchor visualisation is wrong (and the half-tail that was
           hidden behind the window's bottom edge would otherwise
           reappear as a rhombus). Mirrors XP "tear off the balloon"
           UX. */
        if (this.headerEl) {
            this.headerEl.addEventListener("mousedown", () => {
                if (this._trayTailEl) this._trayTailEl.style.display = "none";
            });
        }

        /* Build the tail decoration once. Absolutely positioned inside the
           container, anchored to its bottom edge, pointing down toward the
           tray icon. The tail is a 14px square rotated 45deg with the same
           background as the container; only its bottom-right edge shows
           below the container, forming a triangle. The container's
           overflow:hidden would clip the tail, so we put the tail in a
           sibling element that's positioned relative to the container at
           show-time. */
        const tail = document.createElement("div");
        Object.assign(tail.style, {
            position: "fixed",
            width: "14px",
            height: "14px",
            background: "#1e1e1e",
            border: "1px solid #333",
            borderTop: "none",
            borderLeft: "none",
            transform: "rotate(45deg)",
            transformOrigin: "center",
            zIndex: "999998",
            display: "none",
            pointerEvents: "none"
        });
        document.body.appendChild(tail);
        this._trayTailEl = tail;

        /* Outside-click hide. Capture phase + checking the original target
           so we observe clicks before any inner stopPropagation can swallow
           them. We must NOT hide if the click landed inside this window's
           container, the tray button, or the tail itself. Per the user's
           choice (strict), clicks on other ServiceWindows DO hide this one. */
        this._trayOutsideHandler = (e) => {
            if (!this.visible) return;
            if (this.mode === "minimized") return;
            if (this.container && this.container.contains(e.target)) return;
            if (this._trayBtn && this._trayBtn.contains(e.target)) return;
            if (tail.contains(e.target)) return;
            this.hide();
        };
        document.addEventListener("mousedown", this._trayOutsideHandler, true);

        /* Patch defaultClose to also hide the tail. The tray icon itself
           PERSISTS — it's how the user re-launches the app. The icon is
           only removed if/when the entire app tears down (not currently
           wired). hide() already runs inside defaultClose via this.hide(). */
        const origClose = this.defaultClose.bind(this);
        this.defaultClose = () => {
            origClose();
            if (this._trayTailEl) this._trayTailEl.style.display = "none";
        };

        /* Patch hide() to also hide the tail. show() positioning happens via
           _toggleFromTray, which paints the tail; if the user calls show()
           directly (e.g. system_restore), we still re-snap to the tray. */
        const origHide = this.hide.bind(this);
        this.hide = () => {
            origHide();
            if (this._trayTailEl) this._trayTailEl.style.display = "none";
        };
    }

    /* Snap the window above the tray button and show it. Always re-snaps
       (per user's choice) — any drag is forgotten on next tray click. */
    _toggleFromTray(btn) {

        /* Hide every OTHER visible tray-mode window first. With mouse clicks
           the outside-click handler takes care of this, but keyboard shortcuts
           (Ctrl+1..9) don't fire mousedown so we must do it explicitly. */
        for (const sw of ServiceWindow._instances) {
            if (sw === this) continue;
            if (sw._trayAdopted && sw.visible && sw.mode !== "minimized") {
                sw.hide();
            }
        }

        if (this.visible && this.mode !== "minimized") {
            this.hide();
            return;
        }

        /* Show first so offsetWidth/Height are valid for the snap math.
           Animation plays from the fixed bottom-center origin (taskbar). */
        this.show();

        if (this.mode === "maximized") return;   // maximized fills viewport; no snap
        if (this.mode === "minimized") return;   // header-only strip; no snap

        /* If no tray button is currently attached (icon hidden via registry),
           skip the snap+tail and just leave the window where the user last
           dragged it / where restoreState put it. */
        if (!btn) {
            if (this._trayTailEl) this._trayTailEl.style.display = "none";
            this.persistState();
            return;
        }

        const r = btn.getBoundingClientRect();
        const cw = this.container.offsetWidth;
        const ch = this.container.offsetHeight;
        const vw = window.innerWidth;

        /* Tail geometry. The tail is a `tailSide`-px square rotated 45°.
           After rotation its bounding diamond is `tailSide * √2` tall,
           so it extends `tailHalfDiag` px above AND below center. We
           want only the BOTTOM half visible (a downward triangle), so
           we place the tail's CSS center exactly at the window's bottom
           edge — the top half is then hidden behind the opaque window
           container, and the bottom half pokes down toward the tray. */
        const tailSide     = 14;
        const tailHalfDiag = Math.round(tailSide * Math.SQRT2 / 2);   // ~10
        /* Gap between the window's bottom edge and the tray button top.
           Needs room for the visible bottom half (`tailHalfDiag`) plus
           a few px of breathing room. */
        const tailGap = tailHalfDiag + 6;

        let left = Math.round(r.left + r.width / 2 - cw / 2);
        left = Math.max(8, Math.min(left, vw - cw - 8));

        /* Window bottom sits `tailGap` px above the tray-button top so the
           full rotated tail fits cleanly in the gap. */
        let top = Math.round(r.top - tailGap - ch);
        top = Math.max(8, top);

        this.container.style.left = left + "px";
        this.container.style.top  = top  + "px";

        /* Tail: anchored to the horizontal center of the tray button. We
           position it so the top of the visible diamond aligns with the
           window's bottom edge (tail appears to "grow out of" the window)
           and the tip points down at the tray icon. Hidden if the window
           had to clamp far enough that the tail center would no longer be
           horizontally under the window. */
        if (this._trayTailEl) {
            const tailCenterX  = Math.round(r.left + r.width / 2);
            const windowBottom = top + ch;
            /* Place the tail's CSS center exactly at the window's bottom
               edge. After rotation, only the bottom half of the diamond
               extends below the window — that's the visible triangle.
               The top half is occluded by the opaque window container. */
            const tailCenterY  = windowBottom;
            const tailLeft = tailCenterX - tailSide / 2;
            const tailTop  = tailCenterY - tailSide / 2;

            const tailWithinWindow =
                tailCenterX >= left + tailHalfDiag &&
                tailCenterX <= left + cw - tailHalfDiag;

            if (tailWithinWindow) {
                this._trayTailEl.style.width  = tailSide + "px";
                this._trayTailEl.style.height = tailSide + "px";
                this._trayTailEl.style.left = tailLeft + "px";
                this._trayTailEl.style.top  = tailTop  + "px";
                this._trayTailEl.style.display = "block";
            } else {
                this._trayTailEl.style.display = "none";
            }
        }

        this.persistState();

        /* Auto-focus the first text input inside the window so the user can
           start typing immediately after a tray click / Ctrl+1..9 launch.
           rAF lets layout settle (the snap above just changed left/top) so
           focus() doesn't trigger a scroll-into-view glitch on the page
           underneath. Skip if focus already landed inside the window
           between show() and this rAF tick. */
        requestAnimationFrame(() => {
            if (!this.visible || !this.container) return;
            const ae = document.activeElement;
            if (ae && ae !== document.body && this.container.contains(ae)) return;
            this._focusFirstInput();
        });
    }

    /* Find and focus the first visible input/textarea/contenteditable inside
       the container. Selects existing text on <input type=text|number> and
       <textarea> so the user can overwrite immediately. Used by tray-mode
       openers (_toggleFromTray); safe to call any time. */
    _focusFirstInput() {
        if (!this.container) return;
        const sel = "input:not([type=hidden]):not([disabled]):not([readonly])," +
                    "textarea:not([disabled]):not([readonly])," +
                    "[contenteditable=\"true\"]";
        const candidates = this.container.querySelectorAll(sel);
        for (const el of candidates) {
            if (el.offsetParent === null) continue;   // hidden subtree
            try {
                el.focus({ preventScroll: true });
                if (typeof el.select === "function" &&
                    (el.tagName === "TEXTAREA" ||
                     (el.tagName === "INPUT" &&
                      /^(text|number|search|email|url|tel|password)$/i.test(el.type)))) {
                    el.select();
                }
            } catch (e) {}
            return;
        }
    }

    /* ---- Active window tracking ----
       The "active" window is the most recently shown or interacted-with
       ServiceWindow. Hotkey handlers (e.g. Alt+Q to close) read this so
       there's a clear target when the user has multiple windows open.
       _instances is an internal registry so _markActive can repaint every
       window's border on each focus change. */
    static _active = null;
    static _instances = [];
    /* Monotonic z-index counter. Bumped on every _markActive so the most
       recently focused window always paints on top. Starts at the original
       fixed z-index used for windows so we stay below the taskbar (which
       sits at 1000000+). The counter is unbounded but practically can't
       overflow within a session. */
    static _zCounter = 999999;

    static activeWindow() {
        return ServiceWindow._active;
    }

    _markActive() {
        ServiceWindow._active = this;
        this._lastActiveAt = Date.now();
        if (this.container) {
            ServiceWindow._zCounter++;
            this.container.style.zIndex = String(ServiceWindow._zCounter);
        }
        ServiceWindow._repaintBorders();
    }

    static _repaintBorders() {
        for (const w of ServiceWindow._instances) {
            if (!w.container) continue;
            /* Maximised windows reach to the viewport edges — a 1px cyan
               accent there reads as a stray line, not as focus. Tray-mode
               windows are popups, not persistent app windows, so the cyan
               focus border reads as noise on them too. Cyan only paints on
               active, not-maximised, non-tray windows. */
            const isActive =
                (w === ServiceWindow._active) &&
                (w.mode !== "maximized") &&
                !w._trayHandle;
            w.container.style.borderColor = isActive ? "#4fc3f7" : "#333";
        }
    }

    /* ---- Open/close animations ----
       Scale + fade from a fixed bottom-center origin (taskbar area). Fast
       (120ms open, 100ms close) so frequent launcher / Ctrl+1..9 use never
       feels sluggish. Honours `prefers-reduced-motion` by skipping entirely.
       The transform / transformOrigin / opacity are cleared after the
       animation so drag/resize/inspection see a clean container. */

    static _ANIM_OPEN_MS   = 120;
    static _ANIM_CLOSE_MS  = 100;
    static _ANIM_ORIGIN    = "50% 100%";   // bottom-center of container

    static _reducedMotion() {
        try {
            return window.matchMedia &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        } catch (e) { return false; }
    }

    _playOpenAnim() {
        if (!this.container) return;
        if (ServiceWindow._reducedMotion()) return;

        /* Cancel any in-flight close animation first. */
        if (this._animTimer) { clearTimeout(this._animTimer); this._animTimer = null; }

        const c = this.container;
        const dur = ServiceWindow._ANIM_OPEN_MS;
        c.style.transformOrigin = ServiceWindow._ANIM_ORIGIN;
        c.style.transition      = "none";
        c.style.transform       = "scale(0.85)";
        c.style.opacity         = "0";
        /* Force layout flush so the starting state is committed before we
           switch to the transitioned end state. */
        // eslint-disable-next-line no-unused-expressions
        c.offsetWidth;
        c.style.transition = "transform " + dur + "ms cubic-bezier(.2,.8,.2,1), opacity " + dur + "ms ease-out";
        c.style.transform  = "scale(1)";
        c.style.opacity    = "1";

        this._animTimer = setTimeout(() => {
            this._animTimer = null;
            if (!this.container) return;
            this.container.style.transition      = "";
            this.container.style.transform       = "";
            this.container.style.transformOrigin = "";
            this.container.style.opacity         = "";
        }, dur + 20);
    }

    _playCloseAnim(done) {
        if (!this.container) { if (done) done(); return; }
        if (ServiceWindow._reducedMotion()) { if (done) done(); return; }

        if (this._animTimer) { clearTimeout(this._animTimer); this._animTimer = null; }

        const c = this.container;
        const dur = ServiceWindow._ANIM_CLOSE_MS;
        c.style.transformOrigin = ServiceWindow._ANIM_ORIGIN;
        c.style.transition      = "transform " + dur + "ms ease-in, opacity " + dur + "ms ease-in";
        c.style.transform       = "scale(0.9)";
        c.style.opacity         = "0";

        this._animTimer = setTimeout(() => {
            this._animTimer = null;
            if (this.container) {
                this.container.style.transition      = "";
                this.container.style.transform       = "";
                this.container.style.transformOrigin = "";
                this.container.style.opacity         = "";
            }
            if (done) done();
        }, dur + 10);
    }

    /* ---- Show / hide (auto-persists visibility) ---- */

    show() {
        if (!this.container) return;
        const wasVisible = this.visible;
        this.container.style.display = "flex";
        this.visible = true;
        this._markActive();
        /* If the persisted position has drifted off-screen (e.g. browser was
           resized smaller while the window was closed), pull the window back
           to the centre of the viewport. Maximised windows are always
           full-viewport, so they're exempt. */
        if (this.mode !== "maximized") {
            this._ensureOnScreen();
        }
        this.persistState();

        /* Open animation. Skipped if the window was already visible
           (e.g. show() called twice during a maximize transition). */
        if (!wasVisible) {
            this._playOpenAnim();
        }
    }

    /* Recenter the window if its current bounds aren't fully inside the
       viewport. Uses the live offsetWidth/Height (post-layout) rather than
       the inline style so percentages and "100vw" resolve correctly. */
    _ensureOnScreen() {
        const w = this.container.offsetWidth;
        const h = this.container.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const left = parseInt(this.container.style.left, 10);
        const top  = parseInt(this.container.style.top,  10);

        const offscreen =
            isNaN(left) || isNaN(top) ||
            left < 0 || top < 0 ||
            left + w > vw || top + h > vh;

        if (offscreen) {
            const newLeft = Math.max(0, (vw - w) / 2);
            const newTop  = Math.max(0, (vh - h) / 2);
            this.container.style.left = newLeft + "px";
            this.container.style.top  = newTop  + "px";
        }
    }

    hide() {
        if (!this.container) return;
        const wasVisible = this.visible;
        this.visible = false;

        if (wasVisible) {
            this._playCloseAnim(() => {
                /* Only actually hide if nobody re-showed the window during
                   the brief animation. */
                if (!this.visible && this.container) {
                    this.container.style.display = "none";
                }
            });
        } else {
            this.container.style.display = "none";
        }
        /* Promote the most-recently-interacted-with visible peer to active.
           Picking by max _lastActiveAt matches OS focus-fallback semantics:
           when you close the front window, the previously front-most one
           returns to focus, not an arbitrary other. If nothing is visible
           any more, _active clears. */
        if (ServiceWindow._active === this) {
            const next = ServiceWindow._pickPromotion(this);
            if (next) {
                next._markActive();   // sets _active + repaints
            } else {
                ServiceWindow._active = null;
                ServiceWindow._repaintBorders();
            }
        }
        this.persistState();
    }

    /* Choose which visible peer (excluding `closing`) should become active
       after `closing` is hidden. Returns null when no eligible peer exists. */
    static _pickPromotion(closing) {
        let best = null;
        let bestAt = -1;
        for (const w of ServiceWindow._instances) {
            if (w === closing) continue;
            if (!w.visible) continue;
            if (!w.container) continue;
            if (w._lastActiveAt > bestAt) {
                best = w;
                bestAt = w._lastActiveAt;
            }
        }
        return best;
    }

    /* ---- Default window-control behaviours ---- */

    defaultClose() {
        this.hide();
    }

    defaultMaximize() {

        if (!this.container) return;

        if (this.mode !== "maximized") {

            this.previousBounds = {
                left:   this.container.style.left,
                top:    this.container.style.top,
                width:  this.container.style.width,
                height: this.container.style.height
            };

            this.container.style.left   = "0";
            this.container.style.top    = "0";
            this.container.style.width  = "100vw";
            this.container.style.height = "100vh";

            if (this.resizeHandle) this.resizeHandle.style.display = "none";
            this.mode = "maximized";
        }
        else {

            if (this.previousBounds) {
                this.container.style.left   = this.previousBounds.left;
                this.container.style.top    = this.previousBounds.top;
                this.container.style.width  = this.previousBounds.width;
                this.container.style.height = this.previousBounds.height;
            }

            if (this.resizeHandle) this.resizeHandle.style.display = "block";
            this.mode = "normal";
        }

        ServiceWindow._repaintBorders();
        this.persistState();
    }

    defaultMinimize(done) {

        if (!this.container) return;

        if (this.mode !== "minimized") {

            this.previousBounds = {
                left:   this.container.style.left,
                top:    this.container.style.top,
                width:  this.container.style.width,
                height: this.container.style.height
            };

            if (this.resizeHandle) this.resizeHandle.style.display = "none";
            this.mode = "minimized";
            ServiceWindow._repaintBorders();

            this._playHeightAnim("36px", () => {
                this.persistState();
                if (done) done();
            });
        }
        else {

            const targetHeight = this.previousBounds ? this.previousBounds.height : "350px";

            if (this.previousBounds) {
                this.container.style.left   = this.previousBounds.left;
                this.container.style.top    = this.previousBounds.top;
                this.container.style.width  = this.previousBounds.width;
            }

            this.container.style.height = targetHeight;
            if (this.resizeHandle) this.resizeHandle.style.display = "block";
            this.mode = "normal";
            ServiceWindow._repaintBorders();
            this.persistState();
            if (done) done();
        }
    }

    /* Animate container height to targetHeight over 150ms.
       Lock in the current height synchronously, then use a rAF + forced
       reflow (void offsetHeight) to ensure the browser commits the "from"
       state before the transition starts — same approach as _playOpenAnim.
       Cancels any in-flight height animation before starting. */
    _playHeightAnim(targetHeight, done) {

        if (this._minAnimTimer) {
            clearTimeout(this._minAnimTimer);
            this._minAnimTimer = null;
            if (this.container) this.container.style.transition = "";
        }

        if (!this.container || ServiceWindow._reducedMotion()) {
            if (this.container) this.container.style.height = targetHeight;
            if (done) done();
            return;
        }

        const dur = 150;
        const c   = this.container;

        /* Lock in current height and clear any stale transition synchronously
           so the browser has a clean "from" state before the rAF fires. */
        const fromHeight = c.style.height || (c.offsetHeight + "px");
        c.style.transition = "none";
        c.style.height     = fromHeight;

        requestAnimationFrame(() => {
            if (!c) return;
            void c.offsetHeight;   // force layout flush — commits fromHeight
            c.style.transition = "height " + dur + "ms ease";
            c.style.height     = targetHeight;

            this._minAnimTimer = setTimeout(() => {
                this._minAnimTimer = null;
                if (this.container) this.container.style.transition = "";
                if (done) done();
            }, dur + 10);
        });
    }

    /* ---- State persistence ----
       Event-driven, not periodic. Called automatically after drag end,
       resize end, min/max/close, and show/hide. Components that mutate
       window geometry directly (e.g. component_window's column-layout
       transitions) should call .persistState() at the end of their handler. */

    persistState() {
        if (!this.appName || !this.container) return;
        const key = ServiceWindow._stateKey(this.appName);

        /* Tray-mode windows snap above the tray icon on every show, so
           persisting geometry is pointless. They also should not auto-restore
           on page load, so skip the visible flag entirely. */
        if (this._trayAdopted) return;

        const state = {
            left:           this.container.style.left,
            top:            this.container.style.top,
            width:          this.container.style.width,
            height:         this.container.style.height,
            mode:           this.mode,
            previousBounds: this.previousBounds,
            visible:        this.visible
        };
        try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {}
    }

    /* Restore geometry + mode + previousBounds + visible flag from
       localStorage. Returns the parsed state object (or null if none).
       Does NOT call .show() — caller decides whether to re-open the window
       based on state.visible (typically driven by framework_system_restore). */
    restoreState() {
        if (!this.appName || !this.container) return null;
        if (this._trayAdopted) return null;

        const key = ServiceWindow._stateKey(this.appName);
        let state;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            state = JSON.parse(raw);
        } catch (e) { return null; }

        if (state.left)   this.container.style.left   = state.left;
        if (state.top)    this.container.style.top    = state.top;
        if (state.width)  this.container.style.width  = state.width;
        if (state.height) this.container.style.height = state.height;

        this.mode           = state.mode || "normal";
        this.previousBounds = state.previousBounds || null;
        this.visible        = !!state.visible;

        if (this.mode === "maximized") {
            this.container.style.left   = "0";
            this.container.style.top    = "0";
            this.container.style.width  = "100vw";
            this.container.style.height = "100vh";
            if (this.resizeHandle) this.resizeHandle.style.display = "none";
        } else if (this.mode === "minimized") {
            this.container.style.height = "36px";
            if (this.resizeHandle) this.resizeHandle.style.display = "none";
        }

        return state;
    }

    /* Caller invokes this after appending its own header content so the
       min/max/close cluster ends up at the right edge of the header. */
    appendControls() {
        this.headerEl.appendChild(this._controlsEl);
        if (this._shell) this._buildShellAPI();
    }

    /* Re-scan [data-shell] elements and rebuild the shell namespace.
       Call after dynamically adding new data-shell elements. */
    refreshShellAPI() {
        if (this._shell) this._buildShellAPI();
    }

    /* Walk this.container for [data-shell] elements and generate
       getter/setter/action methods on shell.<appName>. */
    _buildShellAPI() {
        const self = this;
        const ns = {};

        /* Utility: "operand1" → "Operand1" for method name suffixes */
        function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

        this.container.querySelectorAll("[data-shell]").forEach(function (el) {
            const name = el.dataset.shell;
            const tag  = el.tagName.toLowerCase();
            const type = (el.type || "").toLowerCase();

            if (tag === "input" && type === "checkbox") {
                ns["is" + cap(name)]  = function ()  { return el.checked; };
                ns["set" + cap(name)] = function (v) { el.checked = !!v; };
            } else if (tag === "input" || tag === "textarea") {
                ns["get" + cap(name)] = function ()  { return el.value; };
                ns["set" + cap(name)] = function (v) { el.value = v; };
            } else if (tag === "select") {
                ns["get" + cap(name)] = function ()  { return el.value; };
                ns["set" + cap(name)] = function (v) { el.value = v; };
            } else if (tag === "button") {
                ns["click" + cap(name)] = function () { el.click(); };
            } else {
                /* div, span, label, or any other element — read-only text */
                ns["get" + cap(name)] = function () { return el.textContent; };
            }
        });

        /* Window-level helpers */
        ns.show      = function () { self.show(); };
        ns.hide      = function () { self.hide(); };
        ns.isVisible = function () { return self.visible; };

        this._shell[this.appName] = ns;
    }

    /* Create a body <div> below the header, append it to the container,
       and return it. Convenient for minimal apps so they don't have to
       hand-roll a flex-column wrapper.

       opts (all optional):
         padding   — default "12px"
         gap       — default "8px"
         color     — default "white"
         fontSize  — default "13px"
         direction — "column" (default) | "row"
         style     — additional Object.assign overrides applied last */
    createBody(opts) {

        opts = opts || {};
        const body = document.createElement("div");

        Object.assign(body.style, {
            flex: "1",
            display: "flex",
            flexDirection: opts.direction || "column",
            gap:       opts.gap      || "8px",
            padding:   opts.padding  || "12px",
            color:     opts.color    || "white",
            fontSize:  opts.fontSize || "13px",
            overflow: "auto"
        });

        if (opts.style) Object.assign(body.style, opts.style);

        this.container.appendChild(body);
        this.bodyEl = body;
        return body;
    }

    /* Create a styled label <div>. Caller updates .textContent later to
       reflect dynamic state.
       shellName — optional data-shell key for the shell API. */
    createLabel(text, shellName) {

        const el = document.createElement("div");
        el.textContent = text || "";
        if (shellName) el.dataset.shell = shellName;

        Object.assign(el.style, {
            marginTop: "4px",
            color: "#ddd",
            fontSize: "13px"
        });

        return el;
    }

    /* Create a styled <input type="text"> textbox. Caller sets .type /
       .value / .onchange / extra attributes after construction.
       shellName — optional data-shell key for the shell API. */
    createTextbox(placeholder, shellName) {

        const input = document.createElement("input");
        input.type = "text";
        if (placeholder) input.placeholder = placeholder;
        if (shellName) input.dataset.shell = shellName;

        Object.assign(input.style, {
            background: "#2a2a2a",
            color: "white",
            border: "1px solid #444",
            borderRadius: "4px",
            padding: "4px 6px",
            fontSize: "13px",
            width: "100%",
            boxSizing: "border-box"
        });

        return input;
    }

    /* Create a primary action button (filled, accent-coloured). Caller wires
       .onclick / .title / extra styles after construction.
       shellName — optional data-shell key for the shell API. */
    createPrimaryButton(label, shellName) {

        const btn = document.createElement("button");
        btn.textContent = label || "OK";
        if (shellName) btn.dataset.shell = shellName;

        Object.assign(btn.style, {
            background: "#4fc3f7",
            color: "#000",
            border: "none",
            borderRadius: "4px",
            padding: "6px 10px",
            cursor: "pointer",
            fontWeight: "bold"
        });

        return btn;
    }

    /* Create a checkbox wrapper: <div> containing <input type="checkbox"> +
       <span> label. The checkbox input is stored as wrapper.checkbox for
       programmatic access.
       shellName — optional data-shell key for the shell API. */
    createCheckbox(label, shellName) {

        const wrapper = document.createElement("div");
        Object.assign(wrapper.style, {
            display: "flex",
            alignItems: "center",
            gap: "6px"
        });

        const cb = document.createElement("input");
        cb.type = "checkbox";
        if (shellName) cb.dataset.shell = shellName;

        const span = document.createElement("span");
        span.textContent = label || "";
        Object.assign(span.style, { color: "#ddd", fontSize: "13px" });

        wrapper.appendChild(cb);
        wrapper.appendChild(span);
        wrapper.checkbox = cb;

        return wrapper;
    }

    /* Create a styled <select> element. `options` is an array of
       {value, label} objects or plain strings.
       shellName — optional data-shell key for the shell API. */
    createSelect(options, shellName) {

        const sel = document.createElement("select");
        if (shellName) sel.dataset.shell = shellName;

        (options || []).forEach(function (opt) {
            const o = document.createElement("option");
            if (typeof opt === "string") {
                o.value = opt;
                o.textContent = opt;
            } else {
                o.value = opt.value;
                o.textContent = opt.label || opt.value;
            }
            sel.appendChild(o);
        });

        Object.assign(sel.style, {
            background: "#2a2a2a",
            color: "white",
            border: "1px solid #444",
            borderRadius: "4px",
            padding: "4px 6px",
            fontSize: "13px"
        });

        return sel;
    }

    /* Register a tab. Adds a styled button to .tabBarEl that, when clicked,
       calls opts.onClick(opts.id). The first registered tab is auto-styled
       as active.

       This is a UI-construction helper. It does NOT manage tab content
       visibility — that stays with the caller's switchTab() / onClick. Use
       setActiveTabHighlight(id) to update the button styling after a switch.

       opts:
         id     — string identifier passed back via onClick.
         label  — button text.
         title  — tooltip (e.g., "Alt+1").
         onClick(id) — invoked on button click. */
    registerTab(opts) {

        const btn = document.createElement("button");
        btn.textContent = opts.label;
        if (opts.title) btn.title = opts.title;

        Object.assign(btn.style, {
            background: "transparent",
            color: "#999",
            border: "none",
            borderBottom: "2px solid transparent",
            padding: "4px 10px",
            cursor: "pointer",
            fontSize: "12px",
            fontFamily: "inherit"
        });

        const tab = { id: opts.id, button: btn };

        btn.onclick = (e) => {
            e.stopPropagation();
            if (opts.onClick) opts.onClick(opts.id);
        };

        this.tabBarEl.appendChild(btn);
        this._tabs.push(tab);

        if (this._activeTabId === null) {
            this._activeTabId = opts.id;
            btn.style.color = "white";
            btn.style.borderBottomColor = "#4fc3f7";
        }

        return btn;
    }

    /* Update tab-button highlighting to mark `id` as the active tab.
       Caller (switchTab) invokes this after a successful tab change. */
    setActiveTabHighlight(id) {
        this._activeTabId = id;
        for (const t of this._tabs) {
            const isActive = (t.id === id);
            t.button.style.color = isActive ? "white" : "#999";
            t.button.style.borderBottomColor = isActive ? "#4fc3f7" : "transparent";
        }
    }

    activeTabId() {
        return this._activeTabId;
    }

    /* Register an action button (sits next to the tab bar in the header).
       opts: { label, title, onClick, html, style }
         - pass `html` (e.g. an SVG) instead of `label` for icon buttons.
         - `style` is an Object.assign spread; defaults to the standard pill. */
    registerAction(opts) {

        const btn = document.createElement("button");

        if (opts.html) {
            btn.innerHTML = opts.html;
        } else {
            btn.textContent = opts.label;
        }
        if (opts.title) btn.title = opts.title;

        Object.assign(btn.style, opts.style || {
            background: "#555",
            color: "white",
            border: "none",
            borderRadius: "3px",
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: "11px"
        });

        btn.onclick = (e) => {
            e.stopPropagation();
            if (opts.onClick) opts.onClick();
        };

        this.actionBarEl.appendChild(btn);
        return btn;
    }
}

/* ---- Drag ----
   Mouse + touch. The header element gets `touch-action: none` so the
   browser doesn't claim the gesture for scrolling/panning — without that,
   touchmove only fires once before the browser takes over. touchmove +
   touchstart listeners are registered with { passive: false } so we can
   call preventDefault() and keep the page from scrolling under the finger
   while the title bar is being dragged. */

/* ---- Iframe pointer-event suppression during drag/resize ---- */
/* Iframes capture mousemove events, breaking drag/resize on the parent
   document. During any drag or resize operation we disable pointer events
   on ALL iframes so the parent's mousemove handler sees every event. */

function _sw_disable_iframes() {
    document.querySelectorAll("iframe").forEach(f => {
        f._sw_saved_pe = f.style.pointerEvents;
        f.style.pointerEvents = "none";
    });
}
function _sw_enable_iframes() {
    document.querySelectorAll("iframe").forEach(f => {
        f.style.pointerEvents = f._sw_saved_pe || "";
        delete f._sw_saved_pe;
    });
}

/* ---- Dragging ---- */

function service_window_make_draggable(element, handle, opts) {

    const isDraggable = (opts && opts.isDraggable) || (() => true);
    const onDragEnd   = (opts && opts.onDragEnd)   || (() => {});

    handle.style.touchAction = "none";

    let isDown = false;
    let offsetX = 0, offsetY = 0;

    const start = (clientX, clientY) => {
        if (!isDraggable()) return false;
        isDown = true;
        offsetX = clientX - element.offsetLeft;
        offsetY = clientY - element.offsetTop;
        return true;
    };
    const move = (clientX, clientY) => {
        if (!isDown || !isDraggable()) return;
        element.style.left = (clientX - offsetX) + "px";
        element.style.top  = (clientY - offsetY) + "px";
    };
    const end = () => {
        if (isDown) onDragEnd();
        isDown = false;
    };

    /* Mouse */
    handle.addEventListener("mousedown", (e) => {
        if (start(e.clientX, e.clientY)) _sw_disable_iframes();
    });
    document.addEventListener("mousemove", (e) => {
        move(e.clientX, e.clientY);
    });
    document.addEventListener("mouseup", () => {
        _sw_enable_iframes();
        end();
    });

    /* Touch — touchstart and touchmove are non-passive so preventDefault
       can suppress the page-level scroll/pan that would otherwise eat the
       drag. touchcancel mirrors touchend so a system-interrupted drag
       doesn't leave isDown stuck true.

       Skip the drag entirely when the touch target is a <button> inside
       the header (min/max/close, tab buttons, action buttons). Calling
       preventDefault on such touches would suppress the synthetic click
       the browser fires, breaking taps. The buttons themselves keep
       default touch-action so their tap → click synthesis still works. */
    handle.addEventListener("touchstart", (e) => {
        if (e.target && e.target.closest && e.target.closest("button")) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        if (start(t.clientX, t.clientY)) { _sw_disable_iframes(); e.preventDefault(); }
    }, { passive: false });

    document.addEventListener("touchmove", (e) => {
        if (!isDown) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        move(t.clientX, t.clientY);
        e.preventDefault();
    }, { passive: false });

    document.addEventListener("touchend",    () => { _sw_enable_iframes(); end(); });
    document.addEventListener("touchcancel", () => { _sw_enable_iframes(); end(); });
}

/* ---- Resize handle ---- */

function service_window_create_resize_handle(container, opts) {

    const isResizable = (opts && opts.isResizable) || (() => true);
    const onResizeEnd = (opts && opts.onResizeEnd) || (() => {});
    const minWidth    = (opts && opts.minWidth)    || 300;
    const minHeight   = (opts && opts.minHeight)   || 150;

    const handle = document.createElement("div");

    Object.assign(handle.style, {
        position: "absolute",
        width: "14px",
        height: "14px",
        right: "0",
        bottom: "0",
        cursor: "nwse-resize"
    });

    container.appendChild(handle);

    let resizing = false;
    let startX, startY, startWidth, startHeight;

    handle.addEventListener("mousedown", (e) => {
        if (!isResizable()) return;
        resizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth  = container.offsetWidth;
        startHeight = container.offsetHeight;
        _sw_disable_iframes();
        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!resizing) return;
        const newWidth  = startWidth  + (e.clientX - startX);
        const newHeight = startHeight + (e.clientY - startY);
        container.style.width  = Math.max(minWidth,  newWidth)  + "px";
        container.style.height = Math.max(minHeight, newHeight) + "px";
    });

    document.addEventListener("mouseup", () => {
        if (resizing) { _sw_enable_iframes(); onResizeEnd(); }
        resizing = false;
    });

    return handle;
}

/* ---- Centering ---- */

function service_window_center(element, width, height) {
    element.style.left = (window.innerWidth  - width)  / 2 + "px";
    element.style.top  = (window.innerHeight - height) / 2 + "px";
}

/* ---- Geometry persistence ---- */

function service_window_persist_geometry(key, element, extras) {

    if (!element) return;

    const state = Object.assign({
        left:   element.style.left,
        top:    element.style.top,
        width:  element.style.width,
        height: element.style.height
    }, extras || {});

    localStorage.setItem(key, JSON.stringify(state));
}

function service_window_restore_geometry(key, element) {

    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const state = JSON.parse(raw);

    element.style.left   = state.left;
    element.style.top    = state.top;
    element.style.width  = state.width;
    element.style.height = state.height;

    return state;
}
