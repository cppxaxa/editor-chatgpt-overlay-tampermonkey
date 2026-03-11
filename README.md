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

### Example Workflow

```
/p Summarize the key differences between TCP and UDP
/p Write a Python function to check if a string is a palindrome
/p Explain the CAP theorem in simple terms
```

Place your cursor on any line and press <kbd>Alt</kbd>+<kbd>I</kbd>. The `/p ...` line will be replaced with ChatGPT's full response. You can then continue editing, add follow-up prompts, and build a working document.

## How It Works

The script injects a floating editor UI into ChatGPT's page. When you trigger a `/p` command:

1. The prompt text is inserted into ChatGPT's input box
2. The send button is automatically clicked
3. The script polls for the assistant's response (checking every 1 second)
4. Once the response stabilizes (no new content for 1 second), it's captured
5. The original `/p` line in the editor is replaced with the response

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
