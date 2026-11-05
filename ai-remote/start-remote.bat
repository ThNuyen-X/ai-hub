@echo off
chcp 65001 >nul
title AI Hub Remote Daemon
cd /d "%~dp0"
node server.cjs
pause
