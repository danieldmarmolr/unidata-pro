#!/usr/bin/env bash
# Cutover smoke tests — UNIDATA Railway -> AWS
#
# Uso:
#   ./scripts/cutover_smoke_tests.sh [pre-cutover|post-aws-deploy|post-dns-cutover|final] [JWT]
#
# Modos:
#   pre-cutover         Validar estado actual antes de empezar
#   post-aws-deploy     Validar AWS via api-aws.~ + mcp.~ (subdomains temporales)
#   post-dns-cutover    Validar app/api/mcp.~ ya apuntan a AWS
#   final               Tests funcionales completos (requiere JWT)
#
# El JWT se obtiene en https://app.unidatacenter.com.ar -> F12 -> Console:
#   copy(localStorage.getItem('unidata.token'))

set -u

MODE="${1:-pre-cutover}"
JWT="${2:-}"

# Colores
G='\033[0;32m'  # green
R='\033[0;31m'  # red
Y='\033[0;33m'  # yellow
B='\033[0;34m'  # blue
N='\033[0m'     # normal

pass=0
fail=0
warn=0

# Helper: test HTTP endpoint con expected status code
check() {
    local label="$1"
    local url="$2"
    local expected="$3"
    local extra_args="${4:-}"

    local result
    if [[ -n "$extra_args" ]]; then
        result=$(curl -s -w "%{http_code}|%{time_total}" -o /dev/null --max-time 15 $extra_args "$url" 2>&1)
    else
        result=$(curl -s -w "%{http_code}|%{time_total}" -o /dev/null --max-time 15 "$url" 2>&1)
    fi

    local code="${result%|*}"
    local time="${result#*|}"

    if [[ "$code" == "$expected" ]]; then
        printf "${G}  PASS${N}  %-60s ${G}%s${N} in %.2fs\n" "$label" "$code" "$time"
        pass=$((pass+1))
    else
        printf "${R}  FAIL${N}  %-60s expected ${expected}, got ${R}%s${N} in %.2fs\n" "$label" "$code" "$time"
        fail=$((fail+1))
    fi
}

# Helper: detectar backend a partir del cert TLS (funciona aunque el record este proxied en Cloudflare)
check_backend_identity() {
    local host="$1"
    local expected="$2"  # "railway" | "aws"

    # SNI handshake -> issuer del cert
    local issuer
    issuer=$(echo | openssl s_client -servername "$host" -connect "$host:443" -verify_quiet 2>/dev/null \
        | openssl x509 -noout -issuer 2>/dev/null)

    local detected="unknown"
    case "$issuer" in
        *"Let's Encrypt"*|*"R3"*|*"R10"*|*"R11"*) detected="railway" ;;
        *"Amazon"*) detected="aws" ;;
        *"Cloudflare"*) detected="cloudflare-proxy" ;;
    esac

    if [[ "$detected" == "$expected" ]]; then
        printf "${G}  PASS${N}  %-60s -> backend: %s (cert issuer match)\n" "$host" "$detected"
        pass=$((pass+1))
    else
        printf "${R}  FAIL${N}  %-60s expected '%s', got '%s' (issuer: %s)\n" "$host" "$expected" "$detected" "$issuer"
        fail=$((fail+1))
    fi
}

# Helper: test DNS resolves to expected target substring (solo para DNS-only records)
check_dns() {
    local host="$1"
    local expected_substr="$2"

    local result
    result=$(nslookup -type=CNAME "$host" 8.8.8.8 2>&1 | grep canonical | head -1 | awk -F'= ' '{print $2}' | tr -d ' ')

    if [[ -z "$result" ]]; then
        result=$(nslookup "$host" 8.8.8.8 2>&1 | grep -A1 "Name:" | grep "Address:" | head -1)
    fi

    if [[ "$result" == *"$expected_substr"* ]]; then
        printf "${G}  PASS${N}  %-60s -> %s\n" "DNS $host" "$result"
        pass=$((pass+1))
    else
        printf "${R}  FAIL${N}  %-60s expected '*${expected_substr}*', got '%s'\n" "DNS $host" "$result"
        fail=$((fail+1))
    fi
}

# Helper: test endpoint with JWT and check response contains substring
check_json() {
    local label="$1"
    local url="$2"
    local jwt="$3"
    local expected_substr="$4"

    local body
    body=$(curl -s --max-time 30 -H "Authorization: Bearer $jwt" "$url" 2>&1)

    if [[ "$body" == *"$expected_substr"* ]]; then
        printf "${G}  PASS${N}  %-60s contains '${expected_substr:0:40}...'\n" "$label"
        pass=$((pass+1))
    else
        printf "${R}  FAIL${N}  %-60s missing '${expected_substr:0:40}...'\n" "$label"
        printf "        response: %.150s\n" "$body"
        fail=$((fail+1))
    fi
}

echo ""
echo -e "${B}══════════════════════════════════════════════════════════════════${N}"
echo -e "${B}  UNIDATA Cutover Smoke Tests · Mode: ${MODE}${N}"
echo -e "${B}  $(date)${N}"
echo -e "${B}══════════════════════════════════════════════════════════════════${N}"
echo ""

case "$MODE" in
    pre-cutover)
        echo -e "${Y}Estado baseline ANTES de tocar nada${N}"
        echo ""
        echo -e "${B}[1] Railway productivo (sigue vivo)${N}"
        check "Backend Railway /api/health"      "https://api.unidatacenter.com.ar/api/health"  "200"
        check "Frontend Railway /"               "https://app.unidatacenter.com.ar"             "200"
        echo ""
        echo -e "${B}[2] AWS paralelo (validado en otros pasos)${N}"
        check "Backend AWS via api-aws.~"        "https://api-aws.unidatacenter.com.ar/api/health"  "200"
        check "MCP AWS via mcp.~"                "https://mcp.unidatacenter.com.ar/whoami-probe"    "200"
        echo ""
        echo -e "${B}[3] DNS state (debe apuntar a Railway todavía)${N}"
        check_dns "api.unidatacenter.com.ar"   "railway.app"
        check_dns "app.unidatacenter.com.ar"   "railway.app"
        check_dns "api-aws.unidatacenter.com.ar" "amazonaws.com"
        check_dns "mcp.unidatacenter.com.ar"   "amazonaws.com"
        ;;

    post-aws-deploy)
        echo -e "${Y}Validar AWS estable via subdomains temporales${N}"
        echo ""
        check "Backend AWS healthcheck"          "https://api-aws.unidatacenter.com.ar/api/health"  "200"
        check "Backend AWS redirect HTTP->HTTPS" "http://api-aws.unidatacenter.com.ar/api/health"   "301"
        check "MCP AWS whoami-probe"             "https://mcp.unidatacenter.com.ar/whoami-probe"    "200"
        check "Backend AWS login (creds inválidas → 401, no 500)" \
            "https://api-aws.unidatacenter.com.ar/api/auth/login" "401" \
            "-X POST -H Content-Type:application/json -d {\"email\":\"x\",\"password\":\"x\"}"
        ;;

    post-dns-cutover)
        echo -e "${Y}Validar que app/api/mcp ya apuntan a AWS${N}"
        echo ""
        echo -e "${B}[1] DNS apuntando a AWS (post-cutover)${N}"
        check_dns "api.unidatacenter.com.ar"  "amazonaws.com"
        check_dns "app.unidatacenter.com.ar"  "amplifyapp.com"
        check_dns "mcp.unidatacenter.com.ar"  "amazonaws.com"
        echo ""
        echo -e "${B}[2] HTTPS endpoints vivos en sus dominios productivos${N}"
        check "Backend api.~ via AWS"            "https://api.unidatacenter.com.ar/api/health"  "200"
        check "MCP mcp.~ via AWS"                "https://mcp.unidatacenter.com.ar/whoami-probe" "200"
        check "Frontend app.~ via Amplify"       "https://app.unidatacenter.com.ar"             "200"
        ;;

    final)
        if [[ -z "$JWT" ]]; then
            echo -e "${R}ERROR${N}: en modo 'final' necesitás JWT como 2do argumento."
            echo "Usage: $0 final <JWT>"
            exit 1
        fi
        echo -e "${Y}Tests funcionales E2E con JWT real${N}"
        echo ""
        echo -e "${B}[1] Auth + Supabase via api.~ (productivo, AWS)${N}"
        check_json "/api/auth/me"                "https://api.unidatacenter.com.ar/api/auth/me" "$JWT" "daniel.marmol"
        echo ""
        echo -e "${B}[2] Engines productivos via api.~ (AWS via VPC privada)${N}"
        check_json "/api/dashboards/executive?unit=unistore" \
            "https://api.unidatacenter.com.ar/api/dashboards/executive?unit=unistore&period=7d" \
            "$JWT" "GMV"
        check_json "/api/dashboards/executive?unit=unidrop" \
            "https://api.unidatacenter.com.ar/api/dashboards/executive?unit=unidrop&period=7d" \
            "$JWT" "GMV"
        check_json "/api/dashboards/executive?unit=unidev" \
            "https://api.unidatacenter.com.ar/api/dashboards/executive?unit=unidev&period=7d" \
            "$JWT" "cards"
        echo ""
        echo -e "${B}[3] Endpoint que requiere multi-schema join (gerencia)${N}"
        check_json "/api/dashboards/gerencia"    "https://api.unidatacenter.com.ar/api/dashboards/gerencia?period=7d" "$JWT" "unistore"
        echo ""
        echo -e "${B}[4] Frontend Amplify (login page accessible)${N}"
        check "Frontend Amplify /login"          "https://app.unidatacenter.com.ar/login"       "200"
        ;;

    *)
        echo -e "${R}ERROR${N}: modo desconocido '$MODE'"
        echo "Usage: $0 [pre-cutover|post-aws-deploy|post-dns-cutover|final] [JWT]"
        exit 1
        ;;
esac

echo ""
echo -e "${B}══════════════════════════════════════════════════════════════════${N}"
if [[ $fail -eq 0 ]]; then
    echo -e "${G}  ✓ Todos los tests pasaron: ${pass} OK${N}"
    exit 0
else
    echo -e "${R}  ✗ ${fail} tests fallaron / ${pass} OK${N}"
    echo -e "${R}    NO continuar con el cutover hasta resolverlos.${N}"
    exit 1
fi
