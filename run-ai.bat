@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

if not exist "%~dp0start-web.bat" (
    echo Missing private start-web.bat. Create it using the template in README.md.
    exit /b 1
)
call "%~dp0start-web.bat" --export-env

REM Che do gon gang cho Goose (An log doc file va lenh shell dai dong)
set GOOSE_CLI_MIN_PRIORITY=0.8
set GOOSE_SHOW_FULL_OUTPUT=false

REM Chi thi he thong (System Prompt) toan cuc cho Goose Agent
set SYSTEM_INSTRUCTION=QUY TAC BAT BUOC: (1) Truoc khi goi lenh shell quan trong (build, deploy, sua file lon, tac dong he thong), BAT BUOC viet 1 cau sieu ngan (duoi 15 tu) thong bao muc dich truoc khi goi tool. (2) Voi thao tac doc nhe (ls, cat, grep nho), goi thang lenh va gop thao tac de toi uu toc do. (3) QUY CHUAN TOI UU TAI NGUYEN: Khong doc toan bo file lon khi chi sua doan nho; luu y CRLF tren Windows; tranh execSync/N+1 query; doc SQLite che do readOnly va dong trong finally; dung TTL cache; chong goi trung (coalesce) va don sach EventSource/timer tren UI; luon chay node --check hoac test sau khi sua code. (4) Tu dong doc .goosehints tai workspace va cap nhat bai hoc moi vao D:\ai-hub\lessons.md.

:CHECK_DIR
for %%I in ("%CD%") do set "WORKSPACE_NAME=%%~nxI"
if "%WORKSPACE_NAME%"=="" set "WORKSPACE_NAME=%CD%"

title %WORKSPACE_NAME% - AI Hub

cls
echo ========================================================
echo        9ROUTER & AI AGENT CLI HUB (TAILSCALE VPN)
echo ========================================================
echo Thu muc hien tai: %CD%
echo Endpoint VPS    : %OPENAI_API_BASE%

REM Kiem tra Git
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo.
    echo [!] CANH BAO: Thu muc nay KHONG PHAI la Git Repository!
    echo     AI se khong the doc lich su commit hoac commit tu dong.
    echo.
    set /p CUSTOM_DIR="Nhap duong dan thu muc du an (vd: C:\projects\my-app) hoac Enter de bo qua: "
    if defined CUSTOM_DIR (
        if exist "!CUSTOM_DIR!" (
            cd /d "!CUSTOM_DIR!"
            goto CHECK_DIR
        )
    )
) else (
    echo Git Repository  : Hop le
)

echo ========================================================
echo.
echo CHON AGENT & MODEL BAN MUON DUNG:
echo.
echo  [1] Claude Code (Anthropic)    - Agent tu hanh dinh nhat (chinh chu Claude)
echo  [2] Goose + Codex/ChatGPT      - Agent tu hanh qua 9Router (cx/gpt-6.1-sol)
echo  [3] Goose + Gemini 3.8 Flash   - Agent tu hanh qua 9Router (ag/gemini-3.8-flash-high)
echo  [4] Goose + Claude Sonnet      - Agent tu hanh qua 9Router (ag/claude-sonnet-5-5-high)
echo  [5] Goose + Gemini 4 Argon     - Agent tu hanh qua 9Router (ag/gemini-4-argon-high)
echo  [6] Aider (Pair Programming)   - Aider truyen thong (--yes-always)
echo  [7] Mo giao dien Web Pro UI    - Chay tren trinh duyet (http://localhost:20130)
echo  [0] Thoat
echo ========================================================
set /p CHOICE="Nhap so lua chon (0-7): "

if "%CHOICE%"=="1" goto RUN_CLAUDE
if "%CHOICE%"=="2" goto RUN_GOOSE_CODEX
if "%CHOICE%"=="3" goto RUN_GOOSE_GEMINI
if "%CHOICE%"=="4" goto RUN_GOOSE_CLAUDE
if "%CHOICE%"=="5" goto RUN_GOOSE_ARGON
if "%CHOICE%"=="6" goto RUN_AIDER
if "%CHOICE%"=="7" goto RUN_WEB
if "%CHOICE%"=="0" exit /b
goto CHECK_DIR

:RUN_CLAUDE
echo.
echo Dang khoi chay Claude Code tai: %CD%
echo --------------------------------------------------------
claude
goto END

:RUN_GOOSE_CODEX
set GOOSE_PROVIDER=openai
set GOOSE_MODEL=cx/gpt-6.1-sol
echo.
echo Dang khoi chay Goose (Codex 9Router) tai: %CD%
echo --------------------------------------------------------
goose session --system "%SYSTEM_INSTRUCTION%"
goto END

:RUN_GOOSE_GEMINI
set GOOSE_PROVIDER=openai
set GOOSE_MODEL=ag/gemini-3.8-flash-high
echo.
echo Dang khoi chay Goose (Gemini Flash 9Router) tai: %CD%
echo --------------------------------------------------------
goose session --system "%SYSTEM_INSTRUCTION%"
goto END

:RUN_GOOSE_CLAUDE
set GOOSE_PROVIDER=openai
set GOOSE_MODEL=ag/claude-sonnet-5-5-high
echo.
echo Dang khoi chay Goose (Claude Sonnet 9Router) tai: %CD%
echo --------------------------------------------------------
goose session --system "%SYSTEM_INSTRUCTION%"
goto END

:RUN_GOOSE_ARGON
set GOOSE_PROVIDER=openai
set GOOSE_MODEL=ag/gemini-4-argon-high
echo.
echo Dang khoi chay Goose (Gemini 4 Argon 9Router) tai: %CD%
echo --------------------------------------------------------
goose session --system "%SYSTEM_INSTRUCTION%"
goto END

:RUN_AIDER
echo.
echo Dang khoi chay Aider tai: %CD%
echo --------------------------------------------------------
aider --chat-language Vietnamese --yes-always --auto-commits --map-tokens 2048 --no-show-model-warnings --no-check-update --model openai/cx/gpt-6.1-sol --openai-api-base %OPENAI_API_BASE% --openai-api-key %OPENAI_API_KEY%
goto END

:RUN_WEB
echo.
echo Dang mo Web Pro UI tren trinh duyet...
start http://localhost:20130
set "SERVER_JS=%~dp0server.js"
if not exist "%SERVER_JS%" set "SERVER_JS=%~dp0ai-hub-web\server.js"
node "%SERVER_JS%"
goto END

:END
pause
