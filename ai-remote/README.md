# Bo Tot Remote Controller

Remote Windows control panel on port 20139, intended for a trusted LAN or Tailscale network. Do not expose this service to the public Internet.

## Features
- Responsive phone/desktop interface and installable PWA on a secure origin.
- System uptime, battery and memory status.
- Screen off, lock, shutdown and restart controls.
- Countdown scheduling and daily/one-time shutdown schedules.
- Optional wait for AI tasks before scheduled shutdown.
- Local uptime warning banner and optional automatic shutdown threshold.
- AI Hub controls and remote prompt runner.

Phone push notifications, ntfy, Telegram and notification SSE endpoints have been removed. The uptime warning is displayed only in the control panel.

## Run
- Foreground: `start-remote.bat`
- Background: `launch-remote.vbs`
- Startup registration: `install-startup.ps1`
- Remove startup registration: `uninstall-startup.ps1`

Configuration is stored in `remote-config.json`. Schedules require the Remote daemon and Windows to be running; they do not wake a sleeping or powered-off machine.

## Verification
Run `node --check server.cjs` and `node test_mobile.cjs`.
