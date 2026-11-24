# Bo Tot Remote Controller

Remote Windows control panel on port 20139, intended for a trusted LAN or Tailscale network. Do not expose this service to the public Internet.

## Features
- Responsive phone/desktop interface and installable PWA on a secure origin.
- System uptime, battery and memory status.
- Screen off, lock, shutdown and restart controls.
- Countdown scheduling and daily/one-time shutdown, sleep and hibernate schedules.
- Wake schedule for a sleeping or hibernating laptop.
- On-laptop countdown window (`countdown-popup.ps1`) with a Cancel button whenever shutdown, restart, sleep or hibernate is about to run, whether scheduled or sent from the phone.
- Optional wait for AI tasks before scheduled shutdown.
- Local uptime warning banner and optional automatic shutdown threshold.
- AI Hub controls and remote prompt runner.

Phone push notifications, ntfy, Telegram and notification SSE endpoints have been removed. The uptime warning is displayed only in the control panel.

## Run
- Foreground: `start-remote.bat`
- Background: `launch-remote.vbs`
- Startup registration: `install-startup.ps1`
- Remove startup registration: `uninstall-startup.ps1`

Configuration is stored in `remote-config.json`. Shutdown, Sleep, Hibernate and Restart schedules require the Remote daemon and Windows to be running.

## Wake schedule
The wake schedule registers a Windows Task Scheduler task named `BoTotRemoteWake` (`WakeToRun`, see `wake-task.ps1`). When it fires it runs `keep-awake.ps1`, which keeps the machine awake for 20 minutes.
- Works only from Sleep or Hibernate, on AC power, and needs hardware/BIOS RTC wake support. A machine that is fully shut down cannot be woken.
- Windows must allow wake timers on AC: `powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1` then `powercfg /setactive SCHEME_CURRENT`.
- The panel shows a warning when the task cannot be created or wake timers are blocked.

## Verification
Run `node --check server.cjs` and `node test_mobile.cjs`.
