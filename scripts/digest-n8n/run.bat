@echo off
REM Deploy del workflow People digest a n8n cloud.
REM Editar las 4 env vars de abajo antes de correr.

setlocal

REM ============================================================
REM 1. n8n cloud
REM ============================================================
set "N8N_BASE_URL=https://unistore-it.app.n8n.cloud/api/v1"
set "N8N_API_KEY=PEGA_TU_N8N_JWT_AQUI"

REM ============================================================
REM 2. UNIDATA (genera en https://app.unidatacenter.com.ar/dashboard/account)
REM    Boton "Generar token" -> scope mcp -> 90 dias
REM ============================================================
set "UNIDATA_TOKEN=PEGA_TU_UNIDATA_JWT_AQUI"

REM ============================================================
REM 3. Resend (https://resend.com/api-keys)
REM    Necesitas verificar el dominio unidatacenter.com.ar primero
REM    (Resend -> Domains -> Add) o usar el de prueba "onboarding@resend.dev"
REM ============================================================
set "RESEND_API_KEY=re_PEGA_TU_RESEND_KEY_AQUI"
set "RESEND_FROM=UNIDATA <people@unidatacenter.com.ar>"

REM ============================================================
REM Run
REM ============================================================
cd /d "%~dp0"
python deploy.py %*

endlocal
pause
