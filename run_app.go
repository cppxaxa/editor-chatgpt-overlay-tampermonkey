// run_app.go — launches a browser (per appsettings.json), then injects
// dist/source.js into the chatgpt.com tab via the Chrome DevTools Protocol.
//
// Usage:
//   go run run_app.go
//
// No external dependencies — uses only the Go standard library. The minimal
// WebSocket client below implements just enough of RFC 6455 to send a single
// text frame and read the reply, so we don't need gorilla/websocket.
package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type appSettings struct {
	ChromePath    []string       `json:"chromepath"`
	ChromeProfile []string       `json:"chromeprofile"`
	ChromePort    []int          `json:"chromeport"`
	App           string         `json:"app"`
	Website       string         `json:"website"`
	Properties    map[string]any `json:"properties"`
}

type debugTarget struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	URL                  string `json:"url"`
	Title                string `json:"title"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "run_app: %v\n", err)
		os.Exit(1)
	}
}

// errProcessDied is returned by polling functions when the browser process
// exits before the operation completes.
var errProcessDied = fmt.Errorf("browser process exited")

func run() error {
	cfg, err := loadSettings("appsettings.json")
	if err != nil {
		return err
	}

	if strings.ToLower(cfg.App) != "chrome" {
		return fmt.Errorf("unsupported app %q (only \"chrome\" is implemented)", cfg.App)
	}

	chromeExe, err := resolveChromeExe(cfg.ChromePath)
	if err != nil {
		return err
	}
	fmt.Printf("Using chrome at: %s\n", chromeExe)

	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("getwd: %w", err)
	}

	scriptPath := filepath.Join("dist", "source.js")
	scriptBytes, err := os.ReadFile(scriptPath)
	if err != nil {
		return fmt.Errorf("read %s: %w (run build first)", scriptPath, err)
	}

	// Resolve a (profile, port) slot. The two arrays are paired by index, so
	// slot i means "use chromeprofile[i] with chromeport[i]". For each slot
	// we check whether it's free — i.e. its profile dir is not locked by a
	// running chrome AND its port is bindable. The first free slot wins.
	//
	// Why both checks? Chrome's profile lock tells us whether *another chrome*
	// already owns that profile (running 2nd instance against the same profile
	// is a no-op + hang). The port bindability check tells us whether the
	// remote-debugging port we'd hand chrome is actually free. Either failure
	// means this slot is already taken by a previous run_app invocation.
	profiles := cfg.ChromeProfile
	ports := cfg.ChromePort
	if len(profiles) == 0 {
		profiles = []string{"chrome-profile"}
	}
	if len(ports) == 0 {
		ports = []int{9222}
	}
	if len(profiles) != len(ports) {
		return fmt.Errorf(
			"appsettings.json: chromeprofile (%d entries) and chromeport (%d entries) must have the same length",
			len(profiles), len(ports))
	}

	var profileDir string
	var port int
	chosen := -1
	var skipReasons []string
	for i := range profiles {
		candidateDir := profiles[i]
		if !filepath.IsAbs(candidateDir) {
			candidateDir = filepath.Join(cwd, candidateDir)
		}
		candidatePort := ports[i]

		if locked, holder := isProfileLocked(candidateDir); locked {
			skipReasons = append(skipReasons,
				fmt.Sprintf("  slot %d: profile %q locked (%s)", i, candidateDir, holder))
			continue
		}
		if !isPortBindable(candidatePort) {
			skipReasons = append(skipReasons,
				fmt.Sprintf("  slot %d: port %d not bindable", i, candidatePort))
			continue
		}

		profileDir = candidateDir
		port = candidatePort
		chosen = i
		break
	}
	if chosen < 0 {
		return fmt.Errorf(
			"all %d configured (profile, port) slots are in use:\n%s\n"+
				"Add another entry to chromeprofile and chromeport in appsettings.json, or close an existing instance.",
			len(profiles), strings.Join(skipReasons, "\n"))
	}
	if len(skipReasons) > 0 {
		fmt.Printf("Skipped slots:\n%s\n", strings.Join(skipReasons, "\n"))
	}
	fmt.Printf("Using slot %d: profile=%q port=%d\n", chosen, profileDir, port)

	// Resolve the target website URL. Required field.
	website := cfg.Website
	if website == "" {
		return fmt.Errorf("appsettings.json: \"website\" is required (e.g. \"https://chatgpt.com\")")
	}
	fmt.Printf("Target website: %s\n", website)

	// Extract the hostname for target detection (e.g. "chatgpt.com").
	websiteHost := website
	if u, err := url.Parse(website); err == nil && u.Host != "" {
		websiteHost = u.Host
	}

	args := []string{
		"--app=" + website,
		"--start-maximized",
		fmt.Sprintf("--remote-debugging-port=%d", port),
		"--remote-allow-origins=*",
		fmt.Sprintf("--user-data-dir=%s", profileDir),
	}

	fmt.Printf("Launching: %s %s\n", chromeExe, strings.Join(args, " "))
	cmd := exec.Command(chromeExe, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start chrome: %w", err)
	}

	// Monitor the browser process — close processDone when it exits so all
	// polling loops can bail immediately instead of timing out on a dead
	// process.
	processDone := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(processDone)
	}()

	// Quick sanity check: give the process a moment, then verify it's still
	// alive. Catches immediate-exit failures (bad binary, missing libs, etc.).
	select {
	case <-processDone:
		return fmt.Errorf("browser process exited immediately (exit code: %v)", cmd.ProcessState.ExitCode())
	case <-time.After(2 * time.Second):
		// Still running — proceed.
	}

	// --- Initial injection ---
	wsURL, err := waitForTarget(port, websiteHost, 60*time.Second, processDone)
	if err != nil {
		return err
	}
	fmt.Printf("Found %s target: %s\n", websiteHost, wsURL)

	if err := performInjection(wsURL, scriptBytes, cfg.Properties, processDone); err != nil {
		return err
	}

	// --- Watchdog loop (best-effort, 1 minute) ---
	// Stay alive and poll window.__tm_loaded every 5s. If the page navigated
	// (redirects, SPA transitions) the flag will be gone — re-inject.
	fmt.Println("Entering watchdog loop (1 minute)...")
	watchdogEnd := time.Now().Add(1 * time.Minute)
	id := 6000
	for time.Now().Before(watchdogEnd) {
		select {
		case <-processDone:
			fmt.Println("Browser process exited — watchdog done.")
			return nil
		case <-time.After(5 * time.Second):
		}

		loaded, err := checkTmLoaded(wsURL, &id)
		if err != nil {
			fmt.Printf("  watchdog: CDP check failed: %v\n", err)
			// Could be a transient WS error or browser closing. If the
			// process is still alive, try to re-resolve and re-inject.
			select {
			case <-processDone:
				fmt.Println("Browser process exited — watchdog done.")
				return nil
			default:
			}
		}
		if loaded {
			continue
		}

		// Script is gone — page likely navigated. Re-inject.
		fmt.Println("  watchdog: window.__tm_loaded is gone — re-injecting...")

		newWsURL, err := waitForTarget(port, websiteHost, 60*time.Second, processDone)
		if err != nil {
			fmt.Printf("  watchdog: re-resolve target failed: %v\n", err)
			continue
		}
		wsURL = newWsURL

		if err := performInjection(wsURL, scriptBytes, cfg.Properties, processDone); err != nil {
			fmt.Printf("  watchdog: re-injection failed: %v\n", err)
			continue
		}
		fmt.Println("  watchdog: re-injection succeeded.")
	}
	fmt.Println("Watchdog period elapsed — exiting.")
	return nil
}

// performInjection runs the full injection sequence: wait for page ready,
// ensure booting splash, inject localStorage properties, inject source.js,
// verify the script initialized, seed src-fs, and remove the splash.
func performInjection(wsURL string, scriptBytes []byte, props map[string]any, processDone <-chan struct{}) error {
	// Wait for the page to finish loading.
	if err := waitForPageReady(wsURL, 60*time.Second, processDone); err != nil {
		return fmt.Errorf("wait for page ready: %w", err)
	}
	fmt.Println("Page reports document.readyState === \"complete\".")

	// Sanity-check the injection channel: inject a splash div and verify
	// it appears in the DOM.
	if err := ensureBootingSplash(wsURL, 30*time.Second); err != nil {
		return fmt.Errorf("inject booting splash: %w", err)
	}
	fmt.Println("Booting splash visible in DOM — proceeding with source.js injection.")

	// Inject localStorage properties.
	if err := injectPropertiesIntoLocalStorage(wsURL, props); err != nil {
		return fmt.Errorf("inject properties into localStorage: %w", err)
	}

	// Inject source.js.
	payload := map[string]any{
		"id":     1,
		"method": "Runtime.evaluate",
		"params": map[string]any{
			"expression": string(scriptBytes),
		},
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	resp, err := wsSendAndReceive(wsURL, payloadBytes)
	if err != nil {
		return fmt.Errorf("websocket exchange: %w", err)
	}
	fmt.Println("DevTools response:")
	fmt.Println(resp)

	// Verify the script actually initialized by polling window.__tm_loaded.
	if err := verifyScriptLoaded(wsURL, 30*time.Second, processDone); err != nil {
		return fmt.Errorf("verify script loaded: %w", err)
	}
	fmt.Println("Script verified: window.__tm_loaded === true.")

	// Seed the IndexedDB-backed src-fs store.
	if err := injectSrcFs(wsURL, "src-fs"); err != nil {
		fmt.Printf("warn: src-fs injection failed: %v\n", err)
	}

	// Tear down the booting splash.
	removeExpr := `(function(){
        var el = document.getElementById("tm-booting-splash");
        if (el && el.parentNode) { el.parentNode.removeChild(el); return "removed"; }
        return "absent";
    })()`
	rmID := 9000
	if rmResp, err := evaluateExpression(wsURL, &rmID, removeExpr); err != nil {
		fmt.Printf("warn: failed to remove booting splash: %v\n", err)
	} else {
		fmt.Printf("Booting splash removal: %s\n", rmResp)
	}
	return nil
}

// verifyScriptLoaded polls window.__tm_loaded via Runtime.evaluate until it
// verifyScriptLoaded polls window.__tm_loaded via Runtime.evaluate until it
// returns true, or the timeout expires. This confirms the injected script
// actually ran framework_init() to completion (not just that CDP accepted the
// evaluate call).
func verifyScriptLoaded(wsURL string, timeout time.Duration, processDone <-chan struct{}) error {
	deadline := time.Now().Add(timeout)
	id := 5000
	for time.Now().Before(deadline) {
		select {
		case <-processDone:
			return errProcessDied
		default:
		}

		loaded, err := checkTmLoaded(wsURL, &id)
		if err != nil {
			fmt.Printf("  verify: CDP error: %v\n", err)
			time.Sleep(500 * time.Millisecond)
			continue
		}
		if loaded {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("timed out waiting for window.__tm_loaded === true")
}

// checkTmLoaded evaluates window.__tm_loaded and returns true if it is
// strictly true. Returns (false, nil) when the value is absent or falsy,
// and (false, err) on communication errors.
func checkTmLoaded(wsURL string, id *int) (bool, error) {
	respText, err := evaluateExpression(wsURL, id, "(window.__tm_loaded === true).toString()")
	if err != nil {
		return false, err
	}
	var resp struct {
		Result struct {
			Result struct {
				Value string `json:"value"`
			} `json:"result"`
		} `json:"result"`
	}
	if err := json.Unmarshal([]byte(respText), &resp); err != nil {
		return false, fmt.Errorf("parse __tm_loaded response: %w", err)
	}
	return resp.Result.Result.Value == "true", nil
}

// injectSrcFs walks `dir` recursively, base64-encodes every file, and sends
// one Runtime.evaluate that calls window.__tm_seed_fs([...]) inside the page.
// The userscript's service_fs.js owns __tm_seed_fs and writes each entry to
// IndexedDB under its relative path. Missing dir is not an error.
//
// Each file becomes one __tm_seed_fs([{path,mime,b64}]) call so the WS frame
// stays small and one bad file doesn't sink the whole batch.
func injectSrcFs(wsURL, dir string) error {
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		fmt.Printf("No %s/ directory to seed (skipping IndexedDB seed).\n", dir)
		return nil
	}

	id := 8000
	count := 0
	walkErr := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		data, err := os.ReadFile(p)
		if err != nil {
			fmt.Printf("  warn: read %s: %v\n", p, err)
			return nil
		}
		mime := mimeByExt(filepath.Ext(p))
		b64 := base64.StdEncoding.EncodeToString(data)

		entry := []map[string]string{{
			"path": rel,
			"mime": mime,
			"b64":  b64,
		}}
		payload, _ := json.Marshal(entry)
		expr := "window.__tm_seed_fs(" + string(payload) + ");"

		if _, err := evaluateExpression(wsURL, &id, expr); err != nil {
			fmt.Printf("  warn: seed %s failed: %v\n", rel, err)
			return nil
		}
		fmt.Printf("  src-fs[%q] = %s, %d bytes\n", rel, mime, len(data))
		count++
		return nil
	})
	if walkErr != nil {
		return walkErr
	}
	fmt.Printf("Seeded %d file(s) into IndexedDB store tm_fs/files.\n", count)
	return nil
}

// mimeByExt returns a best-effort MIME type for the given extension.
// Conservative defaults — falls back to application/octet-stream.
func mimeByExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	case ".ico":
		return "image/x-icon"
	case ".bmp":
		return "image/bmp"
	case ".css":
		return "text/css"
	case ".html", ".htm":
		return "text/html"
	case ".js":
		return "application/javascript"
	case ".json":
		return "application/json"
	case ".txt":
		return "text/plain"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	case ".ttf":
		return "font/ttf"
	case ".otf":
		return "font/otf"
	}
	return "application/octet-stream"
}

func loadSettings(path string) (*appSettings, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var cfg appSettings
	if err := json.Unmarshal(b, &cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return &cfg, nil
}

// resolveChromeExe walks the configured paths in order and returns the first
// chrome.exe / chrome / Google Chrome binary that exists. Each entry may be
// either a directory (we'll append the platform's chrome binary name) or the
// full path to the binary itself.
func resolveChromeExe(paths []string) (string, error) {
	binaryName := "chrome"
	if runtime.GOOS == "windows" {
		binaryName = "chrome.exe"
	} else if runtime.GOOS == "darwin" {
		binaryName = "Google Chrome"
	}

	for _, p := range paths {
		if p == "" {
			continue
		}
		// If the entry already points at a file, use it directly.
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p, nil
		}
		candidate := filepath.Join(p, binaryName)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("none of the configured chromepath entries exist: %v", paths)
}

// waitForTarget polls http://localhost:<port>/json until a page-type
// target whose URL contains `host` appears, the timeout expires, or the
// browser process exits (processDone closes).
func waitForTarget(port int, host string, timeout time.Duration, processDone <-chan struct{}) (string, error) {
	endpoint := fmt.Sprintf("http://localhost:%d/json", port)
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 3 * time.Second}

	var lastErr error
	for time.Now().Before(deadline) {
		select {
		case <-processDone:
			return "", errProcessDied
		default:
		}

		resp, err := client.Get(endpoint)
		if err != nil {
			lastErr = err
			time.Sleep(500 * time.Millisecond)
			continue
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			time.Sleep(500 * time.Millisecond)
			continue
		}

		var targets []debugTarget
		if err := json.Unmarshal(body, &targets); err != nil {
			lastErr = err
			time.Sleep(500 * time.Millisecond)
			continue
		}
		for _, t := range targets {
			if t.Type == "page" && strings.Contains(t.URL, host) && t.WebSocketDebuggerURL != "" {
				return t.WebSocketDebuggerURL, nil
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	if lastErr != nil {
		return "", fmt.Errorf("timed out waiting for %s target (last error: %v)", host, lastErr)
	}
	return "", fmt.Errorf("timed out waiting for %s target on port %d", host, port)
}

// isPortBindable returns true if we can bind a TCP listener on the given
// port on the loopback interface. The listener is closed immediately, so
// chrome can claim the port a moment later. There's a small TOCTOU race
// (some other process could grab it in between), but for our use case
// — sole-instance debug profile — it's fine.
func isPortBindable(port int) bool {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	_ = l.Close()
	return true
}

// isProfileLocked reports whether the given chrome user-data-dir appears to
// be owned by a currently-running chrome process. Returns (true, holder)
// when locked, where holder is a short human-readable description.
//
// Detection is best-effort and platform-specific:
//   - Linux/macOS: chrome creates a `SingletonLock` symlink in the profile
//     dir whose target encodes "<hostname>-<pid>". Its presence means
//     "chrome is running on this profile".
//   - Windows: chrome opens `lockfile` in the profile dir with a deny-write
//     share mode for as long as the browser is running. We try to open it
//     for writing — a sharing violation means it's held.
//
// If the profile dir doesn't exist yet, it can't be locked.
func isProfileLocked(profileDir string) (bool, string) {
	if _, err := os.Stat(profileDir); os.IsNotExist(err) {
		return false, ""
	}

	// Linux / macOS: SingletonLock symlink. lstat so we don't follow it
	// (the target host-pid string is what we want).
	singleton := filepath.Join(profileDir, "SingletonLock")
	if info, err := os.Lstat(singleton); err == nil {
		holder := "SingletonLock present"
		if info.Mode()&os.ModeSymlink != 0 {
			if target, err := os.Readlink(singleton); err == nil && target != "" {
				holder = "SingletonLock -> " + target
			}
		}
		return true, holder
	}

	// Windows: try to open `lockfile` for writing. If chrome holds it,
	// we'll get a sharing violation (ERROR_SHARING_VIOLATION). If the
	// file doesn't exist, no chrome is running on this profile.
	if runtime.GOOS == "windows" {
		lockfile := filepath.Join(profileDir, "lockfile")
		if _, err := os.Stat(lockfile); err == nil {
			f, err := os.OpenFile(lockfile, os.O_RDWR, 0)
			if err != nil {
				return true, fmt.Sprintf("lockfile held (%v)", err)
			}
			_ = f.Close()
		}
	}

	return false, ""
}

// findFreePort asks the kernel for an unused TCP port by binding to
// 127.0.0.1:0, reading the assigned port, and releasing the listener.
func findFreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	tcpAddr, ok := l.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("unexpected addr type %T", l.Addr())
	}
	return tcpAddr.Port, nil
}

// ensureBootingSplash repeatedly injects a small JS expression that creates
// a fixed-position div with id="tm-booting-splash" and text "booting", then
// polls the DOM (via a separate Runtime.evaluate) until the element is
// present. If the element doesn't appear within retryDelay the injection
// is repeated, up to the overall timeout.
func ensureBootingSplash(wsURL string, timeout time.Duration) error {
	const splashID = "tm-booting-splash"
	injectExpr := `(function(){
        var existing = document.getElementById("` + splashID + `");
        if (existing) return "exists";
        var d = document.createElement("div");
        d.id = "` + splashID + `";
        d.textContent = "booting";
        d.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);" +
            "z-index:2147483647;background:#202123;color:#fff;" +
            "padding:20px 40px;border-radius:10px;text-align:center;" +
            "font:bold 20px sans-serif;border:1px solid #444;" +
            "box-shadow:0 4px 20px rgba(0,0,0,0.5);min-width:200px;";
        (document.body || document.documentElement).appendChild(d);
        return "injected";
    })()`
	checkExpr := `(!!document.getElementById("` + splashID + `")).toString()`

	deadline := time.Now().Add(timeout)
	id := 1000
	attempt := 0
	for time.Now().Before(deadline) {
		attempt++
		// 1. Inject (or re-inject) the splash.
		if _, err := evaluateExpression(wsURL, &id, injectExpr); err != nil {
			fmt.Printf("  splash inject attempt %d failed: %v\n", attempt, err)
			time.Sleep(500 * time.Millisecond)
			continue
		}

		// 2. Poll the DOM for up to ~3s waiting for the element.
		pollDeadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(pollDeadline) && time.Now().Before(deadline) {
			respText, err := evaluateExpression(wsURL, &id, checkExpr)
			if err != nil {
				time.Sleep(300 * time.Millisecond)
				continue
			}
			var resp struct {
				Result struct {
					Result struct {
						Value string `json:"value"`
					} `json:"result"`
				} `json:"result"`
			}
			if err := json.Unmarshal([]byte(respText), &resp); err == nil && resp.Result.Result.Value == "true" {
				fmt.Printf("  splash present in DOM (attempt %d).\n", attempt)
				return nil
			}
			time.Sleep(300 * time.Millisecond)
		}
		fmt.Printf("  splash not found after attempt %d, retrying injection...\n", attempt)
	}
	return fmt.Errorf("splash element #%s never appeared in DOM after %d attempt(s)", splashID, attempt)
}

// injectPropertiesIntoLocalStorage writes each key/value of props into the
// page's window.localStorage via Runtime.evaluate. Values are JSON-encoded
// so booleans, numbers, strings, objects and arrays all round-trip cleanly.
// (Strings are stored as their literal text — without the surrounding JSON
// quotes — to match how user code typically reads localStorage.)
func injectPropertiesIntoLocalStorage(wsURL string, props map[string]any) error {
	if len(props) == 0 {
		fmt.Println("No properties to inject into localStorage.")
		return nil
	}
	id := 7000
	for key, value := range props {
		var stored string
		switch v := value.(type) {
		case string:
			stored = v
		default:
			b, err := json.Marshal(v)
			if err != nil {
				return fmt.Errorf("marshal property %q: %w", key, err)
			}
			stored = string(b)
		}

		keyJSON, _ := json.Marshal(key)
		valJSON, _ := json.Marshal(stored)
		expr := fmt.Sprintf("window.localStorage.setItem(%s, %s)", string(keyJSON), string(valJSON))
		if _, err := evaluateExpression(wsURL, &id, expr); err != nil {
			return fmt.Errorf("set localStorage[%s]: %w", key, err)
		}
		fmt.Printf("  localStorage[%q] = %s\n", key, stored)
	}
	return nil
}

// evaluateExpression sends a single Runtime.evaluate call (returnByValue=true)
// over a fresh WebSocket and returns the raw JSON response body. id is
// incremented in-place so successive calls use unique ids.
func evaluateExpression(wsURL string, id *int, expression string) (string, error) {
	payload := map[string]any{
		"id":     *id,
		"method": "Runtime.evaluate",
		"params": map[string]any{
			"expression":    expression,
			"returnByValue": true,
		},
	}
	*id++
	b, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return wsSendAndReceive(wsURL, b)
}

// waitForPageReady polls document.readyState via Runtime.evaluate over a
// fresh WebSocket connection until it reports "complete", or the timeout
// expires. Bails immediately if processDone closes (browser exited).
func waitForPageReady(wsURL string, timeout time.Duration, processDone <-chan struct{}) error {
	deadline := time.Now().Add(timeout)
	id := 1
	var lastErr error
	for time.Now().Before(deadline) {
		select {
		case <-processDone:
			return errProcessDied
		default:
		}

		payload := map[string]any{
			"id":     id,
			"method": "Runtime.evaluate",
			"params": map[string]any{
				"expression":    "document.readyState",
				"returnByValue": true,
			},
		}
		id++
		b, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("marshal readyState payload: %w", err)
		}
		respText, err := wsSendAndReceive(wsURL, b)
		if err != nil {
			lastErr = err
			time.Sleep(500 * time.Millisecond)
			continue
		}

		var resp struct {
			Result struct {
				Result struct {
					Value string `json:"value"`
				} `json:"result"`
			} `json:"result"`
		}
		if err := json.Unmarshal([]byte(respText), &resp); err != nil {
			lastErr = fmt.Errorf("parse readyState response: %w (body=%s)", err, respText)
			time.Sleep(500 * time.Millisecond)
			continue
		}
		state := resp.Result.Result.Value
		fmt.Printf("  document.readyState = %q\n", state)
		if state == "complete" {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	if lastErr != nil {
		return fmt.Errorf("timed out (last error: %v)", lastErr)
	}
	return fmt.Errorf("timed out waiting for document.readyState=complete")
}

// wsSendAndReceive opens a WebSocket connection to wsURL, sends one text
// frame containing payload, and returns the first text frame read back.
//
// This is a deliberately minimal RFC 6455 client: single text frame in/out,
// client-to-server masking, no fragmentation, no extensions, no ping/pong
// handling beyond the initial response.
// wsConsecutiveFailures tracks how many WS calls in a row have failed. Reset
// on every successful exchange. Once it reaches wsMaxFailures the process
// silently exits — the assumption is the user has closed the browser, so
// there's no point continuing the injection sequence (every subsequent dial
// would also fail, spamming the console).
var wsConsecutiveFailures int

const wsMaxFailures = 10

func wsSendAndReceive(wsURL string, payload []byte) (string, error) {
	fmt.Printf("[ws] -> %s\n", wsURL)
	fmt.Printf("[ws] send: %s\n", truncate(string(payload), 800))

	resp, err := wsSendAndReceiveInner(wsURL, payload)
	if err != nil {
		fmt.Printf("[ws] error: %v\n", err)
		wsConsecutiveFailures++
		if wsConsecutiveFailures >= wsMaxFailures {
			// Browser likely closed. Quiet exit — no stack trace, no banner.
			os.Exit(0)
		}
		return resp, err
	}
	wsConsecutiveFailures = 0
	fmt.Printf("[ws] recv: %s\n", truncate(resp, 800))
	return resp, nil
}

// truncate returns s shortened to max runes with an ellipsis suffix when
// truncation occurred. Used so the per-call WS dump stays readable when the
// payload is the entire dist/source.js (~80 KB) or a deeply nested response.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + fmt.Sprintf("... [truncated, %d bytes total]", len(s))
}

func wsSendAndReceiveInner(wsURL string, payload []byte) (string, error) {
	u, err := url.Parse(wsURL)
	if err != nil {
		return "", fmt.Errorf("parse ws url: %w", err)
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return "", fmt.Errorf("unexpected ws scheme %q", u.Scheme)
	}
	if u.Scheme == "wss" {
		return "", fmt.Errorf("wss:// not supported by this minimal client")
	}

	host := u.Host
	if !strings.Contains(host, ":") {
		host += ":80"
	}

	conn, err := net.DialTimeout("tcp", host, 10*time.Second)
	if err != nil {
		return "", fmt.Errorf("dial %s: %w", host, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(60 * time.Second))

	// Generate a 16-byte random nonce and base64-encode it for Sec-WebSocket-Key.
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", fmt.Errorf("rand: %w", err)
	}
	key := base64.StdEncoding.EncodeToString(nonce[:])

	requestPath := u.RequestURI()
	if requestPath == "" {
		requestPath = "/"
	}

	handshake := "GET " + requestPath + " HTTP/1.1\r\n" +
		"Host: " + u.Host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"Origin: http://localhost\r\n" +
		"\r\n"

	if _, err := conn.Write([]byte(handshake)); err != nil {
		return "", fmt.Errorf("send handshake: %w", err)
	}

	br := bufio.NewReader(conn)
	statusLine, err := br.ReadString('\n')
	if err != nil {
		return "", fmt.Errorf("read handshake status: %w", err)
	}
	if !strings.Contains(statusLine, " 101 ") {
		// Drain the rest of the response so we can include it for diagnostics.
		rest, _ := io.ReadAll(br)
		return "", fmt.Errorf("websocket handshake failed: %s%s", strings.TrimSpace(statusLine), string(rest))
	}
	// Consume remaining response headers (up to the empty line).
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return "", fmt.Errorf("read handshake headers: %w", err)
		}
		if strings.TrimSpace(line) == "" {
			break
		}
	}

	// Verify Sec-WebSocket-Accept (best-effort sanity check).
	expectedAccept := acceptKey(key)
	_ = expectedAccept // we already consumed headers; we keep this for future tightening

	// Send a single masked text frame with the payload.
	if err := writeTextFrame(conn, payload); err != nil {
		return "", fmt.Errorf("write frame: %w", err)
	}

	// Read frames until we get a text frame back. DevTools may emit a
	// stray Ping or other control frame; we handle the common cases.
	for {
		op, data, err := readFrame(br)
		if err != nil {
			return "", fmt.Errorf("read frame: %w", err)
		}
		switch op {
		case 0x1: // text
			return string(data), nil
		case 0x9: // ping → reply with pong, then keep reading
			if err := writeFrame(conn, 0xA, data); err != nil {
				return "", fmt.Errorf("write pong: %w", err)
			}
		case 0x8: // close
			return "", fmt.Errorf("server closed connection before sending text frame")
		default:
			// ignore (binary, pong, continuation)
		}
	}
}

func acceptKey(clientKey string) string {
	const guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	h := sha1.Sum([]byte(clientKey + guid))
	return base64.StdEncoding.EncodeToString(h[:])
}

func writeTextFrame(w io.Writer, payload []byte) error {
	return writeFrame(w, 0x1, payload)
}

// writeFrame writes a single FIN frame with the given opcode. Client frames
// MUST be masked per RFC 6455 §5.3.
func writeFrame(w io.Writer, opcode byte, payload []byte) error {
	var header [14]byte
	header[0] = 0x80 | (opcode & 0x0F) // FIN + opcode

	n := len(payload)
	var headerLen int
	switch {
	case n < 126:
		header[1] = 0x80 | byte(n) // mask bit + length
		headerLen = 2
	case n <= 0xFFFF:
		header[1] = 0x80 | 126
		binary.BigEndian.PutUint16(header[2:4], uint16(n))
		headerLen = 4
	default:
		header[1] = 0x80 | 127
		binary.BigEndian.PutUint64(header[2:10], uint64(n))
		headerLen = 10
	}

	var maskKey [4]byte
	if _, err := rand.Read(maskKey[:]); err != nil {
		return err
	}
	copy(header[headerLen:headerLen+4], maskKey[:])
	headerLen += 4

	if _, err := w.Write(header[:headerLen]); err != nil {
		return err
	}

	// Mask the payload in-place into a fresh buffer so we don't mutate caller data.
	masked := make([]byte, n)
	for i := 0; i < n; i++ {
		masked[i] = payload[i] ^ maskKey[i&3]
	}
	_, err := w.Write(masked)
	return err
}

// readFrame reads one frame, unmasking if necessary, and returns the opcode
// and payload. Continuation frames are concatenated until FIN is seen for the
// initial opcode.
func readFrame(r io.Reader) (byte, []byte, error) {
	var firstOp byte
	var assembled []byte
	first := true

	for {
		var hdr [2]byte
		if _, err := io.ReadFull(r, hdr[:]); err != nil {
			return 0, nil, err
		}
		fin := hdr[0]&0x80 != 0
		op := hdr[0] & 0x0F
		masked := hdr[1]&0x80 != 0
		length := int64(hdr[1] & 0x7F)

		switch length {
		case 126:
			var ext [2]byte
			if _, err := io.ReadFull(r, ext[:]); err != nil {
				return 0, nil, err
			}
			length = int64(binary.BigEndian.Uint16(ext[:]))
		case 127:
			var ext [8]byte
			if _, err := io.ReadFull(r, ext[:]); err != nil {
				return 0, nil, err
			}
			length = int64(binary.BigEndian.Uint64(ext[:]))
		}

		var maskKey [4]byte
		if masked {
			if _, err := io.ReadFull(r, maskKey[:]); err != nil {
				return 0, nil, err
			}
		}

		payload := make([]byte, length)
		if length > 0 {
			if _, err := io.ReadFull(r, payload); err != nil {
				return 0, nil, err
			}
			if masked {
				for i := range payload {
					payload[i] ^= maskKey[i&3]
				}
			}
		}

		// Control frames (op >= 0x8) are not fragmented and not coalesced
		// with data frames — return them as-is to the caller.
		if op >= 0x8 {
			return op, payload, nil
		}

		if first {
			firstOp = op
			first = false
		}
		assembled = append(assembled, payload...)
		if fin {
			return firstOp, assembled, nil
		}
	}
}
