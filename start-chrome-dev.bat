@echo off
setlocal
set "PROFILE=%LOCALAPPDATA%\ai-hub\chrome-dev-profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"

set "CHROME_BIN="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME_BIN if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined CHROME_BIN if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if not defined CHROME_BIN (
  echo [ERROR] Google Chrome was not found on standard paths.
  pause
  exit /b 1
)

echo Starting AI Hub Dedicated Chrome Dev on port 9223...
start "" "%CHROME_BIN%" --remote-debugging-port=9223 --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check
