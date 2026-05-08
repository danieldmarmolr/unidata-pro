@echo off
setlocal enabledelayedexpansion
title UNIDATA launcher

set "ROOT=%~dp0"

echo.
echo  ====================================
echo   UNIDATA - launcher
echo  ====================================
echo.

REM --- 1) Backend (uvicorn con SSH tunnels) -----------------------------
echo [1/3] Iniciando BACKEND en :8000 ...
start "UNIDATA backend" /min cmd /k ^
  "cd /d %ROOT%backend && call venv\Scripts\activate && uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

REM --- 2) Frontend (Next.js dev) ----------------------------------------
echo [2/3] Iniciando FRONTEND en :3000 ...
start "UNIDATA frontend" /min cmd /k ^
  "cd /d %ROOT%frontend && npm run dev"

REM --- 3) Esperar a que arranquen y abrir el browser --------------------
echo [3/3] Esperando que el backend este disponible ...
set /a tries=0
:waitloop
set /a tries+=1
powershell -NoProfile -Command "try { (iwr -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8000/api/health).StatusCode -eq 200 | %% { exit 0 } } catch { exit 1 }"
if errorlevel 1 (
  if %tries% lss 30 (
    timeout /t 2 /nobreak >nul
    goto waitloop
  )
  echo.
  echo  Aviso: el backend tardo demasiado. Igual abro el browser.
)

echo.
echo  Abriendo http://localhost:3000 en el browser ...
start "" "http://localhost:3000"

echo.
echo  Listo. Las dos ventanas (backend / frontend) quedan minimizadas.
echo  Para apagar todo, cerralas o ejecuta stop-unidata.bat
echo.
exit /b 0
