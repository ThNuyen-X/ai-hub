# AI Hub

Local web and CLI launchers for an AI coding workspace.

## Repository Layout

- `ai-hub-web/`: web UI, Node.js server and regression tests.
- `start-web.bat`: private local configuration, excluded from Git.
- `run-ai.bat` and `run-ai.ps1`: CLI menus; both load configuration from the private launcher.

## Local Setup

Requires Windows, a recent Node.js version with `node:sqlite`, and the agent executable used by the launchers.

1. Create `start-web.bat` using the template below if no private launcher exists. Do not overwrite an existing private launcher.
2. Set the router address, port and API key in the private file. Set `GOOSE_PATH` to the installed executable if necessary.
3. Launch `start-web.bat` for the web UI, or use a `run-ai` launcher for the CLI menu.

The launchers resolve the server relative to their own location, so the repository can be cloned into another directory.

## Private Launcher Template

Create this file beside the README as `start-web.bat`. Keep real credentials only in that ignored local file.

```bat
@echo off
chcp 65001 >nul
if /i "%~1"=="--export-env" goto CONFIG
setlocal
call :CONFIG
if not defined NINE_ROUTER_KEY (
    echo Configure NINE_ROUTER_KEY in your private start-web.bat first.
    exit /b 1
)
set "SERVER_JS=%~dp0ai-hub-web\server.js"
if not exist "%SERVER_JS%" (
    echo Cannot find ai-hub-web\server.js next to this launcher.
    exit /b 1
)
start "" "http://localhost:%PORT%"
node "%SERVER_JS%"
pause
exit /b

:CONFIG
set "PORT=20130"
set "NINE_ROUTER_IP=127.0.0.1"
set "NINE_ROUTER_PORT=20128"
set "NINE_ROUTER_KEY="
set "GOOSE_PATH=%USERPROFILE%\.local\bin\goose.exe"
rem Bind to localhost by default. Use 0.0.0.0 only on a trusted, firewalled network.
set "AI_HUB_HOST=127.0.0.1"
set "AI_HUB_DEFAULT_WORKSPACE="
rem Optional semicolon-separated directories searched by the folder matcher.
set "AI_HUB_SEARCH_ROOTS="
set "AI_HUB_SCRATCH_ROOT=D:\ai-hub\ai-hub-data\scratch"
set "OPENAI_HOST=http://%NINE_ROUTER_IP%:%NINE_ROUTER_PORT%"
set "OPENAI_BASE_URL=%OPENAI_HOST%/v1"
set "OPENAI_API_BASE=%OPENAI_BASE_URL%"
set "OPENAI_API_KEY=%NINE_ROUTER_KEY%"
exit /b

```

## Application Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Web port | `20130` |
| `NINE_ROUTER_IP` | Router address | `127.0.0.1` |
| `NINE_ROUTER_PORT` | Router port | `20128` |
| `NINE_ROUTER_KEY` | Private router credential | Empty |
| `AI_HUB_HOST` | Web bind address | `127.0.0.1` |
| `AI_HUB_DEFAULT_WORKSPACE` | Optional fallback workspace | Current directory |
| `AI_HUB_SEARCH_ROOTS` | Optional semicolon-separated folder search roots | Saved workspaces, home directory and current directory |
| `AI_HUB_TAILSCALE_IP` | Display fallback when address discovery fails | `127.0.0.1` |
| `AI_HUB_SCRATCH_ROOT` | Root for disposable web-agent files, grouped by workspace/session/turn | `D:\ai-hub\ai-hub-data\scratch` |

The private launcher also exports compatible OpenAI endpoint variables for child processes. `start-web.bat --export-env` loads configuration without starting the web server.

## Disposable Agent Files

Web agent runs receive `AI_HUB_SCRATCH_DIR` and `TEMP`/`TMP`/`TMPDIR` pointing to a unique directory under `AI_HUB_SCRATCH_ROOT/<workspace-key>/<session-key>/<turn-id>`. A new session uses its temporary session key until a later resumed turn has its database ID. The Windows launcher uses the absolute root `D:\ai-hub\ai-hub-data\scratch`. Workspace configuration can override `AI_HUB_SCRATCH_ROOT`; Windows `%VARIABLE%` references are expanded before use, and unresolved percent paths fall back to the actual local application-data directory. The agent is instructed to store disposable scripts, OCR output, crops and screenshots there instead of the project tree.

Only the owned turn directory is removed, asynchronously after the agent process closes (including stop or spawn-error paths). Concurrent turns are isolated. Final deliverables must be saved outside scratch before completion. Abrupt server/machine termination can leave scratch behind; AI Hub does not sweep arbitrary directories or delete existing untracked project files. CLI menus import the root setting, but automatic per-turn management applies to web runs only.

## Private Data And Publishing

Never commit `start-web.bat`, `.env` files, API keys, database files, logs or backups. Workspace state in `ai-hub-web/workspaces.json` is local and ignored. Chat history is stored outside this repository in the installed agent's local data directory.

Review the staged diff before pushing. `.gitignore` prevents new ignored files from being added normally; it does not remove secrets from existing commits or files already tracked. If a credential was previously published, revoke and replace it.

## Network Safety

This application can execute agent tasks, browse local files and delete chat history. It does not currently implement authentication. Do not expose it directly to the public Internet. The committed template binds to localhost. Opting into `AI_HUB_HOST=0.0.0.0` requires a trusted network, firewall rules and appropriate access controls.

## Regression Tests

Run from `ai-hub-web`:

```bat
node test_session_context.cjs
node test_session_title.cjs
node test_session_visibility.cjs
node test_workspace_path.cjs
node test_chat_ui.cjs
node test_conversation_modal.cjs
node test_tooltips.cjs
```
