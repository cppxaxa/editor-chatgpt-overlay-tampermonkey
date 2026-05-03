# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A TamperMonkey userscript ("ChatGPT Floating Scratchpad") that injects a floating code editor overlay onto `chatgpt.com`. The editor can send prompts directly to ChatGPT via DOM automation and display responses inline.

**GitHub:** https://github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey

## Architecture

The project is a vanilla-JS IIFE (~2200 lines) split into per-component files under `src/` and concatenated into a single Tampermonkey script by a small Go-based build tool. No external runtime dependencies, no frameworks, no build step beyond the concatenator.

### File layout

```
ChatGPT Floating Scratchpad.js   # legacy monolith — kept for reference until refactor stabilises
build.go                         # concatenator (Go stdlib only, no modules)
build.sh / build.cmd             # one-line wrappers around `go run build.go`
run_app.go                       # standalone launcher (chrome + DevTools injection of dist/source.js)
appsettings.json                 # config consumed by run_app.go (chrome path, port, properties)
dist/source.js                   # generated; the file you paste into Tampermonkey
PLAN.md                          # ServiceWindow extraction plan (executed; kept as a record)
src/
  header.js                      # ==UserScript== banner + IIFE open + 'use strict'
  framework.js                   # framework_init() bootstrap +
                                 #   framework_register_launcher() (registers the "E" launcher) +
                                 #   lifecycle hooks (framework_on_init,
                                 #   framework_on_launcher_registered, framework_on_window_resized)
  framework_scrollbars.js        # framework-level scrollbar styling
  framework_kiosk.js             # handle_kiosk() bootstrap reader (calls component_kiosk())
  framework_launcher.js          # framework_launcher_register(text, onlaunch) — registry for
                                 #   floating bottom-left launcher buttons; multiple registrations
                                 #   stack vertically
  service_window.js              # ServiceWindow class — generic floating-window mechanics:
                                 #   .create(opts), .registerTab({id,label,title,onClick}),
                                 #   .registerAction({label,title,onClick,html,style}),
                                 #   .setActiveTabHighlight(id), .appendControls(),
                                 #   instance state: .container, .headerEl, .tabBarEl,
                                 #   .actionBarEl, .minBtn/.maxBtn/.closeBtn, .resizeHandle,
                                 #   .mode ("normal"|"maximized"|"minimized"), .previousBounds.
                                 #   Plus parameter-pure helpers: service_window_make_draggable,
                                 #   service_window_create_resize_handle, service_window_center,
                                 #   service_window_persist_geometry / _restore_geometry.
                                 #   Open/close animation: _playOpenAnim()/_playCloseAnim(done)
                                 #   scale + fade from a fixed bottom-center origin (120ms /
                                 #   100ms). Auto-played by show()/hide(). Honours
                                 #   prefers-reduced-motion.
                                 #   Tray-mode (opts.tray / opts.trayButton / opts.trayHandle):
                                 #   _adoptTrayButton hides min/max, installs an outside-click
                                 #   hider, builds a downward triangular tail anchored to the
                                 #   tray icon, and patches defaultClose to hide the tail.
                                 #   _toggleFromTray(btn) shows + snaps the window above the
                                 #   tray button (or hides if already visible). Re-adoption is
                                 #   idempotent so the registry can swap buttons when the user
                                 #   hides/re-shows the icon.
  service_taskbar.js             # KDE/Ubuntu desktop shell — wallpaper, bottom taskbar,
                                 #   Start menu, running-apps tracker, system tray, clock.
                                 #   Patches ServiceWindow.show/hide/defaultMinimize/Maximize
                                 #   to track open windows in the running-apps list. Also hosts:
                                 #     service_taskbar_register_tray_app({appName,label,icon,
                                 #       title,onClick,onAdopt}) — high-level tray registry.
                                 #       Persists hidden state in localStorage["tm_tray_hidden_apps"];
                                 #       onAdopt(btn) fires every time a fresh button is created
                                 #       (initial registration AND each unhide) so callers can
                                 #       call ServiceWindow._adoptTrayButton on the new node.
                                 #     service_taskbar_register_tray_icon — low-level: just
                                 #       creates a tray button. Most apps should use the
                                 #       _register_tray_app variant instead.
                                 #     service_taskbar_get_tray_button(appName) — live button
                                 #       lookup (null if hidden). Used by component_*_create
                                 #       paths to wire ServiceWindow tray-mode at create time.
                                 #     service_taskbar_list_tray_apps() — read-only registry
                                 #       snapshot (used by orphan cleanup).
                                 #   The up-arrow in the right-side cluster opens a glass popup
                                 #   listing every registered tray app with: search input,
                                 #   Launch button, and a Show-in-tray toggle. Toggle flips
                                 #   recreate/remove the underlying icon synchronously.
  framework_orphan_cleanup.js    # framework_orphan_cleanup() — one-shot sweep called at the
                                 #   END of framework_on_init (after every component has
                                 #   registered). Removes:
                                 #     - "tm_window_<appName>" entries whose appName isn't in
                                 #       ServiceWindow._apps.
                                 #     - "tm_tray_hidden_apps" entries whose appName isn't in
                                 #       service_taskbar_list_tray_apps().
                                 #   Does NOT touch tab caches (tm_*_cache) or unknown keys.
                                 #   Logs a one-line summary via console.log when non-zero.
  component_kiosk.js             # component_kiosk() — auto-open + maximize when
                                 #   localStorage["kiosk"] === "true" (set by run_app.go)
  component_window.js            # editorServiceWindow (= new ServiceWindow) +
                                 #   createEditor() that wires tabs/actions into it +
                                 #   editor-specific min/max/close handler bodies +
                                 #   saveEditorState / restoreEditorState
  component_editor.js            # shared keydown handling (attachEditorKeydown)
  component_columns.js           # two-column layout for maximized mode
  component_tabbar.js            # tab switching + simpleHash + getEditorContent +
                                 #   regenerateCurrentTab + per-tab cursor/scroll persistence
  component_yieldframe.js        # yieldFrame() helper — await two rAFs so the browser can paint
  service_undoredo.js            # UndoRedoStack class + editorUndoRedoStack singleton
                                 #   (.pushUndo, .pushUndoDebounced, .doUndo, .doRedo)
  component_waitingui.js         # spinner + Cancel button (showWaitingUI / hideWaitingUI).
                                 #   Cancel calls flushLlmQueue() then waitAbortController.abort()
  service_dialog.js              # generic modal dialog service (showResultDialog) — reusable
  service_llm.js                 # LLM service: ChatGPT DOM automation +
                                 #   sendMessage(prompt) (single-shot, internal-only) +
                                 #   submitMessage(prompt, onstart, onend) (FIFO queue, one job
                                 #   at a time) + flushLlmQueue() (drop pending jobs)
  component_linecommand.js       # /p and /r commands + global hotkey dispatcher
                                 #   (handleLineAction, registerLineReaderHotkey, applyIndent)
  component_codecheck.js         # Alt+C code review with ⭐ marker insertion
  component_tab_ascii.js         # generateAsciiDiagram
  component_tab_question.js      # generateQuestion
  component_tab_snippets.js      # generateSnippets
  component_tab_spreview.js      # generateSpreview + setSpreviewContent
  footer.js                      # framework_init(); IIFE close
```

### How concatenation works

`build.go` writes `dist/source.js` (and copies the same content to the system clipboard) by reading `src/*.js` in this order:

1. `src/header.js` — always first
2. `src/framework.js` — always second
3. All other `src/*.js` (i.e. every `component_*.js` and `service_*.js`) — sorted alphabetically
4. `src/footer.js` — always last

Because everything ends up inside the same IIFE, **JavaScript function-declaration hoisting means source-file order does not matter at runtime**. Any component file can call any function declared in any other component file. State variables (`let`/`const`) live in the file that owns them; cross-component reads go through public function calls or instance properties (e.g. `editorServiceWindow.mode`).

### Runtime architecture (within the concatenated IIFE)

- **`framework_init()`** in `footer.js` is the only entry point. It calls `framework_register_launcher()`, attaches `window.addEventListener("resize", framework_on_window_resized)`, runs `framework_on_init()`, then `framework_orphan_cleanup()`, then `handle_kiosk()` and `handle_system_restore()`. The cleanup must run AFTER `framework_on_init` so every component has registered with `ServiceWindow._apps` and the tray-app registry — otherwise live entries would be wrongly classified as orphaned.
- **Lifecycle hooks** in `framework.js` (`framework_on_init`, `framework_on_launcher_registered`, `framework_on_window_resized`) are literal lists of components that react to a framework-level moment. The framework does not reach into component state directly; instead each component exposes `component_<name>_handle_<event>()` and the hook calls it. To add a reactor, append one line to the relevant hook.
- **`ServiceWindow` (`service_window.js`)** is a generic floating-window class. `editorServiceWindow = new ServiceWindow()` is the single instance held in `component_window.js`. The class owns:
  - DOM construction: container `<div>`, 36px header, tab bar slot, action bar slot, min/max/close cluster, resize handle.
  - Drag wiring (header → container) and resize wiring (resize handle → container) via parameter-pure helpers (`isDraggable()`, `isResizable()`, `onDragEnd()`, `onResizeEnd()` callbacks).
  - Per-instance state: `.mode` ("normal" | "maximized" | "minimized"), `.previousBounds`, `.tabBarEl`, `.actionBarEl`, `.container`, `.headerEl`, `.resizeHandle`, `.minBtn`/`.maxBtn`/`.closeBtn`.
  - Tab/action registration: `.registerTab({id,label,title,onClick})` appends a styled tab button (first registered tab is auto-highlighted); `.registerAction({label,title,onClick,html,style})` appends an action button (text or SVG icon, optional style override). `.setActiveTabHighlight(id)` updates which tab button looks active.
  - `.appendControls()` is called by the caller after it has populated its own header content so the min/max/close cluster ends up at the right edge.
  - **Open/close animation:** every `show()` plays `_playOpenAnim()` (scale 0.85→1 + opacity 0→1 over 120ms) and every `hide()` plays `_playCloseAnim(done)` (scale 1→0.9 + opacity 1→0 over 100ms, then sets `display:none` in `done`). Origin is fixed at `"50% 100%"` (bottom-center / taskbar area) — no per-launcher anchoring. Honours `prefers-reduced-motion` by skipping the transform entirely. Transform / transformOrigin / opacity are cleared after the animation so drag, resize, and the tray-tail positioning math see a clean container. `_animTimer` cancels an in-flight close if the user re-opens the window mid-animation.
  - The class has **no knowledge of the editor's tabs, content elements, or windowMode semantics specific to this app** — those live in the caller's onClick handlers and in `component_window.js`'s min/max/close button bodies.
- **System tray apps (`service_taskbar.js`)** — A second-class window pattern: instead of a launcher button, the app registers a tray icon via `service_taskbar_register_tray_app({appName, label, icon, title, onClick, onAdopt})`. Click toggles the window. Tray-mode windows are popups: min/max are hidden, the cyan focus border is suppressed, the window snaps above the tray icon on every show with a downward triangular tail decoration anchored to the icon, and any outside-click hides the window (timers/state preserved). The user can hide individual tray icons via the up-arrow overflow popup; `onAdopt(btn)` re-fires every time a fresh button is created (initial registration AND each unhide) so the owning component can call `ServiceWindow._adoptTrayButton` on the new DOM node. `component_calc.js` is the canonical example. Hidden state persists in `localStorage["tm_tray_hidden_apps"]`.
- **Orphan cleanup (`framework_orphan_cleanup.js`)** — Runs once at the end of `framework_on_init` (after every component has registered). Removes `tm_window_<appName>` entries whose `appName` is no longer in `ServiceWindow._apps`, and prunes `tm_tray_hidden_apps` entries no longer in `service_taskbar_list_tray_apps()`. Does NOT touch tab caches or unknown keys. Logs a one-line summary via `console.log` only when something was actually removed. Add new prefixes here when you introduce new per-app keys.
- **`createEditor()`** in `component_window.js` is the master DOM wirer: it instantiates `editorServiceWindow`, calls `.create()`, then calls `.registerTab` × 5 (Editor / Ascii / Question / Snippets / S-Preview) and `.registerAction` × 4 (↻ / Command / Check / GitHub). It then builds the editor's own content elements (main textarea, two column textareas, ascii/question/snippets textareas, S-Preview iframe), wires the min/max/close `onclick` bodies (these still know about editor-specific tab content elements), and calls `.appendControls()`. Called lazily on first launcher click.
- **Tab system** — five tabs (Editor, Ascii design, Question, Snippets, S-Preview). Each generated tab caches `{ hash, content }` in both memory and localStorage. `simpleHash` (djb2) detects code changes; regeneration only happens when hash differs (or explicitly via Alt+R which clears the cache first).
- **S-Preview** uses an iframe with `srcdoc` for isolated syntax-highlighted HTML rendering. `setSpreviewContent` injects a CSS reset to preserve indentation.
- **Inline commands** — `/p <prompt>` sends prompt with full numbered editor context; `/r <prompt>` sends raw prompt. Response replaces the command line in-place. `applyIndent` normalizes indentation (strips common leading whitespace from lines 2+, since `extractCleanText` trims the first line).
- **Code Check** — sends editor content requesting structured JSON review. Parses response, shows result dialog, inserts `⭐` markers at issue locations. Caches results by code hash.
- **Waiting UI** — `showWaitingUI` replaces the action buttons area (`tm-action-btns`) with spinner + Cancel button. `hideWaitingUI` restores the buttons by saving/restoring `_savedHTML` and re-attaching click handlers by matching button text content.
- **ChatGPT DOM automation** — `insertTextIntoChatGPT` types via `execCommand`; `waitForSendButton` polls for send button; `waitForAssistantResponse` watches for new assistant messages (two-phase: wait for new message, then wait for streaming to stop). All of this lives in `service_llm.js`.
- **LLM job queue (`service_llm.js`)** — All component-level LLM calls go through `submitMessage(prompt, onstart, onend)`, which enqueues a job and processes the queue strictly one-at-a-time:
  - `onstart(ctx)` is invoked when the job actually leaves the queue and is about to be dispatched to ChatGPT — this is the right place to set up `waitAbortController` and call `showWaitingUI()`.
  - `onend(ctx)` is invoked when the job finishes (success, error, or cancel). `ctx = { prompt, result, error, cancelled }`. Tear down UI state here.
  - `submitMessage` returns a Promise that resolves with the same `ctx` passed to `onend`, so callers may `await` it instead of (or in addition to) using callbacks.
  - `flushLlmQueue()` drops every PENDING job, calling each one's `onend({ cancelled: true })` and resolving its promise. The currently-running job is NOT touched — it is interrupted via the existing `waitAbortController.abort()` path.
  - Cancel button (`component_waitingui.js`) calls `flushLlmQueue()` then `waitAbortController.abort()`. **Tab switching does NOT cancel jobs** — generations run to completion in the background, and their `onend` writes to the cache regardless of which tab is active (the textarea-write step is gated on `activeTab === "<owner>"` so the user only sees a visible update if they're still on the relevant tab).
  - `sendMessage(prompt)` is internal — only the queue drain calls it. New code should always use `submitMessage`.
- **Response cleaning** (`extractCleanText`) — clones response DOM, strips sticky headers/copy buttons, extracts CodeMirror content preserving line breaks, removes markdown fences. **Note:** returns trimmed text, so first line loses leading whitespace — `applyIndent` accounts for this.
- **State persistence** — Editor content in `localStorage["tm_editor_content"]`, window geometry/mode in `localStorage["tm_editor_window_state"]` (the JSON payload still uses the legacy field name `windowMode` for backward compat with already-saved sessions, even though the live state is now on `editorServiceWindow.mode`), tab caches in `localStorage["tm_ascii_cache"]` etc.

### Hotkeys

- `Alt+1-5` — Switch tabs (Editor, Ascii design, Question, Snippets, S-Preview)
- `Alt+I` — Execute line command (/p or /r)
- `Alt+C` — Code check
- `Alt+R` — Regenerate current tab
- `Ctrl+Z` / `Ctrl+Y` — Undo/redo (Editor tab only)

### Tab Behavior

- **Editor** — Main code editor. Supports maximized two-column layout.
- **Ascii design** — Does NOT auto-generate. Shows cached content (when hash matches) or prompts user to press Alt+R.
- **Question** — Does NOT auto-generate. Shows cached content or prompts user to press Alt+R.
- **Snippets** — Does NOT auto-generate. Editable textarea (not read-only) for cursor/copy convenience. When generated, includes missing/stub function implementations from the code plus generic algorithm helpers in `class Helper`.
- **S-Preview** — Does NOT auto-generate. Shows cached syntax-highlighted HTML in an iframe (when hash matches) or prompts user to press Alt+R. Prompt requests IDE-quality highlighting with per-variable pastel colors, bold for core algorithmic data structure variables, WCAG AA accessible palette.

No tab regenerates automatically on tab switch. The cached `{hash, content}` is shown when the hash still matches the current editor code; otherwise a hint message asks the user to press Alt+R / click ↻ to regenerate. Alt+R always clears the cache then calls the appropriate `generate*` function.

### Caching strategy

Each generated tab caches `{ hash, content }` in both memory and localStorage. `simpleHash` (djb2) detects code changes. Cache is checked on tab switch; regeneration only happens when hash differs (or explicitly via Alt+R which clears the cache first).

## Development workflow

There is no test pipeline yet. To develop:

1. Edit any file under `src/`.
2. Run `./build.sh` (Linux/macOS/Git Bash) or `build.cmd` (Windows), or `go run build.go`.
3. The concatenator writes `dist/source.js` and copies the same content to the clipboard.
4. Paste into the TamperMonkey editor on `chatgpt.com` and save.
5. Reload `chatgpt.com` to test.

`node --check dist/source.js` is a quick syntax sanity-check before pasting.

### Refactoring status

The codebase has been through three migrations:

- **Step 1 (DONE):** Split the monolith `ChatGPT Floating Scratchpad.js` into per-component files under `src/`, with a Go concatenator that reproduces the working script. Original function names (`createEditor`, `simpleHash`, `handleLineAction`, …) were preserved so `dist/source.js` is line-for-line equivalent to the monolith. Diffing remains easy if a port introduces a regression.
- **Step 2 (DONE):** Introduced framework lifecycle hooks (`framework_on_*`) so the framework no longer reaches into component state. Each component now exposes `component_<name>_handle_<event>()` reactors that the hook calls. Component init work (e.g. `component_waitingui_handle_init`, `component_linecommand_handle_init`) was moved out of `framework.js`.
- **Step 3 (DONE — see `PLAN.md`):** Extracted generic floating-window mechanics into a `ServiceWindow` class (`src/service_window.js`). The window component now instantiates `editorServiceWindow = new ServiceWindow()`, registers tabs and actions through it, and stores `mode`/`previousBounds` as instance properties. `component_window.js` shrank from ~680 lines of mixed concerns to ~470 lines focused on editor-specific wiring. A second floating window in the future is `new ServiceWindow({...}); .create(); .registerTab(...)`.

When working on this codebase, prefer **editing the per-component files under `src/`**, not the legacy monolith. Run the build after every meaningful change.

## Key conventions

- All UI is constructed via `document.createElement` + `Object.assign(el.style, {...})` — no HTML templates or CSS classes (except a few class names used as selectors: `tm-wait-indicator`, `tm-cancel-btn`, `tm-action-btns`, `tm-tab-bar`).
- ChatGPT DOM selectors are hardcoded (e.g., `#prompt-textarea`, `[data-testid="send-button"]`, `[data-message-author-role="assistant"]`) — these break when ChatGPT updates its UI.
- The `waitAbortController` / `AbortController` pattern is used for cancellable async operations (waiting spinner + Cancel button).
- Content is always saved through `localStorage.setItem` after mutations; in maximized mode, `saveMergedContent()` merges both columns first.
- The `showWaitingUI`/`hideWaitingUI` pair saves/restores action button HTML via `_savedHTML` property and re-attaches onclick handlers by matching button text content.
- The `syncing` guard prevents recursive `redistributeColumns` calls during column content updates.
- Tab textareas for Ascii/Question are `readOnly`; Snippets is editable; S-Preview uses an iframe with `sandbox="allow-same-origin"`.

### localStorage keys

- `tm_editor_content` — Editor text
- `tm_editor_window_state` — Window geometry, mode, previousBounds
- `tm_ascii_cache` — Ascii design tab cache
- `tm_question_cache` — Question tab cache
- `tm_snippets_cache` — Snippets tab cache
- `tm_spreview_cache` — S-Preview tab cache
- `tm_window_<appName>` — Per-window geometry/mode/visibility (auto-persisted by ServiceWindow)
- `tm_tray_hidden_apps` — JSON array of `appName`s the user has hidden from the system tray via the up-arrow overflow popup. Apps not in the list are visible by default. Stale entries are pruned by `framework_orphan_cleanup` on each page load.
- `tm_taskbar_shell_hidden` — `"true"` when the user has dismissed the desktop shell via Start menu → "Hide desktop shell"

## The build tool (`build.go`)

Stdlib-only Go program. Per-OS clipboard handling:
- **Windows** → pipes to `clip.exe`
- **macOS** → `pbcopy`
- **Linux** → tries `wl-copy`, then `xclip`, then `xsel`

If clipboard fails, `dist/source.js` is still written and the program exits with code 2 + a stderr message. The user can paste from the file in that case.

To rebuild as a native binary (optional, avoids the `go run` startup cost):

```
go build -o build.exe build.go     # Windows
go build -o build build.go          # Linux/macOS
```

## Standalone launcher (`run_app.go`)

Stdlib-only Go program that automates "open chrome → wait → inject `dist/source.js`". Reads `appsettings.json` and:

1. Resolves a chrome binary from `chromepath` (each entry may be a directory or full path; platform-specific binary name is appended for directories).
2. Picks `chromeport`, falling back to an OS-assigned free port if the configured one is unbindable.
3. Launches chrome with `--app=https://chatgpt.com`, `--remote-debugging-port`, `--remote-allow-origins=*`, and a sandboxed `--user-data-dir=chrome-profile/`.
4. Polls `http://localhost:<port>/json` for a `chatgpt.com` page target, fetches its `webSocketDebuggerUrl`.
5. Waits 10s, then polls `document.readyState` until `"complete"`.
6. Injects a centered `#tm-booting-splash` div via `Runtime.evaluate` and verifies it appears in the DOM.
7. Calls `injectPropertiesIntoLocalStorage` — iterates every key under `appsettings.json` `properties` and sets each via `window.localStorage.setItem(key, value)`. Strings are stored as raw text; non-strings are JSON-encoded.
8. Sends `dist/source.js` via a single `Runtime.evaluate` over a minimal RFC 6455 WebSocket client (no external deps).
9. Removes the booting splash.

The minimal WebSocket client supports only what's needed: TCP `ws://`, single masked text frames, ping→pong, no fragmentation, no `wss`/TLS.

### `appsettings.json`

```json
{
  "chromepath": ["C:\\Program Files\\Google\\Chrome\\Application"],
  "chromeport": 9222,
  "properties": { "kiosk": true },
  "app": "chrome"
}
```

`properties` is a generic map — anything you put here ends up in the page's `localStorage` before `source.js` runs, so the userscript can read user-configured behaviour at boot time.

### Kiosk mode

`framework_init()` calls `handle_kiosk()` (in `src/framework_kiosk.js`) at the end of bootstrap. If `localStorage.getItem("kiosk") === "true"` it runs `component_kiosk()` which:

- Calls `component_window_launch()` (lazy-creates the editor via `createEditor()` and shows the container — same as the launcher button does).
- Maximizes the window if it isn't already, by clicking the `□` button (located by text-content scan within `container`); falls back to inlining the same state transitions as `maxBtn.onclick` if the button isn't found, mutating `editorServiceWindow.mode` / `.previousBounds` directly.
- Calls `redistributeColumns()` (the launcher does the same when restoring a maximized session — splitting columns requires a non-zero `offsetHeight`).

Adding more boot-time behaviour controlled by `appsettings.json`: define a new property in `appsettings.json` `properties`, then add a corresponding `handle_*()` reader in `framework_kiosk.js` (or its own file) and call it at the end of `framework_init()`.
