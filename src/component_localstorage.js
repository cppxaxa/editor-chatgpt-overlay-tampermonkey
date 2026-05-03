// component_localstorage.js — localStorage viewer app. Shows all localStorage
// entries in a two-column key/value table. JSON values are expandable into a
// nested grid. Search filters across both keys and values.
//
// Registered with the framework launcher as "L". Lazily creates the window on
// first launch.

let lsServiceWindow = null;
let lsContainer     = null;
let lsBody          = null;
let lsSearchInput   = null;
let lsTableWrap     = null;

function component_localstorage_launch() {
    if (!lsContainer) component_localstorage_create();
    lsServiceWindow.show();
    component_localstorage_refresh();
}

function component_localstorage_create() {

    lsServiceWindow = new ServiceWindow();
    lsServiceWindow.create({
        appName: "localstorage",
        width:  700,
        height: 500,
        isDraggable: () => true,
        isResizable: () => true,
        minWidth: 400,
        minHeight: 250
    });

    lsServiceWindow.registerTab({ id: "ls", label: "LocalStorage" });

    lsServiceWindow.registerAction({
        label: "↻",
        title: "Refresh",
        onClick: component_localstorage_refresh
    });

    lsServiceWindow.appendControls();

    lsContainer = lsServiceWindow.container;

    /* Body */
    lsBody = lsServiceWindow.createBody({ padding: "8px", gap: "6px" });

    /* Search bar */
    lsSearchInput = lsServiceWindow.createTextbox("Search keys and values…");
    lsSearchInput.addEventListener("input", component_localstorage_refresh);
    lsBody.appendChild(lsSearchInput);

    /* Table wrapper */
    lsTableWrap = document.createElement("div");
    Object.assign(lsTableWrap.style, {
        flex: "1",
        overflow: "auto",
        border: "1px solid #333",
        borderRadius: "4px"
    });
    lsBody.appendChild(lsTableWrap);

    /* Restore previously saved geometry/mode; otherwise center. */
    if (!lsServiceWindow.restoreState()) {
        service_window_center(lsContainer, 700, 500);
    }
}

/* ---- Refresh / render ---- */

function component_localstorage_refresh() {
    if (!lsTableWrap) return;

    const filter = (lsSearchInput ? lsSearchInput.value : "").toLowerCase();

    /* Gather entries */
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        if (filter) {
            if (key.toLowerCase().indexOf(filter) === -1 &&
                val.toLowerCase().indexOf(filter) === -1) continue;
        }
        entries.push({ key, val });
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));

    /* Clear */
    lsTableWrap.innerHTML = "";

    /* Build table */
    const table = document.createElement("table");
    Object.assign(table.style, {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "12px",
        fontFamily: "Consolas, monospace",
        tableLayout: "fixed"
    });

    /* Header row */
    const thead = document.createElement("thead");
    const hrow = document.createElement("tr");
    const thKey = document.createElement("th");
    thKey.textContent = "Key";
    const thVal = document.createElement("th");
    thVal.textContent = "Value";
    [thKey, thVal].forEach((th, i) => {
        Object.assign(th.style, {
            textAlign: "left",
            padding: "6px 8px",
            borderBottom: "1px solid #444",
            background: "#2a2a2a",
            color: "#aaa",
            position: "sticky",
            top: "0",
            zIndex: "1",
            width: i === 0 ? "30%" : "70%"
        });
    });
    hrow.appendChild(thKey);
    hrow.appendChild(thVal);
    thead.appendChild(hrow);
    table.appendChild(thead);

    /* Body rows */
    const tbody = document.createElement("tbody");
    for (const entry of entries) {
        const tr = document.createElement("tr");

        /* Key cell */
        const tdKey = document.createElement("td");
        tdKey.textContent = entry.key;
        Object.assign(tdKey.style, {
            padding: "4px 8px",
            borderBottom: "1px solid #2a2a2a",
            color: "#6fc",
            verticalAlign: "top",
            wordBreak: "break-all",
            width: "30%"
        });

        /* Value cell */
        const tdVal = document.createElement("td");
        Object.assign(tdVal.style, {
            padding: "4px 8px",
            borderBottom: "1px solid #2a2a2a",
            color: "#ddd",
            verticalAlign: "top",
            width: "70%"
        });

        const parsed = _ls_try_parse_json(entry.val);
        if (parsed !== null && typeof parsed === "object") {
            tdVal.appendChild(_ls_render_json_toggle(parsed, entry.val));
        } else {
            tdVal.appendChild(_ls_render_primitive(entry.val));
        }

        tr.appendChild(tdKey);
        tr.appendChild(tdVal);

        /* Hover */
        tr.addEventListener("mouseenter", () => { tr.style.background = "#2a2a2a"; });
        tr.addEventListener("mouseleave", () => { tr.style.background = ""; });

        tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    /* Empty state */
    if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = filter ? "No matches." : "localStorage is empty.";
        Object.assign(empty.style, { color: "#666", padding: "20px", textAlign: "center" });
        lsTableWrap.appendChild(empty);
    } else {
        lsTableWrap.appendChild(table);
    }
}

/* ---- JSON helpers ---- */

function _ls_try_parse_json(str) {
    if (!str || str.length < 2) return null;
    const c = str[0];
    if (c !== "{" && c !== "[" && c !== "\"") return null;
    try { return JSON.parse(str); } catch (e) { return null; }
}

/* Render a primitive value as a colored span */
function _ls_render_primitive(val) {
    const span = document.createElement("span");
    span.style.wordBreak = "break-all";

    if (val === "true" || val === "false") {
        span.textContent = val;
        span.style.color = "#f9a825";
    } else if (val !== "" && !isNaN(val)) {
        span.textContent = val;
        span.style.color = "#ce93d8";
    } else {
        span.textContent = val;
        span.style.color = "#ddd";
    }
    return span;
}

/* Render a JSON value with a toggle: collapsed (raw string) or expanded (grid) */
function _ls_render_json_toggle(parsed, rawStr) {
    const wrap = document.createElement("div");

    const toggle = document.createElement("span");
    toggle.textContent = "▶ JSON";
    Object.assign(toggle.style, {
        color: "#4fc3f7",
        cursor: "pointer",
        fontSize: "11px",
        marginRight: "6px",
        userSelect: "none"
    });

    const preview = document.createElement("span");
    const previewText = rawStr.length > 80 ? rawStr.substring(0, 80) + "…" : rawStr;
    preview.textContent = previewText;
    Object.assign(preview.style, {
        color: "#888",
        fontSize: "11px",
        wordBreak: "break-all"
    });

    const detail = document.createElement("div");
    detail.style.display = "none";
    Object.assign(detail.style, {
        marginTop: "4px",
        maxHeight: "300px",
        overflow: "auto"
    });

    let expanded = false;
    let built = false;

    toggle.addEventListener("click", () => {
        expanded = !expanded;
        if (expanded) {
            toggle.textContent = "▼ JSON";
            preview.style.display = "none";
            detail.style.display = "block";
            if (!built) {
                detail.appendChild(_ls_render_json_value(parsed, 0));
                built = true;
            }
        } else {
            toggle.textContent = "▶ JSON";
            preview.style.display = "";
            detail.style.display = "none";
        }
    });

    wrap.appendChild(toggle);
    wrap.appendChild(preview);
    wrap.appendChild(detail);
    return wrap;
}

/* Recursively render a JSON value as a nested grid */
function _ls_render_json_value(val, depth) {

    if (val === null) {
        const s = document.createElement("span");
        s.textContent = "null";
        s.style.color = "#f44336";
        return s;
    }

    if (typeof val === "boolean") {
        const s = document.createElement("span");
        s.textContent = String(val);
        s.style.color = "#f9a825";
        return s;
    }

    if (typeof val === "number") {
        const s = document.createElement("span");
        s.textContent = String(val);
        s.style.color = "#ce93d8";
        return s;
    }

    if (typeof val === "string") {
        const s = document.createElement("span");
        s.textContent = "\"" + val + "\"";
        s.style.color = "#a5d6a7";
        s.style.wordBreak = "break-all";
        return s;
    }

    if (Array.isArray(val)) {
        if (val.length === 0) {
            const s = document.createElement("span");
            s.textContent = "[]";
            s.style.color = "#888";
            return s;
        }
        return _ls_render_json_table(val, depth, true);
    }

    if (typeof val === "object") {
        const keys = Object.keys(val);
        if (keys.length === 0) {
            const s = document.createElement("span");
            s.textContent = "{}";
            s.style.color = "#888";
            return s;
        }
        return _ls_render_json_table(val, depth, false);
    }

    const s = document.createElement("span");
    s.textContent = String(val);
    return s;
}

/* Render an object or array as a key/value grid */
function _ls_render_json_table(obj, depth, isArray) {
    const tbl = document.createElement("table");
    Object.assign(tbl.style, {
        borderCollapse: "collapse",
        fontSize: "11px",
        fontFamily: "Consolas, monospace",
        width: "100%",
        marginLeft: depth > 0 ? "0" : "0"
    });

    const borderColor = depth % 2 === 0 ? "#333" : "#3a3a3a";

    const entries = isArray
        ? obj.map((v, i) => [i, v])
        : Object.entries(obj);

    for (const [k, v] of entries) {
        const tr = document.createElement("tr");

        const tdK = document.createElement("td");
        tdK.textContent = isArray ? "[" + k + "]" : k;
        Object.assign(tdK.style, {
            padding: "2px 6px",
            borderBottom: "1px solid " + borderColor,
            color: isArray ? "#ce93d8" : "#6fc",
            verticalAlign: "top",
            whiteSpace: "nowrap",
            width: "1%"
        });

        const tdV = document.createElement("td");
        Object.assign(tdV.style, {
            padding: "2px 6px",
            borderBottom: "1px solid " + borderColor,
            verticalAlign: "top"
        });
        tdV.appendChild(_ls_render_json_value(v, depth + 1));

        tr.appendChild(tdK);
        tr.appendChild(tdV);
        tbl.appendChild(tr);
    }

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
        border: "1px solid " + borderColor,
        borderRadius: "3px",
        overflow: "hidden"
    });
    wrapper.appendChild(tbl);
    return wrapper;
}

/* Framework lifecycle reactor */
function component_localstorage_handle_init() {
    ServiceWindow.registerApp("localstorage", component_localstorage_launch);
}
