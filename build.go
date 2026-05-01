// build.go — concatenates src/*.js into dist/source.js and copies to clipboard.
//
// Order: src/header.js, src/framework.js, src/component_*.js (sorted),
// then any other src/*.js (sorted), then src/footer.js.
//
// Usage:
//   go run build.go
//
// Or build a binary once:
//   go build -o build.exe build.go   (Windows)
//   go build -o build build.go       (Linux/macOS)
//
// No external dependencies — uses only the Go standard library.
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"unicode/utf16"
)

const (
	srcDir   = "src"
	outDir   = "dist"
	outFile  = "source.js"
	headerFn = "header.js"
	frameFn  = "framework.js"
	footerFn = "footer.js"
)

func main() {
	files, err := orderedFiles()
	if err != nil {
		fail(err)
	}
	if len(files) == 0 {
		fail(fmt.Errorf("no .js files found in %s/", srcDir))
	}

	var buf bytes.Buffer
	for i, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			fail(fmt.Errorf("read %s: %w", f, err))
		}
		// Per-file banner so the merged file is easy to navigate when
		// debugging in the Tampermonkey editor.
		fmt.Fprintf(&buf, "// ===== %s =====\n", filepath.ToSlash(f))
		buf.Write(b)
		if !bytes.HasSuffix(b, []byte("\n")) {
			buf.WriteByte('\n')
		}
		if i < len(files)-1 {
			buf.WriteByte('\n')
		}
	}

	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fail(fmt.Errorf("mkdir %s: %w", outDir, err))
	}
	outPath := filepath.Join(outDir, outFile)
	if err := os.WriteFile(outPath, buf.Bytes(), 0o644); err != nil {
		fail(fmt.Errorf("write %s: %w", outPath, err))
	}

	clipErr := copyToClipboard(buf.Bytes())

	fmt.Printf("Built %d file(s), %d bytes -> %s\n", len(files), buf.Len(), outPath)
	for _, f := range files {
		fmt.Printf("  + %s\n", filepath.ToSlash(f))
	}
	if clipErr != nil {
		fmt.Fprintf(os.Stderr, "Clipboard copy failed: %v\n", clipErr)
		fmt.Fprintln(os.Stderr, "(The dist file was still written. Paste from there.)")
		os.Exit(2)
	}
	fmt.Println("Copied to clipboard. Paste into Tampermonkey and save.")
}

// orderedFiles returns the .js files in src/ in the canonical build order:
// header.js, framework.js, then all other *.js sorted alphabetically (with
// component_*.js sorted naturally among them), then footer.js.
func orderedFiles() ([]string, error) {
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", srcDir, err)
	}

	var middle []string
	hasHeader, hasFramework, hasFooter := false, false, false
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".js") {
			continue
		}
		switch name {
		case headerFn:
			hasHeader = true
		case frameFn:
			hasFramework = true
		case footerFn:
			hasFooter = true
		default:
			middle = append(middle, name)
		}
	}
	sort.Strings(middle)

	var ordered []string
	if hasHeader {
		ordered = append(ordered, filepath.Join(srcDir, headerFn))
	}
	if hasFramework {
		ordered = append(ordered, filepath.Join(srcDir, frameFn))
	}
	for _, n := range middle {
		ordered = append(ordered, filepath.Join(srcDir, n))
	}
	if hasFooter {
		ordered = append(ordered, filepath.Join(srcDir, footerFn))
	}
	return ordered, nil
}

// copyToClipboard pipes data to the platform's clipboard tool.
// Windows: clip.exe.  macOS: pbcopy.  Linux: wl-copy or xclip or xsel.
//
// On Windows, clip.exe reads stdin using the system ANSI codepage (typically
// CP1252), which mangles non-ASCII UTF-8 sequences (e.g. ↻ — □ × ⟳ ⭐). To
// preserve them, we encode the payload as UTF-16LE with a BOM, which clip.exe
// detects and treats as Unicode.
func copyToClipboard(data []byte) error {
	cmd, err := clipboardCmd()
	if err != nil {
		return err
	}
	payload := data
	if runtime.GOOS == "windows" {
		payload = encodeUTF16LEWithBOM(data)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	if _, err := io.Copy(stdin, bytes.NewReader(payload)); err != nil {
		stdin.Close()
		_ = cmd.Wait()
		return err
	}
	stdin.Close()
	return cmd.Wait()
}

// encodeUTF16LEWithBOM converts UTF-8 input to UTF-16LE bytes prefixed with
// the little-endian BOM (0xFF 0xFE).
func encodeUTF16LEWithBOM(data []byte) []byte {
	runes := []rune(string(data))
	u16 := utf16.Encode(runes)

	out := make([]byte, 2+2*len(u16))
	out[0] = 0xFF
	out[1] = 0xFE
	for i, r := range u16 {
		binary.LittleEndian.PutUint16(out[2+2*i:], r)
	}
	return out
}

func clipboardCmd() (*exec.Cmd, error) {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("clip"), nil
	case "darwin":
		return exec.Command("pbcopy"), nil
	case "linux":
		// Try wl-copy (Wayland) first, then xclip, then xsel.
		if _, err := exec.LookPath("wl-copy"); err == nil {
			return exec.Command("wl-copy"), nil
		}
		if _, err := exec.LookPath("xclip"); err == nil {
			return exec.Command("xclip", "-selection", "clipboard"), nil
		}
		if _, err := exec.LookPath("xsel"); err == nil {
			return exec.Command("xsel", "--clipboard", "--input"), nil
		}
		return nil, fmt.Errorf("no clipboard tool found (install wl-copy, xclip, or xsel)")
	default:
		return nil, fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "build: %v\n", err)
	os.Exit(1)
}
