// -----------------------------------------------------------------------------
// component_calc.js — minimal demo app showing how to build a window with
// ServiceWindow. Two number inputs, a Sum button, and a result label.
//
// Registered with the framework launcher as "C". Lazily creates the window on
// first launch.
// -----------------------------------------------------------------------------

let calcServiceWindow = null;
let calcContainer     = null;
let calcTrayHandle    = null;

function component_calc_launch() {
    if (!calcContainer) component_calc_create();
    /* If launched via tray icon, _toggleFromTray handles show() + snap. If
       launched via Start menu, do a normal show. We can't tell here which
       path the user took — show() is idempotent and the tray-mode patch on
       hide() doesn't affect show(), so calling show() unconditionally is
       safe for both paths. The tray-icon onClick path replaces show() with
       its own toggle/snap, so that path doesn't reach this function. */
    calcServiceWindow.show();
}

function component_calc_create() {

    calcServiceWindow = new ServiceWindow();
    calcServiceWindow.create({
        appName: "calc",
        width:  320,
        height: 200,
        isDraggable: () => true,
        isResizable: () => true,
        /* Adopt the tray button registered at init time so the icon was
           visible in the tray even before the window was lazily created. */
        trayButton: calcTrayHandle && calcTrayHandle.button,
        trayHandle: calcTrayHandle
    });

    calcServiceWindow.registerTab({ id: "calc", label: "Calc" });

    /* Min/max/close cluster — defaults from ServiceWindow are fine for a
       minimal demo (close hides the container; max toggles fullscreen; min
       collapses to header height). No wiring needed here. */
    calcServiceWindow.appendControls();

    calcContainer = calcServiceWindow.container;

    /* Body */
    const body = calcServiceWindow.createBody();

    const inputA = calcServiceWindow.createTextbox("a");
    inputA.type = "number";

    const inputB = calcServiceWindow.createTextbox("b");
    inputB.type = "number";

    const resultLabel = calcServiceWindow.createLabel("Result: —");

    const sumBtn = calcServiceWindow.createPrimaryButton("Sum");

    sumBtn.onclick = () => {
        const a = parseFloat(inputA.value) || 0;
        const b = parseFloat(inputB.value) || 0;
        resultLabel.textContent = "Result: " + (a + b);
    };

    body.appendChild(inputA);
    body.appendChild(inputB);
    body.appendChild(sumBtn);
    body.appendChild(resultLabel);

    /* Restore previously saved geometry/mode; otherwise center. */
    if (!calcServiceWindow.restoreState()) {
        service_window_center(calcContainer, 320, 200);
    }
}

/* Framework lifecycle reactor — registers calc with the system-restore
   registry so framework_system_restore.js can re-open this window at boot
   if it was visible in the last session. Also registers the tray icon
   immediately so it's visible in the system tray before the window has
   been lazily created. Clicking the tray icon lazy-creates the window
   (which will adopt this same button via opts.trayButton). */
function component_calc_handle_init() {
    ServiceWindow.registerApp("calc", component_calc_launch);

    if (typeof service_taskbar_register_tray_icon === "function") {
        calcTrayHandle = service_taskbar_register_tray_icon({
            icon:  "C",
            title: "Calc",
            onClick: () => {
                if (!calcContainer) component_calc_create();
                /* After create(), the window's _adoptTrayButton replaced the
                   button's onclick with its own toggle. That new handler
                   isn't running for THIS click (we're already inside the
                   old handler), so explicitly trigger the toggle. */
                calcServiceWindow._toggleFromTray(calcTrayHandle.button);
            }
        });
    }
}
