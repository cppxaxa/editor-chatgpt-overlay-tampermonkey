// -----------------------------------------------------------------------------
// component_clock.js — Clock app with 4 tabs: Clock, Alarm, Stopwatch, Timer.
//
// Registered as a system-tray app. Alarms and timers persist in localStorage;
// stopwatch is session-only. Fires toasts + audio on alarm/timer events.
// Shell API exposes dynamic sub-objects (shell.clock.alarm1, .timer1, etc.).
// -----------------------------------------------------------------------------

let clockServiceWindow = null;
let clockContainer     = null;
let clockActiveTab     = "clock";
let clockIntervalId    = null;       // single 1s setInterval drives clock/alarm/timer

// Alarm state — persisted in localStorage["tm_clock_alarms"]
let clockAlarms       = [];   // [{ id, time:"HH:MM", message:"", enabled:true, firedAt:null }]
let clockAlarmNextId  = 1;

// Stopwatch state — session only
let clockSwRunning   = false;
let clockSwStartTime = 0;
let clockSwElapsed   = 0;     // ms accumulated before last pause
let clockSwLaps      = [];
let clockSwRafId     = null;  // rAF loop for centisecond display

// Timer state — persisted in localStorage["tm_clock_timers"]
let clockTimers       = [];   // [{ id, hours, minutes, seconds, message, remainingMs, running, fired }]
let clockTimerNextId  = 1;

// Audio cache
let _clockAudioCache = null;

// DOM refs for tab panels
let _clock_panelClock = null;
let _clock_panelAlarm = null;
let _clock_panelSw    = null;
let _clock_panelTimer = null;

// Clock display refs
let _clock_timeEl = null;
let _clock_dateEl = null;

// Stopwatch display refs
let _clock_swDisplay  = null;
let _clock_swStartBtn = null;
let _clock_swLapBtn   = null;
let _clock_swResetBtn = null;
let _clock_swLapList  = null;

// Alarm/Timer list containers
let _clock_alarmList = null;
let _clock_timerList = null;

/* Inline SVG clock icon: 14x14 viewBox. */
const CLOCK_ICON_SVG =
    "<svg width='14' height='14' viewBox='0 0 14 14' " +
    "xmlns='http://www.w3.org/2000/svg' style='display:block'>" +
        "<circle cx='7' cy='7' r='5.5' fill='none' stroke='currentColor' stroke-width='1'/>" +
        "<line x1='7' y1='7' x2='7' y2='3.5' stroke='currentColor' stroke-width='1' stroke-linecap='round'/>" +
        "<line x1='7' y1='7' x2='9.5' y2='8' stroke='currentColor' stroke-width='0.8' stroke-linecap='round'/>" +
        "<circle cx='7' cy='7' r='0.5' fill='currentColor'/>" +
    "</svg>";

// ─── Launch / Create ─────────────────────────────────────────────────────────

function component_clock_launch() {
    if (!clockContainer) component_clock_create();
    clockServiceWindow.show();
}

function component_clock_create() {

    const trayBtn = framework_taskbar_get_tray_button("clock_app");

    clockServiceWindow = new ServiceWindow();
    clockServiceWindow.create({
        appName:     "clock_app",
        width:       560,
        height:      380,
        isDraggable: () => true,
        isResizable: () => true,
        trayButton:  trayBtn
    });

    // Register tabs
    clockServiceWindow.registerTab({ id: "clock",     label: "Clock",     onClick: _clock_switch_tab });
    clockServiceWindow.registerTab({ id: "alarm",     label: "Alarm",     onClick: _clock_switch_tab });
    clockServiceWindow.registerTab({ id: "stopwatch", label: "Stopwatch", onClick: _clock_switch_tab });
    clockServiceWindow.registerTab({ id: "timer",     label: "Timer",     onClick: _clock_switch_tab });

    clockServiceWindow.appendControls();
    clockContainer = clockServiceWindow.container;

    // Build tab panels
    _clock_build_clock_panel();
    _clock_build_alarm_panel();
    _clock_build_stopwatch_panel();
    _clock_build_timer_panel();

    // Load persisted alarms and timers
    _clock_load_alarms();
    _clock_load_timers();

    // Start the 1s interval
    clockIntervalId = setInterval(_clock_tick, 1000);
    _clock_tick(); // immediate first tick

    // Show initial tab
    _clock_switch_tab("clock");

    // Build shell API
    _clock_rebuild_shell();

    // Restore geometry or center
    if (!clockServiceWindow.restoreState()) {
        service_window_center(clockContainer, 560, 380);
    }
}

// ─── Tab Switching ───────────────────────────────────────────────────────────

function _clock_switch_tab(id) {
    clockActiveTab = id;
    clockServiceWindow.setActiveTabHighlight(id);

    _clock_panelClock.style.display     = id === "clock"     ? "flex" : "none";
    _clock_panelAlarm.style.display     = id === "alarm"     ? "flex" : "none";
    _clock_panelSw.style.display        = id === "stopwatch" ? "flex" : "none";
    _clock_panelTimer.style.display     = id === "timer"     ? "flex" : "none";
}

// ─── Clock Panel ─────────────────────────────────────────────────────────────

function _clock_build_clock_panel() {
    _clock_panelClock = document.createElement("div");
    Object.assign(_clock_panelClock.style, {
        flex: "1", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        color: "white", padding: "12px", gap: "8px"
    });

    _clock_timeEl = document.createElement("div");
    Object.assign(_clock_timeEl.style, {
        fontSize: "48px", fontWeight: "bold", fontFamily: "monospace",
        letterSpacing: "2px"
    });

    _clock_dateEl = document.createElement("div");
    Object.assign(_clock_dateEl.style, {
        fontSize: "14px", color: "#aaa"
    });

    _clock_panelClock.appendChild(_clock_timeEl);
    _clock_panelClock.appendChild(_clock_dateEl);
    clockContainer.appendChild(_clock_panelClock);
}

// ─── Alarm Panel ─────────────────────────────────────────────────────────────

function _clock_build_alarm_panel() {
    _clock_panelAlarm = document.createElement("div");
    Object.assign(_clock_panelAlarm.style, {
        flex: "1", display: "none", flexDirection: "column",
        color: "white", padding: "12px", gap: "8px", overflow: "hidden"
    });

    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add Alarm";
    Object.assign(addBtn.style, {
        background: "#4fc3f7", color: "#000", border: "none",
        borderRadius: "4px", padding: "6px 10px", cursor: "pointer",
        fontWeight: "bold", alignSelf: "flex-start"
    });
    addBtn.onclick = function () {
        _clock_add_alarm();
    };

    _clock_alarmList = document.createElement("div");
    Object.assign(_clock_alarmList.style, {
        flex: "1", overflowY: "auto", display: "flex",
        flexDirection: "column", gap: "6px"
    });

    _clock_panelAlarm.appendChild(addBtn);
    _clock_panelAlarm.appendChild(_clock_alarmList);
    clockContainer.appendChild(_clock_panelAlarm);
}

function _clock_add_alarm(time, message, enabled) {
    const alarm = {
        id:      clockAlarmNextId++,
        time:    time || "",
        message: message || "",
        enabled: enabled !== undefined ? enabled : true,
        firedAt: null
    };
    clockAlarms.push(alarm);
    _clock_render_alarm(alarm);
    _clock_save_alarms();
    _clock_rebuild_shell();
}

function _clock_render_alarm(alarm) {
    const row = document.createElement("div");
    row.dataset.alarmId = alarm.id;
    Object.assign(row.style, {
        display: "flex", alignItems: "center", gap: "6px",
        background: "#2a2a2a", borderRadius: "4px", padding: "6px 8px"
    });

    const timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.value = alarm.time;
    Object.assign(timeInput.style, {
        background: "#1e1e1e", color: "white", border: "1px solid #444",
        borderRadius: "4px", padding: "2px 4px", fontSize: "13px", width: "90px"
    });
    timeInput.onchange = function () {
        alarm.time = timeInput.value;
        alarm.firedAt = null;
        _clock_save_alarms();
    };

    const msgInput = document.createElement("input");
    msgInput.type = "text";
    msgInput.placeholder = "Message";
    msgInput.value = alarm.message;
    Object.assign(msgInput.style, {
        background: "#1e1e1e", color: "white", border: "1px solid #444",
        borderRadius: "4px", padding: "2px 4px", fontSize: "13px",
        flex: "1", minWidth: "0"
    });
    msgInput.onchange = function () {
        alarm.message = msgInput.value;
        _clock_save_alarms();
    };

    const enableCb = document.createElement("input");
    enableCb.type = "checkbox";
    enableCb.checked = alarm.enabled;
    enableCb.title = "Enabled";
    enableCb.onchange = function () {
        alarm.enabled = enableCb.checked;
        alarm.firedAt = null;
        _clock_save_alarms();
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "×";
    Object.assign(delBtn.style, {
        background: "#555", color: "white", border: "none",
        borderRadius: "4px", width: "22px", height: "22px",
        cursor: "pointer", fontSize: "14px", lineHeight: "1"
    });
    delBtn.onclick = function () {
        clockAlarms = clockAlarms.filter(function (a) { return a.id !== alarm.id; });
        row.remove();
        _clock_save_alarms();
        _clock_rebuild_shell();
    };

    row.appendChild(timeInput);
    row.appendChild(msgInput);
    row.appendChild(enableCb);
    row.appendChild(delBtn);

    // Store DOM refs on alarm for shell API access
    alarm._timeInput = timeInput;
    alarm._msgInput  = msgInput;
    alarm._enableCb  = enableCb;

    _clock_alarmList.appendChild(row);
}

function _clock_save_alarms() {
    const data = clockAlarms.map(function (a) {
        return { id: a.id, time: a.time, message: a.message, enabled: a.enabled, firedAt: a.firedAt };
    });
    localStorage.setItem("tm_clock_alarms", JSON.stringify(data));
}

function _clock_load_alarms() {
    try {
        const raw = localStorage.getItem("tm_clock_alarms");
        if (!raw) return;
        const data = JSON.parse(raw);
        data.forEach(function (a) {
            if (a.id >= clockAlarmNextId) clockAlarmNextId = a.id + 1;
            _clock_add_alarm(a.time, a.message, a.enabled);
            // Restore firedAt so we don't re-fire on page load
            const last = clockAlarms[clockAlarms.length - 1];
            if (last) last.firedAt = a.firedAt || null;
        });
    } catch (e) {
        // ignore corrupt data
    }
}

// ─── Stopwatch Panel ─────────────────────────────────────────────────────────

function _clock_build_stopwatch_panel() {
    _clock_panelSw = document.createElement("div");
    Object.assign(_clock_panelSw.style, {
        flex: "1", display: "none", flexDirection: "column",
        color: "white", padding: "12px", gap: "8px", overflow: "hidden"
    });

    _clock_swDisplay = document.createElement("div");
    Object.assign(_clock_swDisplay.style, {
        fontSize: "40px", fontWeight: "bold", fontFamily: "monospace",
        textAlign: "center", letterSpacing: "2px", padding: "8px 0"
    });
    _clock_swDisplay.textContent = "00:00.00";

    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, {
        display: "flex", gap: "8px", justifyContent: "center"
    });

    _clock_swStartBtn = document.createElement("button");
    _clock_swStartBtn.textContent = "Start";
    Object.assign(_clock_swStartBtn.style, {
        background: "#4fc3f7", color: "#000", border: "none",
        borderRadius: "4px", padding: "6px 14px", cursor: "pointer",
        fontWeight: "bold"
    });
    _clock_swStartBtn.onclick = _clock_sw_toggle;

    _clock_swLapBtn = document.createElement("button");
    _clock_swLapBtn.textContent = "Lap";
    Object.assign(_clock_swLapBtn.style, {
        background: "#555", color: "white", border: "none",
        borderRadius: "4px", padding: "6px 14px", cursor: "pointer"
    });
    _clock_swLapBtn.onclick = _clock_sw_lap;

    _clock_swResetBtn = document.createElement("button");
    _clock_swResetBtn.textContent = "Reset";
    Object.assign(_clock_swResetBtn.style, {
        background: "#555", color: "white", border: "none",
        borderRadius: "4px", padding: "6px 14px", cursor: "pointer"
    });
    _clock_swResetBtn.onclick = _clock_sw_reset;

    btnRow.appendChild(_clock_swStartBtn);
    btnRow.appendChild(_clock_swLapBtn);
    btnRow.appendChild(_clock_swResetBtn);

    _clock_swLapList = document.createElement("div");
    Object.assign(_clock_swLapList.style, {
        flex: "1", overflowY: "auto", display: "flex",
        flexDirection: "column", gap: "2px", fontSize: "12px",
        fontFamily: "monospace", color: "#aaa"
    });

    _clock_panelSw.appendChild(_clock_swDisplay);
    _clock_panelSw.appendChild(btnRow);
    _clock_panelSw.appendChild(_clock_swLapList);
    clockContainer.appendChild(_clock_panelSw);
}

function _clock_sw_toggle() {
    if (clockSwRunning) {
        // Stop
        clockSwRunning = false;
        clockSwElapsed += (performance.now() - clockSwStartTime);
        if (clockSwRafId) { cancelAnimationFrame(clockSwRafId); clockSwRafId = null; }
        _clock_swStartBtn.textContent = "Start";
        _clock_swStartBtn.style.background = "#4fc3f7";
    } else {
        // Start
        clockSwRunning = true;
        clockSwStartTime = performance.now();
        _clock_swStartBtn.textContent = "Stop";
        _clock_swStartBtn.style.background = "#ef5350";
        _clock_sw_raf_loop();
    }
}

function _clock_sw_lap() {
    if (!clockSwRunning) return;
    const total = clockSwElapsed + (performance.now() - clockSwStartTime);
    clockSwLaps.push(total);
    const lapEl = document.createElement("div");
    lapEl.textContent = "Lap " + clockSwLaps.length + ": " + _clock_format_sw(total);
    _clock_swLapList.insertBefore(lapEl, _clock_swLapList.firstChild);
}

function _clock_sw_reset() {
    clockSwRunning = false;
    clockSwElapsed = 0;
    clockSwStartTime = 0;
    clockSwLaps = [];
    if (clockSwRafId) { cancelAnimationFrame(clockSwRafId); clockSwRafId = null; }
    _clock_swDisplay.textContent = "00:00.00";
    _clock_swStartBtn.textContent = "Start";
    _clock_swStartBtn.style.background = "#4fc3f7";
    _clock_swLapList.innerHTML = "";
}

function _clock_sw_raf_loop() {
    if (!clockSwRunning) return;
    const total = clockSwElapsed + (performance.now() - clockSwStartTime);
    _clock_swDisplay.textContent = _clock_format_sw(total);
    clockSwRafId = requestAnimationFrame(_clock_sw_raf_loop);
}

function _clock_format_sw(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const cs = Math.floor((ms % 1000) / 10);
    return String(m).padStart(2, "0") + ":" +
           String(s).padStart(2, "0") + "." +
           String(cs).padStart(2, "0");
}

// ─── Timer Panel ─────────────────────────────────────────────────────────────

function _clock_build_timer_panel() {
    _clock_panelTimer = document.createElement("div");
    Object.assign(_clock_panelTimer.style, {
        flex: "1", display: "none", flexDirection: "column",
        color: "white", padding: "12px", gap: "8px", overflow: "hidden"
    });

    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add Timer";
    Object.assign(addBtn.style, {
        background: "#4fc3f7", color: "#000", border: "none",
        borderRadius: "4px", padding: "6px 10px", cursor: "pointer",
        fontWeight: "bold", alignSelf: "flex-start"
    });
    addBtn.onclick = function () {
        _clock_add_timer();
    };

    _clock_timerList = document.createElement("div");
    Object.assign(_clock_timerList.style, {
        flex: "1", overflowY: "auto", display: "flex",
        flexDirection: "column", gap: "6px"
    });

    _clock_panelTimer.appendChild(addBtn);
    _clock_panelTimer.appendChild(_clock_timerList);
    clockContainer.appendChild(_clock_panelTimer);
}

function _clock_add_timer(hours, minutes, seconds, message) {
    const timer = {
        id:          clockTimerNextId++,
        hours:       hours   || 0,
        minutes:     minutes || 0,
        seconds:     seconds || 0,
        message:     message || "",
        remainingMs: 0,
        running:     false,
        fired:       false
    };
    timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
    clockTimers.push(timer);
    _clock_render_timer(timer);
    _clock_save_timers();
    _clock_rebuild_shell();
}

function _clock_render_timer(timer) {
    const row = document.createElement("div");
    row.dataset.timerId = timer.id;
    Object.assign(row.style, {
        display: "flex", alignItems: "center", gap: "6px",
        background: "#2a2a2a", borderRadius: "4px", padding: "6px 8px",
        flexWrap: "wrap"
    });

    // Time inputs row
    const timeRow = document.createElement("div");
    Object.assign(timeRow.style, { display: "flex", alignItems: "center", gap: "2px" });

    const hInput = _clock_make_num_input(2, "h");
    hInput.value = timer.hours;
    hInput.onchange = function () {
        timer.hours = parseInt(hInput.value) || 0;
        if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
        _clock_save_timers();
    };

    const sep1 = document.createElement("span");
    sep1.textContent = ":";
    sep1.style.color = "#888";

    const mInput = _clock_make_num_input(2, "m");
    mInput.value = timer.minutes;
    mInput.onchange = function () {
        timer.minutes = parseInt(mInput.value) || 0;
        if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
        _clock_save_timers();
    };

    const sep2 = document.createElement("span");
    sep2.textContent = ":";
    sep2.style.color = "#888";

    const sInput = _clock_make_num_input(2, "s");
    sInput.value = timer.seconds;
    sInput.onchange = function () {
        timer.seconds = parseInt(sInput.value) || 0;
        if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
        _clock_save_timers();
    };

    timeRow.appendChild(hInput);
    timeRow.appendChild(sep1);
    timeRow.appendChild(mInput);
    timeRow.appendChild(sep2);
    timeRow.appendChild(sInput);

    const msgInput = document.createElement("input");
    msgInput.type = "text";
    msgInput.placeholder = "Message";
    msgInput.value = timer.message;
    Object.assign(msgInput.style, {
        background: "#1e1e1e", color: "white", border: "1px solid #444",
        borderRadius: "4px", padding: "2px 4px", fontSize: "12px",
        flex: "1", minWidth: "0"
    });
    msgInput.onchange = function () {
        timer.message = msgInput.value;
        _clock_save_timers();
    };

    const remainLabel = document.createElement("span");
    Object.assign(remainLabel.style, {
        fontFamily: "monospace", fontSize: "13px", color: "#4fc3f7",
        minWidth: "60px", textAlign: "right"
    });
    remainLabel.textContent = _clock_format_timer_ms(timer.remainingMs);

    const startBtn = document.createElement("button");
    startBtn.textContent = "Start";
    Object.assign(startBtn.style, {
        background: "#4fc3f7", color: "#000", border: "none",
        borderRadius: "4px", padding: "3px 8px", cursor: "pointer",
        fontSize: "12px", fontWeight: "bold"
    });
    startBtn.onclick = function () {
        if (timer.running) {
            timer.running = false;
            startBtn.textContent = "Start";
            startBtn.style.background = "#4fc3f7";
        } else {
            if (timer.remainingMs <= 0) {
                timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
            }
            if (timer.remainingMs <= 0) return;
            timer.running = true;
            timer.fired = false;
            startBtn.textContent = "Pause";
            startBtn.style.background = "#ef5350";
        }
        _clock_save_timers();
    };

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "↻";
    Object.assign(resetBtn.style, {
        background: "#555", color: "white", border: "none",
        borderRadius: "4px", width: "22px", height: "22px",
        cursor: "pointer", fontSize: "13px"
    });
    resetBtn.onclick = function () {
        timer.running = false;
        timer.fired = false;
        timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000;
        remainLabel.textContent = _clock_format_timer_ms(timer.remainingMs);
        startBtn.textContent = "Start";
        startBtn.style.background = "#4fc3f7";
        _clock_save_timers();
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "×";
    Object.assign(delBtn.style, {
        background: "#555", color: "white", border: "none",
        borderRadius: "4px", width: "22px", height: "22px",
        cursor: "pointer", fontSize: "14px", lineHeight: "1"
    });
    delBtn.onclick = function () {
        clockTimers = clockTimers.filter(function (t) { return t.id !== timer.id; });
        row.remove();
        _clock_save_timers();
        _clock_rebuild_shell();
    };

    row.appendChild(timeRow);
    row.appendChild(msgInput);
    row.appendChild(remainLabel);
    row.appendChild(startBtn);
    row.appendChild(resetBtn);
    row.appendChild(delBtn);

    // Store DOM refs on timer for shell/tick access
    timer._remainLabel = remainLabel;
    timer._startBtn    = startBtn;
    timer._hInput      = hInput;
    timer._mInput      = mInput;
    timer._sInput      = sInput;
    timer._msgInput    = msgInput;

    _clock_timerList.appendChild(row);
}

function _clock_make_num_input(width, label) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "0";
    inp.placeholder = label;
    Object.assign(inp.style, {
        background: "#1e1e1e", color: "white", border: "1px solid #444",
        borderRadius: "4px", padding: "2px 4px", fontSize: "12px",
        width: (width * 16) + "px", textAlign: "center"
    });
    return inp;
}

function _clock_format_timer_ms(ms) {
    if (ms <= 0) return "00:00:00";
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return String(h).padStart(2, "0") + ":" +
           String(m).padStart(2, "0") + ":" +
           String(s).padStart(2, "0");
}

function _clock_save_timers() {
    const data = clockTimers.map(function (t) {
        return {
            id: t.id, hours: t.hours, minutes: t.minutes, seconds: t.seconds,
            message: t.message, remainingMs: t.remainingMs,
            running: t.running, fired: t.fired
        };
    });
    localStorage.setItem("tm_clock_timers", JSON.stringify(data));
}

function _clock_load_timers() {
    try {
        const raw = localStorage.getItem("tm_clock_timers");
        if (!raw) return;
        const data = JSON.parse(raw);
        data.forEach(function (t) {
            if (t.id >= clockTimerNextId) clockTimerNextId = t.id + 1;
            _clock_add_timer(t.hours, t.minutes, t.seconds, t.message);
            // Restore runtime state
            const last = clockTimers[clockTimers.length - 1];
            if (last) {
                last.remainingMs = t.remainingMs || 0;
                last.running = t.running || false;
                last.fired = t.fired || false;
                if (last._remainLabel) last._remainLabel.textContent = _clock_format_timer_ms(last.remainingMs);
                if (last.running && last._startBtn) {
                    last._startBtn.textContent = "Pause";
                    last._startBtn.style.background = "#ef5350";
                }
            }
        });
    } catch (e) {
        // ignore corrupt data
    }
}

// ─── 1s Tick ─────────────────────────────────────────────────────────────────

function _clock_tick() {
    const now = new Date();

    // Clock tab
    if (_clock_timeEl) {
        _clock_timeEl.textContent =
            String(now.getHours()).padStart(2, "0") + ":" +
            String(now.getMinutes()).padStart(2, "0") + ":" +
            String(now.getSeconds()).padStart(2, "0");
    }
    if (_clock_dateEl) {
        _clock_dateEl.textContent = now.toLocaleDateString(undefined, {
            weekday: "long", year: "numeric", month: "long", day: "numeric"
        });
    }

    // Alarm check
    const hhmm = String(now.getHours()).padStart(2, "0") + ":" +
                 String(now.getMinutes()).padStart(2, "0");
    const minuteKey = now.getFullYear() + "-" + now.getMonth() + "-" +
                      now.getDate() + "-" + now.getHours() + "-" + now.getMinutes();

    for (let i = 0; i < clockAlarms.length; i++) {
        const a = clockAlarms[i];
        if (a.enabled && a.time === hhmm && a.firedAt !== minuteKey) {
            a.firedAt = minuteKey;
            _clock_save_alarms();
            _clock_fire_notification("Alarm", a.message || ("Alarm " + a.id));
        }
    }

    // Timer countdown
    let _timerDirty = false;
    for (let i = 0; i < clockTimers.length; i++) {
        const t = clockTimers[i];
        if (!t.running || t.fired) continue;
        _timerDirty = true;
        t.remainingMs -= 1000;
        if (t.remainingMs <= 0) {
            t.remainingMs = 0;
            t.running = false;
            t.fired = true;
            if (t._startBtn) {
                t._startBtn.textContent = "Start";
                t._startBtn.style.background = "#4fc3f7";
            }
            _clock_fire_notification("Timer", t.message || ("Timer " + t.id));
        }
        if (t._remainLabel) {
            t._remainLabel.textContent = _clock_format_timer_ms(t.remainingMs);
        }
    }
    if (_timerDirty) _clock_save_timers();
}

// ─── Notifications ───────────────────────────────────────────────────────────

function _clock_fire_notification(type, message) {
    service_toast_show(message, {
        title: type,
        icon: type === "Alarm" ? "⏰" : "⏱️",
        duration: 5000
    });
    _clock_play_alarm();
}

async function _clock_play_alarm() {
    try {
        if (!_clockAudioCache) {
            if (typeof service_fs_get === "function") {
                const file = await service_fs_get("alarm.wav");
                if (file) _clockAudioCache = file.dataUrl;
            }
        }
        if (_clockAudioCache) {
            const audio = new Audio(_clockAudioCache);
            audio.play();
            setTimeout(function () { audio.pause(); audio.currentTime = 0; }, 5000);
        }
    } catch (e) {
        // Silently fail if audio unavailable
    }
}

// ─── Shell API ───────────────────────────────────────────────────────────────

function _clock_rebuild_shell() {
    if (typeof shell === "undefined") return;

    var ns = {};

    // Window controls
    ns.show      = function () { component_clock_launch(); };
    ns.hide      = function () { if (clockServiceWindow) clockServiceWindow.hide(); };
    ns.isVisible = function () { return clockServiceWindow ? clockServiceWindow.visible : false; };

    // Alarm management
    ns.addAlarm = function () {
        _clock_add_alarm();
    };
    ns.removeAlarm = function (name) {
        var m = String(name).match(/^alarm(\d+)$/);
        if (!m) return;
        var idx = parseInt(m[1], 10) - 1;
        if (idx < 0 || idx >= clockAlarms.length) return;
        var alarm = clockAlarms[idx];
        clockAlarms.splice(idx, 1);
        var row = _clock_alarmList.querySelector("[data-alarm-id='" + alarm.id + "']");
        if (row) row.remove();
        _clock_save_alarms();
        _clock_rebuild_shell();
    };

    // Dynamic alarm sub-objects
    for (var ai = 0; ai < clockAlarms.length; ai++) {
        (function (alarm, idx) {
            ns["alarm" + (idx + 1)] = {
                getTime:    function ()  { return alarm.time; },
                setTime:    function (v) { alarm.time = v; if (alarm._timeInput) alarm._timeInput.value = v; alarm.firedAt = null; _clock_save_alarms(); },
                getMessage: function ()  { return alarm.message; },
                setMessage: function (v) { alarm.message = v; if (alarm._msgInput) alarm._msgInput.value = v; _clock_save_alarms(); },
                isEnabled:  function ()  { return alarm.enabled; },
                setEnabled: function (b) { alarm.enabled = !!b; if (alarm._enableCb) alarm._enableCb.checked = !!b; alarm.firedAt = null; _clock_save_alarms(); }
            };
        })(clockAlarms[ai], ai);
    }

    // Stopwatch
    ns.startStopwatch = function () {
        if (!clockSwRunning) _clock_sw_toggle();
    };
    ns.stopStopwatch = function () {
        if (clockSwRunning) _clock_sw_toggle();
    };
    ns.resetStopwatch = function () {
        _clock_sw_reset();
    };
    ns.lapStopwatch = function () {
        _clock_sw_lap();
    };
    ns.getStopwatchElapsed = function () {
        if (clockSwRunning) return clockSwElapsed + (performance.now() - clockSwStartTime);
        return clockSwElapsed;
    };

    // Timer management
    ns.addTimer = function () {
        _clock_add_timer();
    };
    ns.removeTimer = function (name) {
        var m = String(name).match(/^timer(\d+)$/);
        if (!m) return;
        var idx = parseInt(m[1], 10) - 1;
        if (idx < 0 || idx >= clockTimers.length) return;
        var timer = clockTimers[idx];
        clockTimers.splice(idx, 1);
        var row = _clock_timerList.querySelector("[data-timer-id='" + timer.id + "']");
        if (row) row.remove();
        _clock_save_timers();
        _clock_rebuild_shell();
    };

    // Dynamic timer sub-objects
    for (var ti = 0; ti < clockTimers.length; ti++) {
        (function (timer, idx) {
            ns["timer" + (idx + 1)] = {
                getHours:     function ()  { return timer.hours; },
                setHours:     function (v) { timer.hours = parseInt(v) || 0; if (timer._hInput) timer._hInput.value = timer.hours; if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000; },
                getMinutes:   function ()  { return timer.minutes; },
                setMinutes:   function (v) { timer.minutes = parseInt(v) || 0; if (timer._mInput) timer._mInput.value = timer.minutes; if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000; },
                getSeconds:   function ()  { return timer.seconds; },
                setSeconds:   function (v) { timer.seconds = parseInt(v) || 0; if (timer._sInput) timer._sInput.value = timer.seconds; if (!timer.running) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000; },
                getMessage:   function ()  { return timer.message; },
                setMessage:   function (v) { timer.message = v; if (timer._msgInput) timer._msgInput.value = v; },
                start:        function ()  { if (!timer.running) { if (timer.remainingMs <= 0) timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000; if (timer.remainingMs > 0) { timer.running = true; timer.fired = false; if (timer._startBtn) { timer._startBtn.textContent = "Pause"; timer._startBtn.style.background = "#ef5350"; } } } },
                pause:        function ()  { if (timer.running) { timer.running = false; if (timer._startBtn) { timer._startBtn.textContent = "Start"; timer._startBtn.style.background = "#4fc3f7"; } } },
                reset:        function ()  { timer.running = false; timer.fired = false; timer.remainingMs = ((timer.hours * 3600) + (timer.minutes * 60) + timer.seconds) * 1000; if (timer._remainLabel) timer._remainLabel.textContent = _clock_format_timer_ms(timer.remainingMs); if (timer._startBtn) { timer._startBtn.textContent = "Start"; timer._startBtn.style.background = "#4fc3f7"; } },
                getRemaining: function ()  { return timer.remainingMs; }
            };
        })(clockTimers[ti], ti);
    }

    shell.clock = ns;
}

// ─── Framework Lifecycle ─────────────────────────────────────────────────────

function component_clock_handle_init() {
    ServiceWindow.registerApp("clock_app", component_clock_launch);

    framework_taskbar_register_tray_app({
        appName: "clock_app",
        label:   "Clock",
        icon:    CLOCK_ICON_SVG,
        title:   "Clock",
        onClick: function (btn) {
            if (!clockContainer) component_clock_create();
            clockServiceWindow._toggleFromTray(btn);
        },
        onAdopt: function (btn) {
            if (clockServiceWindow) {
                clockServiceWindow._adoptTrayButton(btn, null);
            }
        }
    });
}
