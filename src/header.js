// ==UserScript==
// @name         ChatGPT Floating Scratchpad
// @namespace    https://github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey
// @version      0.1.0
// @description  Floating code editor overlay for chatgpt.com with prompt automation, code review, and tabbed generated views.
// @author       cppxaxa
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // ChatGPT Floating Scratchpad — entry point
    //
    // This file is the FIRST chunk concatenated by build.go. It opens the IIFE
    // and declares 'use strict'. All component_* and framework_* functions
    // declared in subsequent files share this scope. The IIFE is closed in
    // src/footer.js.
    // -------------------------------------------------------------------------
