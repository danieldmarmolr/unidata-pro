@echo off
title UNIDATA stop
echo.
echo Apagando UNIDATA (backend + frontend) ...
echo.

REM Mata uvicorn (backend) y node (frontend) que escuchan en 8000 y 3000
for /f "tokens=5" %%P in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (
  echo  Killing backend PID %%P
  taskkill /F /PID %%P >nul 2>&1
)
for /f "tokens=5" %%P in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
  echo  Killing frontend PID %%P
  taskkill /F /PID %%P >nul 2>&1
)

REM Cierra las ventanas auxiliares por titulo
taskkill /FI "WINDOWTITLE eq UNIDATA backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq UNIDATA frontend*" /F >nul 2>&1

echo.
echo Listo.
timeout /t 2 /nobreak >nul
exit /b 0
