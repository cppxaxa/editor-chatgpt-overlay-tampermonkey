// -----------------------------------------------------------------------------
// framework_shell.js — top-level scripting facade exposed as window.shell.
//
// The shell is a *live view* of the existing registries. It does not own
// state. Install/uninstall is the registry's job:
//     framework_taskbar_register_app / _unregister_app          (start menu)
//     framework_taskbar_register_tray_app / _unregister_tray_app (system tray)
//
// Public surface:
//   shell.launcher.<appName>()       — invokes the Start-menu app's onlaunch.
//   shell.tray.<appName>()           — invokes the tray app's onClick (toggle).
//   shell.tray.<appName>.show()      — force-show the tray icon.
//   shell.tray.<appName>.hide()      — force-hide the tray icon.
//   shell.startMenu.open() / close() / toggle()
//   shell.shellVisibility.show() / hide() / isHidden()
//   shell.list()                     — { launcher: [...], tray: [...] }
//
// Why a Proxy: the registries can grow at runtime (dynamic install via
// localStorage / src-fs at any point after boot). A Proxy resolves names
// on every access against the current registry — no caching, no re-binding,
// uninstall returns to undefined for free.
//
// Coupling: this file depends ONLY on framework_taskbar's public API
// (framework_taskbar_list_apps, _list_tray_apps, _invoke_app, _invoke_tray_app,
// _set_app_visibility, _toggle_start_menu, _close_start_menu, _show_shell,
// _hide_shell, _is_hidden). It does not poke private state.
// -----------------------------------------------------------------------------

function _framework_shell_make_launcher_proxy() {
    return new Proxy(Object.create(null), {
        get(_target, prop) {
            if (typeof prop !== "string") return undefined;
            if (prop === "list") {
                return () => framework_taskbar_list_apps()
                    .filter(a => a.appName)
                    .map(a => a.appName);
            }
            const app = framework_taskbar_list_apps().find(a => a.appName === prop);
            if (!app) return undefined;
            /* Re-resolve at call time so unregister-then-call fails cleanly
               (invoke_app throws) instead of invoking a stale closure. */
            const fn = () => framework_taskbar_invoke_app(prop);
            fn.appName = app.appName;
            fn.label   = app.label;
            fn.title   = app.title;
            return fn;
        },
        has(_t, prop) {
            return typeof prop === "string" &&
                !!framework_taskbar_list_apps().find(a => a.appName === prop);
        },
        ownKeys() {
            return framework_taskbar_list_apps()
                .filter(a => a.appName).map(a => a.appName);
        },
        getOwnPropertyDescriptor(_t, prop) {
            const app = framework_taskbar_list_apps().find(a => a.appName === prop);
            if (!app) return undefined;
            return { enumerable: true, configurable: true, value: this.get(_t, prop) };
        }
    });
}

function _framework_shell_make_tray_proxy() {
    return new Proxy(Object.create(null), {
        get(_target, prop) {
            if (typeof prop !== "string") return undefined;
            if (prop === "list") {
                return () => framework_taskbar_list_tray_apps().map(a => a.appName);
            }
            const app = framework_taskbar_list_tray_apps().find(a => a.appName === prop);
            if (!app) return undefined;
            const fn = () => framework_taskbar_invoke_tray_app(prop);
            fn.appName = app.appName;
            fn.label   = app.label;
            /* Convenience handles for force-show / force-hide of the tray icon.
               Toggling visibility goes through the same path as the overflow
               popup so persisted hidden-apps state stays consistent. */
            fn.show = () => framework_taskbar_set_app_visibility(prop, true);
            fn.hide = () => framework_taskbar_set_app_visibility(prop, false);
            return fn;
        },
        has(_t, prop) {
            return typeof prop === "string" &&
                !!framework_taskbar_list_tray_apps().find(a => a.appName === prop);
        },
        ownKeys() {
            return framework_taskbar_list_tray_apps().map(a => a.appName);
        },
        getOwnPropertyDescriptor(_t, prop) {
            const app = framework_taskbar_list_tray_apps().find(a => a.appName === prop);
            if (!app) return undefined;
            return { enumerable: true, configurable: true, value: this.get(_t, prop) };
        }
    });
}

function framework_shell_init() {
    if (typeof window === "undefined") return;

    /* Overwrite unconditionally. ChatGPT's page sets its own window.shell
       (some internal object without .launcher), so a presence guard would
       silently skip our installation. The proxies are stateless — replacing
       the object on every call is cheap and idempotent in effect. We stash
       any pre-existing value under window.__pageShell in case page code
       still needs it. */
    if (window.shell && !window.shell.__tm_framework_shell) {
        window.__pageShell = window.shell;
    }

    window.shell = {
        __tm_framework_shell: true,
        launcher:   _framework_shell_make_launcher_proxy(),
        tray:       _framework_shell_make_tray_proxy(),
        shelltoast: shell_toast_build(),

        startMenu: {
            open()   { framework_taskbar_toggle_start_menu(); },
            close()  { framework_taskbar_close_start_menu(); },
            toggle() { framework_taskbar_toggle_start_menu(); }
        },

        shellVisibility: {
            show()     { framework_taskbar_show_shell(); },
            hide()     { framework_taskbar_hide_shell(); },
            isHidden() { return framework_taskbar_is_hidden(); }
        },

        list() {
            return {
                launcher: framework_taskbar_list_apps()
                    .filter(a => a.appName).map(a => a.appName),
                tray:     framework_taskbar_list_tray_apps().map(a => a.appName)
            };
        }
    };
}
