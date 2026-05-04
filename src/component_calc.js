// -----------------------------------------------------------------------------
// component_calc.js — minimal demo app showing how to build a window with
// ServiceWindow. Two number inputs, a Sum button, and a result label.
//
// Registered as a normal Start-menu app (not a tray app). Lazily creates
// the window on first launch.
// -----------------------------------------------------------------------------

let calcServiceWindow = null;
let calcContainer     = null;

function component_calc_launch() {
    if (!calcContainer) component_calc_create();
    calcServiceWindow.show();
}

function component_calc_create() {

    calcServiceWindow = new ServiceWindow();
    calcServiceWindow.create({
        appName: "calc",
        width:  320,
        height: 200,
        shell:  shell,
        isDraggable: () => true,
        isResizable: () => true
    });

    calcServiceWindow.registerTab({ id: "calc", label: "Calc" });

    /* Min/max/close cluster — defaults from ServiceWindow are fine for a
       minimal demo (close hides the container; max toggles fullscreen; min
       collapses to header height). No wiring needed here. */
    calcServiceWindow.appendControls();

    calcContainer = calcServiceWindow.container;

    /* Body */
    const body = calcServiceWindow.createBody();

    const inputA = calcServiceWindow.createTextbox("a", "operand1");
    inputA.type = "number";

    const inputB = calcServiceWindow.createTextbox("b", "operand2");
    inputB.type = "number";

    const resultLabel = calcServiceWindow.createLabel("Result: —", "result");

    const sumBtn = calcServiceWindow.createPrimaryButton("Sum", "sum");

    sumBtn.onclick = () => {
        const a = parseFloat(inputA.value) || 0;
        const b = parseFloat(inputB.value) || 0;
        resultLabel.textContent = "Result: " + (a + b);
    };

    body.appendChild(inputA);
    body.appendChild(inputB);
    body.appendChild(sumBtn);
    body.appendChild(resultLabel);

    /* Shell API needs a rescan — body elements were added after appendControls. */
    calcServiceWindow.refreshShellAPI();

    /* Restore previously saved geometry/mode; otherwise center. */
    if (!calcServiceWindow.restoreState()) {
        service_window_center(calcContainer, 320, 200);
    }
}

/* Framework lifecycle reactor — registers calc with the system-restore
   registry so framework_system_restore.js can re-open this window at boot
   if it was visible in the last session. */
function component_calc_handle_init() {
    ServiceWindow.registerApp("calc", component_calc_launch);
}
