// -----------------------------------------------------------------------------
// framework_scrollbars.js — injects a minimalist black-theme scrollbar style
// into the host page. Targets WebKit/Blink (Chrome) via `::-webkit-scrollbar`
// pseudo-elements and also sets the standardised `scrollbar-color` /
// `scrollbar-width` properties as a fallback.
//
// Called from framework_init() after the @keyframes style is injected.
// -----------------------------------------------------------------------------

function framework_scrollbars_inject() {
    // Avoid double-injection if framework_init() is somehow called twice.
    if (document.getElementById("tm-scrollbar-style")) return;

    const style = document.createElement("style");
    style.id = "tm-scrollbar-style";
    style.textContent = `
        /* Standards-compliant (Firefox + modern Chromium) */
        * {
            scrollbar-width: thin;
            scrollbar-color: #2a2a2a #000000;
        }

        /* WebKit / Blink (Chrome, Edge, Opera) */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
            background: #000000;
        }
        ::-webkit-scrollbar-track {
            background: #000000;
            border: none;
        }
        ::-webkit-scrollbar-thumb {
            background: #2a2a2a;
            border-radius: 4px;
            border: none;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: #3d3d3d;
        }
        ::-webkit-scrollbar-thumb:active {
            background: #4d4d4d;
        }
        ::-webkit-scrollbar-corner {
            background: #000000;
        }
        /* Hide the up/down arrow buttons for a flat, minimalist look */
        ::-webkit-scrollbar-button {
            display: none;
            width: 0;
            height: 0;
        }
    `;
    document.head.appendChild(style);
}
