# ChatGPT Floating Scratchpad

A Tampermonkey userscript that adds a floating, resizable text editor overlay to [ChatGPT](https://chatgpt.com) with built-in prompt automation.

![Tampermonkey](https://img.shields.io/badge/Tampermonkey-Userscript-green)
![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-yellow)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **Floating Editor** — A draggable, resizable scratchpad that sits on top of ChatGPT
- **Dark Theme** — Matches ChatGPT's aesthetic with a monospace code-friendly font
- **Window Controls** — Minimize, maximize, and close buttons just like a real window
- **Persistent State** — Editor content, position, and size are saved across page reloads
- **ChatGPT Prompt Automation** — Send prompts to ChatGPT directly from the editor and capture responses inline
- **Code Check** — Review your code for correctness via ChatGPT with a single shortcut
- **Smart Indentation** — Auto-indent on Enter, Tab inserts 4 spaces, Shift+Tab removes indentation
- **Waiting UI** — Spinner and cancel button in the titlebar while waiting for ChatGPT responses

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click **Create a new script** in the Tampermonkey dashboard
3. Copy and paste the contents of [`ChatGPT Floating Scratchpad.js`](ChatGPT%20Floating%20Scratchpad.js) into the editor
4. Save the script (<kbd>Ctrl</kbd>+<kbd>S</kbd>)
5. Navigate to [chatgpt.com](https://chatgpt.com) — you'll see a small **"E"** button in the bottom-left corner

## Usage

### Opening the Editor

Click the **"E"** launcher button at the bottom-left of the ChatGPT page. The floating editor window will appear.

### Window Controls

| Button | Action |
|--------|--------|
| **—** (Minimize) | Collapses the editor to just its title bar. Click again to restore. |
| **□** (Maximize) | Expands the editor to fill the entire screen. Click again to restore. |
| **×** (Close) | Hides the editor. Click the "E" launcher to reopen. |

You can also **drag** the title bar to reposition the window, and **drag the bottom-right corner** to resize it.

---

### `/p` — Prompt Command

The `/p` command lets you send a prompt to ChatGPT directly from the editor and replace the line with the response.

**How to use:**

1. In the editor, type a line starting with `/p ` followed by your prompt:
   ```
   /p What is the capital of France?
   ```
2. Place your cursor on that line
3. Press <kbd>Alt</kbd>+<kbd>I</kbd> to execute

**What happens:**
- The text after `/p ` is sent to ChatGPT as a prompt
- The script waits for ChatGPT to finish generating its response
- The entire `/p ...` line is replaced with ChatGPT's response directly in the editor

This lets you build up notes, Q&A pairs, or chain prompts without ever leaving the scratchpad.

---

### <kbd>Alt</kbd>+<kbd>I</kbd> — Execute Current Line

<kbd>Alt</kbd>+<kbd>I</kbd> is the keyboard shortcut that triggers the action for the current line under the cursor.

**Behavior:**
- **If the line starts with `/p `** — the prompt is sent to ChatGPT and the line is replaced with the response (see above)
- **If the line is regular text** — the line content is shown in an alert popup (useful for quick previewing)

> **Note:** The editor textarea must be focused for <kbd>Alt</kbd>+<kbd>I</kbd> to work.

---

### <kbd>Alt</kbd>+<kbd>C</kbd> — Code Check

<kbd>Alt</kbd>+<kbd>C</kbd> sends the entire editor content to ChatGPT for a code review and displays the result in a dialog.

**How to use:**

1. Write or paste your code into the editor
2. Press <kbd>Alt</kbd>+<kbd>C</kbd> while the editor is focused

**What happens:**
- The editor content is sent to ChatGPT with a prompt requesting a structured JSON review
- The titlebar shows a ⟳ spinner and a **Cancel** button while waiting (Cancel stops the editor's wait only — ChatGPT continues independently)
- ChatGPT responds with a JSON object containing:
  - **correct** — whether the code is syntactically and logically correct
  - **solves_problem** — whether the code solves the problem it appears to be targeting
  - **summary** — a one-line description of what the code does
  - **issues** — a list of problems found (empty if none)
  - **suggestions** — improvement recommendations (empty if none)
- The JSON is parsed and displayed in a formatted dialog:

```
Correct: ✅ Yes
Solves the problem: ❌ No

Summary:
  Implements FizzBuzz but misses the edge case for n=0

Issues:
  1. No handling for n <= 0

Suggestions:
  1. Add input validation for non-positive numbers
```

> If ChatGPT doesn't return valid JSON, the raw response is shown as a fallback.

---

### Example Workflow

```
/p Summarize the key differences between TCP and UDP
/p Write a Python function to check if a string is a palindrome
/p Explain the CAP theorem in simple terms
```

Place your cursor on any line and press <kbd>Alt</kbd>+<kbd>I</kbd>. The `/p ...` line will be replaced with ChatGPT's full response. You can then continue editing, add follow-up prompts, and build a working document.

## Keyboard Shortcuts

| Shortcut | Context | Action |
|----------|---------|--------|
| <kbd>Alt</kbd>+<kbd>I</kbd> | Editor focused | Execute current line (`/p` prompt or alert) |
| <kbd>Alt</kbd>+<kbd>C</kbd> | Editor focused | Send editor content for code review |
| <kbd>Tab</kbd> | Editor focused | Insert 4 spaces |
| <kbd>Shift</kbd>+<kbd>Tab</kbd> | Editor focused | Remove up to 4 leading spaces from the current line |
| <kbd>Enter</kbd> | Editor focused | New line with auto-indent matching the current line |

## How It Works

The script injects a floating editor UI into ChatGPT's page. When you trigger a `/p` command:

1. The script snapshots the current number of assistant messages
2. The prompt text is inserted into ChatGPT's input box and sent
3. It waits for a **new** assistant message to appear (count increases)
4. It waits for ChatGPT's **stop button to disappear** (streaming complete)
5. After a short grace period, the final response text is captured
6. Code blocks are cleaned — language labels and copy buttons are stripped, line breaks are preserved
7. The original `/p` line in the editor is replaced with the response, inheriting the line's indentation

All editor state (content, position, size, window mode) is persisted in `localStorage`.

## Technical Details

- **Single file** — No dependencies, no build step, no frameworks
- **Runtime** — Executes at `document-idle` via Tampermonkey
- **Storage** — Uses `localStorage` (`tm_editor_content` for text, `tm_editor_window_state` for window state)
- **ChatGPT Integration** — Interacts with ChatGPT's DOM using `querySelector` on `#prompt-textarea` and `[data-testid="send-button"]`

## Limitations

- Depends on ChatGPT's current DOM structure — may break if ChatGPT updates its UI selectors
- Response detection uses polling, not event-based hooks
- Only works on `chatgpt.com`

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

This project is open source. See the repository for license details.
