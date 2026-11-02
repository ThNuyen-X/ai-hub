# ========================================================
# 9ROUTER & AI AGENT CLI HUB (TAILSCALE VPN)
# ========================================================
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$CurrentDir = (Get-Location).Path
$WorkspaceName = Split-Path -Leaf $CurrentDir
if (-not $WorkspaceName) { $WorkspaceName = $CurrentDir }

# Load only environment assignments from the private launcher; never execute its UI.
$privateConfig = Join-Path $PSScriptRoot 'start-web.bat'
if (-not (Test-Path $privateConfig)) { throw 'Create start-web.bat using the template in README.md first.' }
$envLines = & $env:ComSpec /d /c ('call "' + $privateConfig + '" --export-env >nul && set')
foreach ($line in $envLines) {
    if ($line -match '^(PORT|NINE_ROUTER_[A-Z_]+|GOOSE_PATH|OPENAI_[A-Z_]+|AI_HUB_[A-Z_]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}

# Che do gon gang cho Goose (An cac log doc file, dump code thua tren terminal)
$env:GOOSE_CLI_MIN_PRIORITY = "0.8"
$env:GOOSE_SHOW_FULL_OUTPUT = "false"
$env:GOOSE_CONTEXT_LIMIT = "400000"

# Chi thi he thong (System Prompt) toan cuc cho Goose Agent
$SystemInstruction = @"
QUY TAC BAT BUOC:
- Truoc khi goi lenh shell quan trong (build, deploy, sua file lon, tac dong he thong), BAT BUOC viet 1 cau sieu ngan (duoi 15 tu) thong bao muc dich cho nguoi dung truoc khi goi tool.
- Voi cac thao tac doc nhe (ls, cat, grep nho), hay goi thang lenh va gop thao tac de toi uu toc do phan hoi.
- QUY CHUAN TOI UU TAI NGUYEN & DO MUOT:
  + Khong doc toan bo file lon (>500 dong) khi chi sua doan nho; CAM dung [System.IO.File]::ReadAllText(...) | Select-String gay tran context, hay dung Select-String -Path hoac doc theo khoang dong; luu y chuan dong CRLF tren Windows.
  + Backend/DB: Tranh execSync/spawn trong hot-path API; tranh loi N+1 query; doc SQLite che do readOnly va dong ket noi trong finally; dung TTL cache.
  + Frontend/Stream: Chong goi trung (coalesce/debounce); don sach EventSource/timer/.streaming-cursor khi ket thuc hoac chuyen phien; thanh tien trinh (.live-progress-container) luon dat duoi .ai-content-body.
  + Kiem chung & Tu hoc: Luon chay node --check hoac test lien quan sau khi sua code. Tham khao .goosehints tai workspace va cap nhat bai hoc moi vao D:\ai-hub\lessons.md.
"@

Clear-Host
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "       9ROUTER & AI AGENT CLI HUB (TAILSCALE VPN)       " -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Thu muc hien tai: $CurrentDir" -ForegroundColor Green
Write-Host "Endpoint VPS    : $env:OPENAI_API_BASE"

# Kiem tra thu muc hien tai co phai la Git Repo khong
$isGit = $false
$currentBranch = ""
try {
    $gitCheck = git rev-parse --is-inside-work-tree 2>$null
    if ($gitCheck -eq "true") {
        $isGit = $true
        $currentBranch = (git branch --show-current 2>$null).Trim()
    }
} catch {}

if ($isGit) {
    Write-Host "Git Repository  : Hop le (Branch: $currentBranch)" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "[!] CANH BAO: Thu muc nay KHONG PHAI la Git Repository!" -ForegroundColor Yellow
    Write-Host "    AI se khong the doc lich su commit hoac commit code tu dong." -ForegroundColor Gray
    Write-Host ""
    $customDir = Read-Host "Nhap duong dan thu muc du an (vd: C:\projects\my-app) hoac Enter de bo qua"
    if ($customDir -and (Test-Path $customDir)) {
        Set-Location $customDir
        $CurrentDir = (Get-Location).Path
        $WorkspaceName = Split-Path -Leaf $CurrentDir
        Write-Host "-> Da chuyen sang: $CurrentDir" -ForegroundColor Green
    }
}

# Dat ten Tab / Cua so theo ten workspace
$TabTitle = "$WorkspaceName - AI Hub"
$host.UI.RawUI.WindowTitle = $TabTitle
[Console]::Title = $TabTitle
Write-Host "$([char]27)]0;$TabTitle$([char]7)" -NoNewline

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "CHON AGENT & MODEL BAN MUON DUNG:" -ForegroundColor White
Write-Host ""
Write-Host "  [1] Claude Code (Anthropic)    - Agent tu hanh dinh nhat (chinh chu Claude)" -ForegroundColor Green
Write-Host "  [2] Goose + Codex/ChatGPT      - Agent tu hanh qua 9Router (cx/gpt-6.1-sol)" -ForegroundColor Yellow
Write-Host "  [3] Goose + Gemini 3.8 Flash   - Agent tu hanh qua 9Router (ag/gemini-3.8-flash)" -ForegroundColor Cyan
Write-Host "  [4] Goose + Claude Sonnet      - Agent tu hanh qua 9Router (ag/claude-sonnet-5-5-high)" -ForegroundColor Magenta
Write-Host "  [5] Goose + Gemini 4 Argon     - Agent tu hanh qua 9Router (ag/gemini-4-argon-high)" -ForegroundColor Red
Write-Host "  [6] Aider (Pair Programming)   - Aider truyen thong (--yes-always)" -ForegroundColor Gray
Write-Host "  [7] Mo giao dien Web Pro UI    - Chay tren trinh duyet (http://localhost:20130)" -ForegroundColor Blue
Write-Host "  [0] Thoat" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Cyan

$choice = Read-Host "Nhap so lua chon (0-7)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Dang khoi chay Claude Code tai: $CurrentDir" -ForegroundColor Green
        Write-Host "--------------------------------------------------------" -ForegroundColor Gray
        claude
    }
    "2" {
        $env:GOOSE_PROVIDER = "openai"
        $env:GOOSE_MODEL = "cx/gpt-6.1-sol"
        Write-Host ""
        Write-Host "Dang khoi chay Goose (Codex 9Router) tai: $CurrentDir" -ForegroundColor Yellow
        Write-Host "--------------------------------------------------------" -ForegroundColor Gray
        goose session --system $SystemInstruction
    }
    "3" {
        $env:GOOSE_PROVIDER = "openai"
        $env:GOOSE_MODEL = "ag/gemini-3.8-flash"
        Write-Host ""
        Write-Host "Dang khoi chay Goose (Gemini Flash 9Router) tai: $CurrentDir" -ForegroundColor Cyan
        Write-Host "--------------------------------------------------------" -ForegroundColor Gray
        goose session --system $SystemInstruction
    }
    "4" {
        $env:GOOSE_PROVIDER = "openai"
        $env:GOOSE_MODEL = "ag/claude-sonnet-5-5-high"
        Write-Host ""
        Write-Host "Dang khoi chay Goose (Claude Sonnet 9Router) tai: $CurrentDir" -ForegroundColor Magenta
        Write-Host "--------------------------------------------------------" -ForegroundColor Gray
        goose session --system $SystemInstruction
    }
    "5" {
        $env:GOOSE_PROVIDER = "openai"
        $env:GOOSE_MODEL = "ag/gemini-4-argon-high"
        Write-Host ""
        Write-Host "Dang khoi chay Goose (Gemini 4 Argon 9Router) tai: $CurrentDir" -ForegroundColor Red
        Write-Host "--------------------------------------------------------" -ForegroundColor Gray
        goose session --system $SystemInstruction
    }
    "6" {
        $selectedModel = "openai/cx/gpt-6.1-sol"
        Write-Host ""
        Write-Host "Dang khoi chay Aider tai: $CurrentDir" -ForegroundColor Gray
        Write-Host "--------------------------------------------------------" -ForegroundColor Gray
        aider `
            --chat-language Vietnamese `
            --yes-always `
            --auto-commits `
            --map-tokens 2048 `
            --no-show-model-warnings `
            --no-check-update `
            --model $selectedModel `
            --openai-api-base $env:OPENAI_API_BASE `
            --openai-api-key $env:OPENAI_API_KEY
    }
    "7" {
        Write-Host ""
        Write-Host "Dang mo giao dien Web Pro tren trinh duyet..." -ForegroundColor Cyan
        Start-Process "http://localhost:20130"
        $serverJs = "$PSScriptRoot\server.js"
        if (-not (Test-Path $serverJs)) { $serverJs = "$PSScriptRoot\ai-hub-web\server.js" }
        node $serverJs
    }
    "0" { exit }
    default {
        Write-Host "Lua chon khong hop le." -ForegroundColor Red
    }
}
