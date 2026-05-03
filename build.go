// build.go — concatenates src/*.js into dist/source.js.
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
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
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

	fmt.Printf("Built %d file(s), %d bytes -> %s\n", len(files), buf.Len(), outPath)
	for _, f := range files {
		fmt.Printf("  + %s\n", filepath.ToSlash(f))
	}
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

func fail(err error) {
	fmt.Fprintf(os.Stderr, "build: %v\n", err)
	os.Exit(1)
}
