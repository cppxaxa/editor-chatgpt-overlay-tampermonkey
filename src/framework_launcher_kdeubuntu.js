// -----------------------------------------------------------------------------
// framework_launcher_kdeubuntu.js — KDE/Ubuntu-style launcher registration.
//
// Thin wrapper around service_taskbar.js. The taskbar service owns all DOM:
// wallpaper, bottom taskbar, Start button + Start menu (search + scrollable
// app list), running-apps list, system tray, up arrow for overflow, and
// clock. This file just exposes the registration entrypoint that
// framework_launcher.js delegates to.
// -----------------------------------------------------------------------------

function framework_launcher_kdeubuntu_register(textContent, onlaunch, opts) {

    service_taskbar_init();
    service_taskbar_register_app(textContent, onlaunch, opts);
}
