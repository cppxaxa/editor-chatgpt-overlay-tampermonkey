// -----------------------------------------------------------------------------
// component_calc.js — minimal demo app showing how to build a window with
// ServiceWindow. Two number inputs, a Sum button, and a result label.
//
// Registered with the framework launcher as "C". Lazily creates the window on
// first launch.
// -----------------------------------------------------------------------------

let calcServiceWindow = null;
let calcContainer     = null;

/* Inline SVG calculator: 14x14 viewBox, currentColor strokes so it inherits
   whatever container's text colour (tray button, taskbar running-app
   button, hover state). Body rectangle, a screen, and a 3x3 button grid
   drawn as small dots. Used both as the tray icon and as the running-apps
   icon in the taskbar. */
const CALC_ICON_SVG =
    "<svg width='14' height='14' viewBox='0 0 14 14' " +
    "xmlns='http://www.w3.org/2000/svg' style='display:block'>" +
        "<rect x='2' y='1' width='10' height='12' rx='1.5' " +
        "fill='none' stroke='currentColor' stroke-width='1'/>" +
        "<rect x='3.2' y='2.4' width='7.6' height='2.2' rx='0.4' " +
        "fill='currentColor' opacity='0.75'/>" +
        "<circle cx='4'   cy='6.6'  r='0.6' fill='currentColor'/>" +
        "<circle cx='7'   cy='6.6'  r='0.6' fill='currentColor'/>" +
        "<circle cx='10'  cy='6.6'  r='0.6' fill='currentColor'/>" +
        "<circle cx='4'   cy='8.8'  r='0.6' fill='currentColor'/>" +
        "<circle cx='7'   cy='8.8'  r='0.6' fill='currentColor'/>" +
        "<circle cx='10'  cy='8.8'  r='0.6' fill='currentColor'/>" +
        "<circle cx='4'   cy='11'   r='0.6' fill='currentColor'/>" +
        "<circle cx='7'   cy='11'   r='0.6' fill='currentColor'/>" +
        "<circle cx='10'  cy='11'   r='0.6' fill='currentColor'/>" +
    "</svg>";

function component_calc_launch() {
    if (!calcContainer) component_calc_create();
    calcServiceWindow.show();
}

function component_calc_create() {

    /* Look up the current tray button (may be null if the user has hidden
       the icon via the overflow popup). Pass it through opts.trayButton so
       create() installs the tray-mode patches: hidden min/max, outside-click
       hide, downward tail, defaultClose tail-hide. The registry's onAdopt
       will keep this in sync if the button is later replaced. */
    const trayBtn = (typeof service_taskbar_get_tray_button === "function")
        ? service_taskbar_get_tray_button("calc")
        : null;

    calcServiceWindow = new ServiceWindow();
    calcServiceWindow.create({
        appName: "calc",
        width:  320,
        height: 200,
        isDraggable: () => true,
        isResizable: () => true,
        trayButton: trayBtn   // null is fine — tray patches install on next adopt
    });

    /* If no tray button existed at create() time, install the tray-mode
       behaviour anyway by calling _adoptTrayButton(null) — but we can't
       pass null because the patches need a button to anchor against.
       Instead, the registry's onAdopt handles future button creations.
       For the "hidden at boot" case the user can re-show via overflow. */

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

    if (typeof service_taskbar_register_tray_app === "function") {
        service_taskbar_register_tray_app({
            appName: "calc",
            label:   "Calc",
            icon:    CALC_ICON_SVG,
            title:   "Calculator",
            onClick: (btn) => {
                if (!calcContainer) component_calc_create();
                calcServiceWindow._toggleFromTray(btn);
            },
            /* Called on initial registration AND every time the user
               re-shows the icon via the overflow popup (the DOM node
               changes each time). Tell the live ServiceWindow about the
               new button so its outside-click handler and tray-click
               wiring stay in sync. */
            onAdopt: (btn) => {
                if (calcServiceWindow) {
                    calcServiceWindow._adoptTrayButton(btn, null);
                }
            }
        });
    }
}
