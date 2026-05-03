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

    constructor() {
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
        this._tabs           = [];   // [{ id, button }]
        this._activeTabId    = null;
    }

    /* Build container + header + min/max/close + drag wiring + resize handle.
       Does NOT wire min/max/close onclick handlers — those stay with the
       caller in Step B because they depend on editor-specific tab content
       state. The caller writes to .minBtn.onclick / .maxBtn.onclick /
       .closeBtn.onclick after .create() returns.

       Caller appends its own header content (tab bar, action buttons, etc.)
       directly into .headerEl. The min/max/close cluster is appended last so
       it stays on the right edge under `justify-content: space-between`.

       opts:
         width, height       — initial size (defaults 500/350).
         isDraggable()       — gate for drag start.
         isResizable()       — gate for resize start.
         onDragEnd()         — called after drag mouseup.
         onResizeEnd()       — called after resize mouseup.
         minWidth, minHeight — resize floor (defaults 300/150). */
    create(opts) {

        opts = opts || {};
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
            borderRadius: "8px",
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

        /* Tab bar (left side of header) — registerTab() appends buttons here. */
        this.tabBarEl = document.createElement("div");
        this.tabBarEl.className = "tm-tab-bar";
        Object.assign(this.tabBarEl.style, {
            display: "flex",
            gap: "0",
            flexShrink: "0"
        });
        this.headerEl.appendChild(this.tabBarEl);

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

        /* Drag */
        service_window_make_draggable(this.container, this.headerEl, {
            isDraggable: opts.isDraggable,
            onDragEnd:   opts.onDragEnd
        });

        /* Resize handle */
        this.resizeHandle = service_window_create_resize_handle(this.container, {
            isResizable: opts.isResizable,
            onResizeEnd: opts.onResizeEnd,
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

        return this;
    }

    /* Caller invokes this after appending its own header content so the
       min/max/close cluster ends up at the right edge of the header. */
    appendControls() {
        this.headerEl.appendChild(this._controlsEl);
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

/* ---- Drag ---- */

function service_window_make_draggable(element, handle, opts) {

    const isDraggable = (opts && opts.isDraggable) || (() => true);
    const onDragEnd   = (opts && opts.onDragEnd)   || (() => {});

    let isDown = false;
    let offsetX, offsetY;

    handle.addEventListener("mousedown", (e) => {
        if (!isDraggable()) return;
        isDown = true;
        offsetX = e.clientX - element.offsetLeft;
        offsetY = e.clientY - element.offsetTop;
    });

    document.addEventListener("mouseup", () => {
        if (isDown) onDragEnd();
        isDown = false;
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDown || !isDraggable()) return;
        element.style.left = e.clientX - offsetX + "px";
        element.style.top  = e.clientY - offsetY + "px";
    });
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
        if (resizing) onResizeEnd();
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
