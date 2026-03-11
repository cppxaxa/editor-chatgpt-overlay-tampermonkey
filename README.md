# ChatGPT Floating Scratchpad

A Tampermonkey userscript that adds a floating, resizable text editor overlay to [ChatGPT](https://chatgpt.com) with built-in prompt automation and code review.

![Tampermonkey](https://img.shields.io/badge/Tampermonkey-Userscript-green)
![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-yellow)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **Floating Editor** — A draggable, resizable scratchpad that sits on top of ChatGPT
- **Dark Theme** — Matches ChatGPT's aesthetic with a monospace code-friendly font
- **Window Controls** — Minimize, maximize, and close buttons just like a real window
- **Two-Column Layout** — When maximized, text flows into two side-by-side editable columns to use widescreen space
- **Persistent State** — Editor content, position, size, and window mode are saved across page reloads
- **Inline Commands** — `/p` (contextual prompt) and `/r` (raw prompt) commands to interact with ChatGPT directly from the editor
- **Code Check with Markers** — Review your code via ChatGPT; issues are marked with ⭐ at the exact position in the editor
- **Smart Indentation** — Auto-indent on Enter, Tab inserts 4 spaces, Shift+Tab removes indentation
- **Title Bar Buttons** — "Command" and "Check" buttons in the header for mouse-driven access
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
| **□** (Maximize) | Expands the editor to fill the entire screen with a two-column layout. Click again to restore. |
| **×** (Close) | Hides the editor. Click the "E" launcher to reopen. |

You can also **drag** the title bar to reposition the window, and **drag the bottom-right corner** to resize it.

### Two-Column Layout (Maximized)

When maximized, the editor splits into two side-by-side textareas:

- The **left column** holds as many lines as fit vertically
- **Overflow lines** appear in the **right column**
- Both columns are fully editable — click, type, select, copy/paste all work naturally
- Arrow keys cross between columns seamlessly (Down at bottom of left jumps to top of right, and vice versa)
- Backspace at the start of the right column pulls content from the left
- Lines redistribute automatically as you type or resize the window

---

### `/p` — Contextual Prompt Command

The `/p` command sends a prompt to ChatGPT **with full editor context** and replaces the command line with the response.

**How to use:**

1. In the editor, type a line starting with `/p ` followed by your prompt:
   ```
   /p write a function that adds two numbers
   ```
2. Place your cursor on that line
3. Press <kbd>Alt</kbd>+<kbd>I</kbd> or click the **Command** button in the title bar

**What happens:**
- The entire editor content is sent to ChatGPT as context, with line numbers and the `/p` line marked
- ChatGPT is instructed to respond with only the replacement text — no explanations, no fences
- The `/p ...` line is replaced with the response, preserving indentation
- The response can be multiline

**Example — building code inline:**
```
public class Calculator {
    /p write a method that divides two numbers with error handling
}
```
ChatGPT sees the full class context and generates a method that fits naturally.

---

### `/r` — Raw Prompt Command

The `/r` command sends a prompt to ChatGPT **without any context or instructions** — just the raw text.

**How to use:**

1. Type a line starting with `/r ` followed by your prompt:
   ```
   /r What is the capital of France?
   ```
2. Place your cursor on that line
3. Press <kbd>Alt</kbd>+<kbd>I</kbd> or click the **Command** button

**What happens:**
- Only the text after `/r ` is sent to ChatGPT as-is — no editor context, no system instructions
- The `/r ...` line is replaced with ChatGPT's full response

Use `/r` when you want a general-purpose question answered without the editor content influencing the response.

---

### <kbd>Alt</kbd>+<kbd>I</kbd> — Execute Current Line

<kbd>Alt</kbd>+<kbd>I</kbd> triggers the action for the current line under the cursor.

**Behavior:**
- **`/p ` line** — contextual prompt sent to ChatGPT, line replaced with response
- **`/r ` line** — raw prompt sent to ChatGPT, line replaced with response
- **Regular text** — line content is shown in an alert popup

> **Tip:** You can also click the **Command** button in the title bar instead of using the keyboard shortcut.

---

### <kbd>Alt</kbd>+<kbd>C</kbd> — Code Check

<kbd>Alt</kbd>+<kbd>C</kbd> sends the entire editor content to ChatGPT for a code review. Issues are displayed in a dialog **and** marked directly in the editor with ⭐.

**How to use:**

1. Write or paste your code into the editor
2. Press <kbd>Alt</kbd>+<kbd>C</kbd> or click the **Check** button in the title bar

**What happens:**
- The code is sent with line numbers (`1> `, `2> `, etc.) so ChatGPT can pinpoint issues
- The titlebar shows a spinner and a **Cancel** button while waiting
- ChatGPT responds with a structured review:
  - **correct** — whether the code is syntactically and logically correct
  - **solves_problem** — whether the code solves its intended problem
  - **summary** — a one-line description
  - **issues** — list of problems found
  - **suggestions** — improvement recommendations
  - **markers** — issue locations with corrected line content
- The result is displayed in a formatted dialog
- ⭐ markers are inserted into the editor at the exact position of each issue (by diffing the original line against ChatGPT's corrected version)

**Marker behavior:**
- ⭐ markers appear inline in the code right where the issue is
- **Click on a marker** or **move the cursor to it** (arrow keys) to dismiss it
- Old markers are automatically cleared before each new code check

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

### Title Bar Buttons

Two action buttons sit beside the "Editor" label in the title bar:

| Button | Action |
|--------|--------|
| **Command** | Executes the current line — same as <kbd>Alt</kbd>+<kbd>I</kbd> |
| **Check** | Runs code check — same as <kbd>Alt</kbd>+<kbd>C</kbd> |

These work even after clicking away from the textarea — the editor remembers which textarea was last focused.

---

### Example Workflow

```
/p Write a C# class for a binary search tree with insert and search methods
```

Press <kbd>Alt</kbd>+<kbd>I</kbd> — the `/p` line is replaced with a full BST implementation.

Then press <kbd>Alt</kbd>+<kbd>C</kbd> to review the generated code. Any issues appear as ⭐ markers in the code and a summary dialog.

Fix the issues, then add more prompts inline:

```
    /p add a delete method that handles all three cases
```

ChatGPT sees the full class context and generates a method that fits.

## Keyboard Shortcuts

| Shortcut | Context | Action |
|----------|---------|--------|
| <kbd>Alt</kbd>+<kbd>I</kbd> | Editor focused | Execute current line (`/p` contextual prompt, `/r` raw prompt, or alert) |
| <kbd>Alt</kbd>+<kbd>C</kbd> | Editor focused | Send editor content for code review with ⭐ markers |
| <kbd>Tab</kbd> | Editor focused | Insert 4 spaces |
| <kbd>Shift</kbd>+<kbd>Tab</kbd> | Editor focused | Remove up to 4 leading spaces from the current line |
| <kbd>Enter</kbd> | Editor focused | New line with auto-indent matching the current line |

## How It Works

The script injects a floating editor UI into ChatGPT's page. When you trigger a command:

1. The script snapshots the current number of assistant messages
2. The prompt text is inserted into ChatGPT's input box and sent
3. It waits for a **new** assistant message to appear (count increases)
4. It waits for ChatGPT's **stop button to disappear** (streaming complete)
5. After a short grace period, the final response text is captured
6. Code blocks are cleaned — language labels and copy buttons are stripped, line breaks are preserved
7. The original command line in the editor is replaced with the response, inheriting the line's indentation

All editor state (content, position, size, window mode) is persisted in `localStorage`.

## Technical Details

- **Single file** — No dependencies, no build step, no frameworks
- **Runtime** — Executes at `document-idle` via Tampermonkey
- **Storage** — Uses `localStorage` (`tm_editor_content` for text, `tm_editor_window_state` for window state)
- **ChatGPT Integration** — Interacts with ChatGPT's DOM using `querySelector` on `#prompt-textarea` and `[data-testid="send-button"]`
- **Two-Column Layout** — Two real `<textarea>` elements with automatic line redistribution based on viewport height

## Limitations

- Depends on ChatGPT's current DOM structure — may break if ChatGPT updates its UI selectors
- Response detection uses polling, not event-based hooks
- Only works on `chatgpt.com`
- Code check marker accuracy depends on ChatGPT returning minimally corrected lines

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

This project is open source. See the repository for license details.
