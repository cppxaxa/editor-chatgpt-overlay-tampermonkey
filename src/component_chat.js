// -----------------------------------------------------------------------------
// component_chat.js — IM-style chat app. Text input at the bottom, scrollable
// message log above. Sends prompts via submitMessage (service_llm.js) and
// displays responses inline. Shows a waiting indicator while the LLM streams.
// -----------------------------------------------------------------------------

let chatServiceWindow = null;
let chatContainer      = null;

/* Inline SVG chat bubble: 14x14 viewBox, currentColor strokes so it inherits
   whatever container's text colour (tray button, taskbar running-app
   button, hover state). A rounded speech bubble with a small triangular
   tail at the bottom-left, plus three dots indicating conversation. */
const CHAT_ICON_SVG =
    "<svg width='14' height='14' viewBox='0 0 14 14' " +
    "xmlns='http://www.w3.org/2000/svg' style='display:block'>" +
        "<path d='M2 1.5 h10 a1.5 1.5 0 0 1 1.5 1.5 v6 " +
        "a1.5 1.5 0 0 1 -1.5 1.5 h-6.5 l-2.5 2.5 v-2.5 " +
        "h-1 a1.5 1.5 0 0 1 -1.5 -1.5 v-6 " +
        "a1.5 1.5 0 0 1 1.5 -1.5 z' " +
        "fill='none' stroke='currentColor' stroke-width='1'/>" +
        "<circle cx='4.5' cy='5.8' r='0.7' fill='currentColor'/>" +
        "<circle cx='7'   cy='5.8' r='0.7' fill='currentColor'/>" +
        "<circle cx='9.5' cy='5.8' r='0.7' fill='currentColor'/>" +
    "</svg>";

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

    const trayBtn = framework_taskbar_get_tray_button("chat");

    chatServiceWindow = new ServiceWindow();
    chatServiceWindow.create({
        appName:     "chat",
        width:       480,
        height:      400,
        shell:  shell,
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

                /* If the chat window isn't actively visible to the user
                   (closed, hidden, or minimized to the taskbar), surface
                   the response as a toast notification. The first 60 chars
                   of the result preview the body; full text is recorded in
                   the toast history pane. */
                const chatVisible =
                    chatServiceWindow &&
                    chatServiceWindow.visible &&
                    chatServiceWindow.mode !== "minimized";

                if (!chatVisible) {
                    const raw = (ctx.result || "").trim();
                    const preview = raw.length > 60
                        ? raw.slice(0, 60) + "…"
                        : (raw || "(empty response)");
                    service_toast_show(preview, {
                        title:    "LLM",
                        icon:     "💬",
                        duration: 3000
                    });
                }
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

    framework_taskbar_register_tray_app({
        appName: "chat",
        label:   "Chat",
        icon:    CHAT_ICON_SVG,
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
