// -----------------------------------------------------------------------------
// component_chat.js — IM-style chat app. Text input at the bottom, scrollable
// message log above. Sends prompts via submitMessage (service_llm.js) and
// displays responses inline. Shows a waiting indicator while the LLM streams.
// -----------------------------------------------------------------------------

let chatServiceWindow = null;
let chatContainer      = null;

// DOM refs
let _chat_log       = null;   // scrollable message history
let _chat_input     = null;   // prompt textarea
let _chat_sendBtn   = null;   // send button
let _chat_waiting   = false;  // true while an LLM job is in flight

function component_chat_launch() {
    if (!chatContainer) component_chat_create();
    chatServiceWindow.show();
}

function component_chat_create() {

    const trayBtn = (typeof service_taskbar_get_tray_button === "function")
        ? service_taskbar_get_tray_button("chat")
        : null;

    chatServiceWindow = new ServiceWindow();
    chatServiceWindow.create({
        appName:     "chat",
        width:       480,
        height:      400,
        isDraggable: () => true,
        isResizable: () => true,
        trayButton:  trayBtn
    });

    chatServiceWindow.registerTab({ id: "chat", label: "Chat" });
    chatServiceWindow.appendControls();

    chatContainer = chatServiceWindow.container;

    /* Body — flex column, no padding so we control spacing ourselves. */
    const body = chatServiceWindow.createBody({ padding: "0", gap: "0" });

    /* ---- Message log ---- */
    _chat_log = document.createElement("div");
    Object.assign(_chat_log.style, {
        flex:       "1",
        overflowY:  "auto",
        padding:    "8px",
        fontSize:   "13px",
        fontFamily: "Consolas, monospace",
        color:      "white"
    });
    body.appendChild(_chat_log);

    /* ---- Input bar (textarea + send button) ---- */
    const inputBar = document.createElement("div");
    Object.assign(inputBar.style, {
        display:       "flex",
        gap:           "4px",
        padding:       "6px 8px",
        borderTop:     "1px solid #333",
        background:    "#252525",
        alignItems:    "flex-end"
    });

    _chat_input = document.createElement("textarea");
    _chat_input.placeholder = "Enter prompt...";
    _chat_input.rows = 2;
    Object.assign(_chat_input.style, {
        flex:        "1",
        background:  "#2a2a2a",
        color:       "white",
        border:      "1px solid #444",
        borderRadius: "4px",
        padding:     "6px",
        fontSize:    "13px",
        fontFamily:  "Consolas, monospace",
        resize:      "none",
        lineHeight:  "1.4"
    });

    /* Enter sends (Shift+Enter for newline). */
    _chat_input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            _chat_do_send();
        }
    });

    _chat_sendBtn = document.createElement("button");
    _chat_sendBtn.textContent = "Send";
    Object.assign(_chat_sendBtn.style, {
        background:   "#4fc3f7",
        color:        "#000",
        border:       "none",
        borderRadius: "4px",
        padding:      "6px 14px",
        cursor:       "pointer",
        fontWeight:   "bold",
        fontSize:     "13px",
        alignSelf:    "stretch"
    });
    _chat_sendBtn.onclick = () => _chat_do_send();

    inputBar.appendChild(_chat_input);
    inputBar.appendChild(_chat_sendBtn);
    body.appendChild(inputBar);

    /* Restore geometry or center. */
    if (!chatServiceWindow.restoreState()) {
        service_window_center(chatContainer, 480, 400);
    }
}

/* ---- Send logic ---- */

function _chat_do_send() {
    if (_chat_waiting) return;
    const prompt = (_chat_input.value || "").trim();
    if (!prompt) return;

    /* Append user message to log. */
    _chat_append_message("You", prompt);

    _chat_input.value = "";

    /* Show waiting indicator. */
    const waitEl = _chat_append_waiting();

    _chat_waiting = true;
    _chat_sendBtn.textContent = "...";
    _chat_sendBtn.style.opacity = "0.5";
    _chat_input.readOnly = true;

    submitMessage(
        prompt,
        /* onstart */ null,
        /* onend   */ (ctx) => {
            _chat_waiting = false;
            _chat_sendBtn.textContent = "Send";
            _chat_sendBtn.style.opacity = "1";
            _chat_input.readOnly = false;

            /* Remove waiting indicator. */
            if (waitEl && waitEl.parentElement) waitEl.parentElement.removeChild(waitEl);

            if (ctx.cancelled) {
                _chat_append_message("System", "(cancelled)");
            } else if (ctx.error) {
                _chat_append_message("System", "Error: " + ctx.error);
            } else {
                _chat_append_message("Assistant", ctx.result || "(empty response)");
            }

            _chat_input.focus();
        }
    );
}

/* ---- DOM helpers ---- */

function _chat_append_message(role, text) {
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
        marginBottom: "8px",
        whiteSpace:   "pre-wrap",
        wordBreak:    "break-word",
        lineHeight:   "1.4"
    });

    const label = document.createElement("span");
    label.textContent = role + ": ";
    Object.assign(label.style, {
        fontWeight: "bold",
        color: role === "You" ? "#4fc3f7" : role === "Assistant" ? "#a5d6a7" : "#ffcc80"
    });

    const content = document.createElement("span");
    content.textContent = text;
    content.style.color = "#ddd";

    wrapper.appendChild(label);
    wrapper.appendChild(content);
    _chat_log.appendChild(wrapper);

    /* Auto-scroll to bottom. */
    _chat_log.scrollTop = _chat_log.scrollHeight;

    return wrapper;
}

function _chat_append_waiting() {
    const el = document.createElement("div");
    Object.assign(el.style, {
        marginBottom: "8px",
        color:        "#888",
        fontSize:     "13px"
    });
    el.textContent = "Waiting";

    let dots = 0;
    const tid = setInterval(() => {
        dots = (dots + 1) % 4;
        el.textContent = "Waiting" + ".".repeat(dots);
    }, 400);

    /* Stash the interval id so cleanup can stop it. */
    el._chatWaitTid = tid;

    /* Patch removeChild to auto-clear the interval. */
    const origRemove = el.remove.bind(el);
    el.remove = () => { clearInterval(tid); origRemove(); };

    _chat_log.appendChild(el);
    _chat_log.scrollTop = _chat_log.scrollHeight;

    return el;
}

/* ---- Framework lifecycle ---- */

function component_chat_handle_init() {
    ServiceWindow.registerApp("chat", component_chat_launch);

    if (typeof service_taskbar_register_tray_app === "function") {
        service_taskbar_register_tray_app({
            appName: "chat",
            label:   "Chat",
            icon:    "💬",
            title:   "Chat",
            onClick: (btn) => {
                if (!chatContainer) component_chat_create();
                chatServiceWindow._toggleFromTray(btn);
            },
            onAdopt: (btn) => {
                if (chatServiceWindow) {
                    chatServiceWindow._adoptTrayButton(btn, null);
                }
            }
        });
    }
}
