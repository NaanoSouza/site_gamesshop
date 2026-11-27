@echo off
chcp 65001 >nul
title Nano
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Nano precisa do Node.js 22 ou mais novo.
  echo  Vou abrir o site para voce baixar. Instale e depois clique de novo em "Iniciar Nano".
  start "" https://nodejs.org/pt
  pause
  exit /b 1
)

if not exist ".env" copy ".env.example" ".env" >nul
if not exist "node_modules" (
  echo Preparando o Nano pela primeira vez...
  call npm install --no-audit --no-fund
)

rem Sobe o servidor do Nano numa janela minimizada (feche essa janela para desligar o Nano).
start "Nano - servidor (pode minimizar)" /min cmd /c "node src\server.js"
timeout /t 2 /nobreak >nul

rem Abre o Nano como aplicativo (janela propria) no Edge, que ja vem no Windows.
start "" msedge --app=http://127.0.0.1:3790
exit /b 0
