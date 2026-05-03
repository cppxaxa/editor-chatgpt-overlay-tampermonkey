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
src/
  header.js                      # ==UserScript== banner + IIFE open + 'use strict'
  framework.js                   # global state + framework_init() bootstrap
  framework_scrollbars.js        # framework-level scrollbar styling
  framework_kiosk.js             # handle_kiosk() bootstrap reader (calls component_kiosk())
  component_kiosk.js             # component_kiosk() — auto-open + maximize when
                                 #   localStorage["kiosk"] === "true" (set by run_app.go)
  component_launcher.js          # the floating "E" button (createLauncher)
  component_window.js            # container/header/min/max/close + drag + resize +
                                 #   geometry persistence + master createEditor() wiring
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
3. All other `src/*.js` (i.e. every `component_*.js`) — sorted alphabetically
4. `src/footer.js` — always last

Because everything ends up inside the same IIFE, **JavaScript function-declaration hoisting means source-file order does not matter at runtime**. Any component file can call any function declared in any other component file. State variables (`let`/`const`) live in `framework.js` so they are declared before any component file runs.

### Runtime architecture (within the concatenated IIFE)

- **Global state** at the top of `framework.js` — DOM refs (`container`, `textarea`, `headerEl`, `columnContainer`, `leftTA`, `rightTA`, tab buttons, tab content elements), tab system vars (`activeTab`, per-tab caches), undo/redo stacks, per-tab cursor/scroll state (`tabState`).
- **`framework_init()`** in `footer.js` calls `createLauncher() + registerLineReaderHotkey() + window.onresize + style injection + handle_kiosk()`. This is the only entry point.
- **`createEditor()`** in `component_window.js` is the master DOM builder — it constructs the floating window, header, tabs, action buttons, main textarea, two column textareas, ascii/question/snippets textareas, S-Preview iframe, and wires the min/max/close/drag/resize handlers. It is called lazily on first launcher click.
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
- **State persistence** — Editor content in `localStorage["tm_editor_content"]`, window geometry/mode in `localStorage["tm_editor_window_state"]`, tab caches in `localStorage["tm_ascii_cache"]` etc.

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

This is a two-step refactor of the original monolithic `ChatGPT Floating Scratchpad.js`:

- **Step 1 (DONE):** Split the monolith into per-component files under `src/`, with a Go concatenator that reproduces the working script. Original function names (`createEditor`, `simpleHash`, `handleLineAction`, …) are preserved so `dist/source.js` is line-for-line equivalent to the monolith. This makes diffing easy if a port introduces a regression.
- **Step 2 (PLANNED):** Rename functions to the `framework_*` / `framework_internal_*` / `component_<name>_<suffix>()` scheme described in `PROPOSAL.md`. Each component will expose only the suffixed public interface (`_draw`, `_register_hotkeys`, `_register_events`, `_load_state`, `_save_state`, `_action_*`). State variables will move from `framework.js` into the owning component files. See `PROPOSAL.md` and `PLAN.md` for the target architecture.

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

- Lazy-creates the editor via `createEditor()` and shows the container (same as the launcher button).
- Maximizes the window if it isn't already, by clicking the `□` button (located by text-content scan within `container`); falls back to inlining the same state transitions as `maxBtn.onclick` if the button isn't found.
- Calls `redistributeColumns()` (the launcher does the same when restoring a maximized session — splitting columns requires a non-zero `offsetHeight`).

Adding more boot-time behaviour controlled by `appsettings.json`: define a new property in `appsettings.json` `properties`, then add a corresponding `handle_*()` reader in `framework_kiosk.js` (or its own file) and call it at the end of `framework_init()`.
