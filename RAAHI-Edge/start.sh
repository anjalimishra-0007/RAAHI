#!/usr/bin/env bash
# ==============================================================================
# RAAHI-Edge: Unified Operational Startup Supervisor
# ==============================================================================
# Launches the complete local RAAHI Edge AI appliance stack:
# 1. MediaMTX RTSP Proxy Server (Port 8555) using mediamtx.yml
# 2. Edge AI Pipeline Coordinator & FastAPI Server (Port 5050)
# 3. React 18 / Vite In-Cabin Operator Dashboard (Port 5174)
#
# Supported flags:
#   --check           Verify environment and exit without starting services
#   --no-dashboard    Start only MediaMTX and FastAPI server (headless mode)
#   --no-open         Do not automatically open browser to dashboard
#   --tabs            Launch in separate macOS Terminal tabs (macOS only)
#   --kill-existing   Automatically kill stale processes on ports 8555, 5050, 5174
# ==============================================================================

set -euo pipefail

# Text styling
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1" >&2; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${PROJECT_ROOT}"

# Add standard Homebrew and local binary paths to PATH for macOS/Linux
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Load .env if present
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
fi

# Ensure Central URL defaults to production platform for team operations
export CENTRAL_URL="${CENTRAL_URL:-https://raahi.feminismindia.com}"

# Parse command-line flags
CHECK_ONLY=false
NO_DASHBOARD=false
NO_OPEN=false
USE_TABS=false
KILL_EXISTING=false

for arg in "$@"; do
    case "$arg" in
        --check) CHECK_ONLY=true ;;
        --no-dashboard) NO_DASHBOARD=true ;;
        --no-open) NO_OPEN=true ;;
        --tabs) USE_TABS=true ;;
        --kill-existing) KILL_EXISTING=true ;;
        -h|--help)
            echo "Usage: ./start.sh [options]"
            echo "Options:"
            echo "  --check          Verify prerequisites and configuration, then exit"
            echo "  --no-dashboard   Start only MediaMTX and Edge API server (headless)"
            echo "  --no-open        Do not open browser to operator dashboard"
            echo "  --tabs           Launch services in separate macOS Terminal tabs"
            echo "  --kill-existing  Kill stale processes holding ports 8555, 5050, 5174"
            exit 0
            ;;
        *)
            log_error "Unknown option: $arg"
            exit 1
            ;;
    esac
done

echo -e "${BOLD}======================================================================${NC}"
echo -e "${BOLD}         RAAHI-Edge Autonomous Perception Stack Startup              ${NC}"
echo -e "${BOLD}======================================================================${NC}"

# ------------------------------------------------------------------------------
# 1. Pre-flight Environment Checks
# ------------------------------------------------------------------------------
log_info "Verifying local environment readiness..."

VENV_PYTHON="${PROJECT_ROOT}/venv/bin/python"

if [ ! -f "${VENV_PYTHON}" ]; then
    log_error "Python virtual environment not found at venv/."
    echo "  Please run first-time setup:"
    echo "    ./setup.sh"
    exit 1
fi

if ! command -v mediamtx >/dev/null 2>&1; then
    log_error "MediaMTX binary not found in PATH."
    echo "  Please install with 'brew install mediamtx' or run './setup.sh'."
    exit 1
fi

if [ ! -f "mediamtx.yml" ]; then
    log_error "mediamtx.yml configuration file not found!"
    exit 1
fi

if [ ! -f "config.yaml" ]; then
    log_error "config.yaml configuration file not found!"
    exit 1
fi

if [ "${NO_DASHBOARD}" = false ] && [ ! -d "dashboard/node_modules" ]; then
    log_error "Dashboard dependencies not installed at dashboard/node_modules/."
    echo "  Please run './setup.sh' or 'cd dashboard && npm install'."
    exit 1
fi

log_success "Core environment verified."

# ------------------------------------------------------------------------------
# 2. Port Conflict Checks & Management
# ------------------------------------------------------------------------------
check_port() {
    local port="$1"
    local name="$2"
    local pid
    pid="$(lsof -ti:"${port}" 2>/dev/null || true)"
    if [ -n "${pid}" ]; then
        if [ "${KILL_EXISTING}" = true ]; then
            log_warn "Port ${port} (${name}) occupied by PID ${pid}. Killing existing process..."
            kill -9 ${pid} 2>/dev/null || true
            sleep 0.5
        else
            log_error "Port ${port} (${name}) is already in use by process PID: ${pid}."
            echo "  Run './start.sh --kill-existing' to terminate stale processes,"
            echo "  or kill manually with: kill -9 ${pid}"
            exit 1
        fi
    fi
}

check_port 8555 "MediaMTX RTSP"
check_port 5050 "Edge FastAPI API"
if [ "${NO_DASHBOARD}" = false ]; then
    check_port 5174 "Vite Dashboard"
fi

# ------------------------------------------------------------------------------
# 3. LAN IP & Central Target Reporting
# ------------------------------------------------------------------------------
LAN_IP=""
if [ "$(uname -s)" = "Darwin" ]; then
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
fi

if [ -z "${LAN_IP}" ]; then
    LAN_IP="$("${VENV_PYTHON}" -c '
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    print(s.getsockname()[0])
    s.close()
except Exception:
    print("127.0.0.1")
' 2>/dev/null || echo "127.0.0.1")"
fi

log_info "Outbound Central Endpoint : ${BOLD}${GREEN}${CENTRAL_URL}${NC}"
log_info "Local Machine LAN IP      : ${BOLD}${CYAN}${LAN_IP}${NC}"
log_info "Android RAAHI-Eye Target  : ${BOLD}${CYAN}rtsp://${LAN_IP}:8555/live${NC}"

if [ "${CHECK_ONLY}" = true ]; then
    log_success "All pre-flight startup checks PASSED (--check mode)."
    exit 0
fi

# ------------------------------------------------------------------------------
# 4. macOS Terminal Tabs Mode (--tabs)
# ------------------------------------------------------------------------------
if [ "${USE_TABS}" = true ] && [ "$(uname -s)" = "Darwin" ]; then
    log_info "Launching services in separate macOS Terminal tabs..."
    
    osascript <<EOF
tell application "Terminal"
    activate
    -- Window 1: MediaMTX
    do script "cd \"${PROJECT_ROOT}\" && mediamtx mediamtx.yml"
    
    -- Window 2: Edge FastAPI Server
    tell application "System Events" to tell process "Terminal" to keystroke "t" using command down
    delay 0.5
    do script "cd \"${PROJECT_ROOT}\" && export CENTRAL_URL=\"${CENTRAL_URL}\" && ./venv/bin/python -m uvicorn server.api_server:app --host 0.0.0.0 --port 5050" in selected tab of the front window
    
    -- Window 3: Dashboard (if enabled)
    if "${NO_DASHBOARD}" is "false" then
        tell application "System Events" to tell process "Terminal" to keystroke "t" using command down
        delay 0.5
        do script "cd \"${PROJECT_ROOT}/dashboard\" && npm run dev" in selected tab of the front window
    end if
end tell
EOF

    log_success "Services launched in macOS Terminal tabs."
    if [ "${NO_OPEN}" = false ] && [ "${NO_DASHBOARD}" = false ]; then
        sleep 2
        open "http://localhost:5174" 2>/dev/null || true
    fi
    exit 0
fi

# ------------------------------------------------------------------------------
# 5. Unified Foreground Process Supervisor (Default Mode)
# ------------------------------------------------------------------------------
mkdir -p "${PROJECT_ROOT}/data"

MEDIAMTX_LOG="${PROJECT_ROOT}/data/mediamtx_runtime.log"
API_LOG="${PROJECT_ROOT}/data/api_runtime.log"
DASHBOARD_LOG="${PROJECT_ROOT}/data/dashboard_runtime.log"

MEDIAMTX_PID=""
API_PID=""
DASHBOARD_PID=""

cleanup() {
    trap - SIGINT SIGTERM EXIT
    echo -e "\n${BOLD}${YELLOW}[*] Shutting down RAAHI-Edge services cleanly...${NC}"
    
    if [ -n "${DASHBOARD_PID}" ] && kill -0 "${DASHBOARD_PID}" 2>/dev/null; then
        kill -TERM "${DASHBOARD_PID}" 2>/dev/null || true
    fi
    if [ -n "${API_PID}" ] && kill -0 "${API_PID}" 2>/dev/null; then
        kill -TERM "${API_PID}" 2>/dev/null || true
    fi
    if [ -n "${MEDIAMTX_PID}" ] && kill -0 "${MEDIAMTX_PID}" 2>/dev/null; then
        kill -TERM "${MEDIAMTX_PID}" 2>/dev/null || true
    fi
    
    sleep 1
    # Force kill any lingering processes on our ports
    lsof -ti:8555 -ti:5050 -ti:5174 2>/dev/null | xargs kill -9 2>/dev/null || true
    
    log_success "All services stopped."
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# 5.1 Launch MediaMTX
log_info "Starting [1/3] MediaMTX RTSP Server on port 8555..."
mediamtx mediamtx.yml >"${MEDIAMTX_LOG}" 2>&1 &
MEDIAMTX_PID=$!
sleep 0.8

if ! kill -0 "${MEDIAMTX_PID}" 2>/dev/null; then
    log_error "MediaMTX failed to start. Inspect log at ${MEDIAMTX_LOG}:"
    cat "${MEDIAMTX_LOG}" >&2
    exit 1
fi
log_success "MediaMTX running (PID: ${MEDIAMTX_PID})"

# 5.2 Launch Edge FastAPI & AI Pipeline
log_info "Starting [2/3] Edge AI Pipeline & API Server on port 5050..."
"${VENV_PYTHON}" -m uvicorn server.api_server:app --host 0.0.0.0 --port 5050 >"${API_LOG}" 2>&1 &
API_PID=$!
sleep 1.2

if ! kill -0 "${API_PID}" 2>/dev/null; then
    log_error "Edge API server failed to start. Inspect log at ${API_LOG}:"
    cat "${API_LOG}" >&2
    exit 1
fi
log_success "Edge API Server running (PID: ${API_PID})"

# 5.3 Launch Dashboard (if enabled)
if [ "${NO_DASHBOARD}" = false ]; then
    log_info "Starting [3/3] Operator Dashboard UI on port 5174..."
    npm --prefix dashboard run dev >"${DASHBOARD_LOG}" 2>&1 &
    DASHBOARD_PID=$!
    sleep 1.0

    if ! kill -0 "${DASHBOARD_PID}" 2>/dev/null; then
        log_error "Dashboard failed to start. Inspect log at ${DASHBOARD_LOG}:"
        cat "${DASHBOARD_LOG}" >&2
        exit 1
    fi
    log_success "Operator Dashboard running (PID: ${DASHBOARD_PID})"
fi

# ------------------------------------------------------------------------------
# 6. Runtime Summary & Live Monitoring
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}======================================================================${NC}"
echo -e "${BOLD}${GREEN}               RAAHI-EDGE SERVICES ARE NOW ONLINE!                   ${NC}"
echo -e "${BOLD}======================================================================${NC}"
echo -e "  ${BOLD}[1] MediaMTX RTSP Server    :${NC} ${CYAN}rtsp://127.0.0.1:8555/live${NC} (PID: ${MEDIAMTX_PID})"
echo -e "  ${BOLD}[2] Edge API & Telemetry    :${NC} ${CYAN}http://127.0.0.1:5050${NC}      (PID: ${API_PID})"
if [ "${NO_DASHBOARD}" = false ]; then
echo -e "  ${BOLD}[3] Operator Dashboard UI   :${NC} ${CYAN}http://localhost:5174${NC}      (PID: ${DASHBOARD_PID})"
fi
echo -e ""
echo -e "  ${BOLD}Outbound Central Target     :${NC} ${GREEN}${CENTRAL_URL}${NC}"
echo -e "  ${BOLD}Android Phone RTSP URL      :${NC} ${GREEN}rtsp://${LAN_IP}:8555/live${NC}"
echo -e ""
echo -e "  ${BOLD}Service Logs:${NC}"
echo -e "    • MediaMTX  : tail -f data/mediamtx_runtime.log"
echo -e "    • Edge API  : tail -f data/api_runtime.log"
if [ "${NO_DASHBOARD}" = false ]; then
echo -e "    • Dashboard : tail -f data/dashboard_runtime.log"
fi
echo -e ""
echo -e "  ${BOLD}${YELLOW}Press [Ctrl+C] to cleanly stop all services.${NC}"
echo -e "${BOLD}======================================================================${NC}\n"

# Open browser if on macOS and not disabled
if [ "${NO_OPEN}" = false ] && [ "${NO_DASHBOARD}" = false ] && [ "$(uname -s)" = "Darwin" ]; then
    open "http://localhost:5174" 2>/dev/null || true
fi

# Monitor child processes: if any child crashes, trigger cleanup
while true; do
    if ! kill -0 "${MEDIAMTX_PID}" 2>/dev/null; then
        log_error "MediaMTX process (PID ${MEDIAMTX_PID}) exited unexpectedly!"
        cat "${MEDIAMTX_LOG}" >&2
        break
    fi
    if ! kill -0 "${API_PID}" 2>/dev/null; then
        log_error "Edge API server (PID ${API_PID}) exited unexpectedly!"
        cat "${API_LOG}" >&2
        break
    fi
    if [ "${NO_DASHBOARD}" = false ] && ! kill -0 "${DASHBOARD_PID}" 2>/dev/null; then
        log_error "Dashboard process (PID ${DASHBOARD_PID}) exited unexpectedly!"
        cat "${DASHBOARD_LOG}" >&2
        break
    fi
    sleep 2
done

exit 1
