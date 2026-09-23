#!/usr/bin/env bash
# ==============================================================================
# RAAHI-Edge: Autonomous Edge AI Perception Setup Script
# ==============================================================================
# Sets up the complete local development environment:
# 1. System checks (OS, CPU architecture, Git, Python 3.11+, FFmpeg, MediaMTX, Node.js)
# 2. Python virtual environment (venv) and dependency installation (requirements.txt)
# 3. Dashboard frontend dependency installation and verification build
# 4. Runtime directories and configuration preservation
# 5. Deterministic Central URL validation (defaults to production platform)
# 6. Local LAN IP detection for Android RAAHI-Eye camera streaming
# ==============================================================================

set -euo pipefail

# Text styling
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m" # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_step() {
    echo -e "\n${BOLD}${CYAN}==>${NC} ${BOLD}$1${NC}"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1" >&2
}

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${PROJECT_ROOT}"

# Add standard Homebrew and local binary paths to PATH for macOS/Linux
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo -e "${BOLD}======================================================================${NC}"
echo -e "${BOLD}         RAAHI-Edge Automated Environment Setup Script               ${NC}"
echo -e "${BOLD}======================================================================${NC}"

# ------------------------------------------------------------------------------
# 1. System & Architecture Detection
# ------------------------------------------------------------------------------
log_step "Step 1: Detecting Operating System and Hardware Architecture"

OS="$(uname -s)"
ARCH="$(uname -m)"

log_info "Detected OS:           ${BOLD}${OS}${NC}"
log_info "Detected Architecture: ${BOLD}${ARCH}${NC}"

if [ "${OS}" = "Darwin" ]; then
    if [ "${ARCH}" = "arm64" ]; then
        log_success "Apple Silicon detected (Target platform: Apple Metal MPS acceleration supported)"
    else
        log_warn "Intel x86_64 Mac detected. PyTorch will use CPU inference (MPS unavailable)."
    fi
elif [ "${OS}" = "Linux" ]; then
    log_info "Linux detected. Supported for Edge appliance deployment (CUDA/CPU)."
else
    log_warn "Unrecognized operating system: ${OS}. Setup will attempt to proceed."
fi

# ------------------------------------------------------------------------------
# 2. Prerequisites Verification (Git, Python, FFmpeg, MediaMTX, Node.js)
# ------------------------------------------------------------------------------
log_step "Step 2: Verifying Core System Prerequisites"

# 2.1 Git
if command -v git >/dev/null 2>&1; then
    log_success "Git installed: $(git --version)"
else
    log_error "Git is not installed. Please install Git to proceed."
    exit 1
fi

# 2.2 Python 3.11+
if command -v python3 >/dev/null 2>&1; then
    PY_VER_RAW="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
    PY_MAJOR="$(echo "${PY_VER_RAW}" | cut -d. -f1)"
    PY_MINOR="$(echo "${PY_VER_RAW}" | cut -d. -f2)"
    
    if [ "${PY_MAJOR}" -eq 3 ] && [ "${PY_MINOR}" -ge 11 ]; then
        log_success "Python 3.11+ verified: Python $(python3 --version | awk '{print $2}')"
    else
        log_error "Python >= 3.11 is required. Found Python ${PY_VER_RAW}."
        echo "  Please install Python 3.11, 3.12, or 3.13 via Homebrew or your system package manager:"
        echo "    brew install python@3.12"
        exit 1
    fi
else
    log_error "python3 is not installed or not found in PATH."
    exit 1
fi

# 2.3 FFmpeg
if command -v ffmpeg >/dev/null 2>&1; then
    log_success "FFmpeg installed: $(ffmpeg -version 2>&1 | head -n 1 | awk '{print $1, $2, $3}')"
else
    log_warn "FFmpeg not found in PATH."
    if [ "${OS}" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
        log_info "Attempting automatic installation of FFmpeg via Homebrew..."
        brew install ffmpeg || {
            log_error "Failed to install FFmpeg via Homebrew. Run manually: brew install ffmpeg"
            exit 1
        }
        log_success "FFmpeg installed successfully via Homebrew."
    else
        log_error "FFmpeg is required for 15-second evidence video clipping."
        echo "  Install with:"
        if [ "${OS}" = "Darwin" ]; then
            echo "    brew install ffmpeg"
        else
            echo "    sudo apt-get install -y ffmpeg"
        fi
        exit 1
    fi
fi

# 2.4 MediaMTX RTSP Server
if command -v mediamtx >/dev/null 2>&1; then
    log_success "MediaMTX installed: $(mediamtx --version 2>&1 | head -n 1 || echo 'MediaMTX binary ready')"
else
    log_warn "MediaMTX not found in PATH."
    if [ "${OS}" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
        log_info "Attempting automatic installation of MediaMTX via Homebrew..."
        brew install mediamtx || {
            log_error "Failed to install MediaMTX via Homebrew. Run manually: brew install mediamtx"
            exit 1
        }
        log_success "MediaMTX installed successfully via Homebrew."
    else
        log_error "MediaMTX RTSP proxy server is required for low-latency phone camera streaming."
        echo "  Install with:"
        if [ "${OS}" = "Darwin" ]; then
            echo "    brew install mediamtx"
        else
            echo "    Download Linux binary from https://github.com/bluenviron/mediamtx/releases"
        fi
        exit 1
    fi
fi

# 2.5 Node.js & npm (for Dashboard)
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    NODE_MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [ "${NODE_MAJOR}" -ge 18 ]; then
        log_success "Node.js installed: $(node -v) (npm $(npm -v))"
    else
        log_warn "Node.js version is older than 18 (found $(node -v)). Node 18+ or 20+ LTS recommended."
    fi
else
    log_error "Node.js and npm are required for the in-cabin operator dashboard."
    echo "  Install with:"
    if [ "${OS}" = "Darwin" ]; then
        echo "    brew install node"
    else
        echo "    sudo apt-get install -y nodejs npm"
    fi
    exit 1
fi

# ------------------------------------------------------------------------------
# 3. Python Virtual Environment Setup & Dependencies
# ------------------------------------------------------------------------------
log_step "Step 3: Setting Up Python Virtual Environment"

VENV_DIR="venv"

if [ -d "${VENV_DIR}" ] && [ -f "${VENV_DIR}/bin/python" ]; then
    log_info "Existing virtual environment detected at ${BOLD}${VENV_DIR}/${NC} (reusing)."
else
    log_info "Creating fresh Python virtual environment at ${BOLD}${VENV_DIR}/${NC}..."
    python3 -m venv "${VENV_DIR}"
    log_success "Virtual environment created."
fi

VENV_PYTHON="${PROJECT_ROOT}/${VENV_DIR}/bin/python"
VENV_PIP="${PROJECT_ROOT}/${VENV_DIR}/bin/pip"

log_info "Upgrading pip in virtual environment..."
"${VENV_PIP}" install --upgrade pip --quiet

log_info "Installing Python dependencies from ${BOLD}requirements.txt${NC}..."
"${VENV_PIP}" install -r requirements.txt --quiet
log_success "Python dependencies installed successfully."

# ------------------------------------------------------------------------------
# 4. Dashboard Frontend Dependencies & Build Verification
# ------------------------------------------------------------------------------
log_step "Step 4: Setting Up Operator Dashboard (React 18 / Vite)"

if [ -d "dashboard" ]; then
    if [ -d "dashboard/node_modules" ]; then
        log_info "Dashboard dependencies already installed at ${BOLD}dashboard/node_modules/${NC} (reusing)."
    else
        log_info "Installing dashboard npm dependencies..."
        if [ -f "dashboard/package-lock.json" ]; then
            npm --prefix dashboard ci --quiet
        else
            npm --prefix dashboard install --quiet
        fi
        log_success "Dashboard dependencies installed."
    fi

    log_info "Verifying dashboard production build with Vite..."
    npm --prefix dashboard run build --silent
    log_success "Dashboard build succeeded (dist/ generated)."
else
    log_warn "dashboard/ directory not found. Skipping frontend setup."
fi

# ------------------------------------------------------------------------------
# 5. Runtime Directory Structure & Model Verification
# ------------------------------------------------------------------------------
log_step "Step 5: Verifying Runtime Directories and Model Weights"

mkdir -p data data/evidence captures models

log_success "Runtime directories initialized: data/, data/evidence/, captures/, models/"

# Verify YOLO weights
if [ -f "models/pothole_yolo11n.pt" ]; then
    log_success "Pothole model weights found: models/pothole_yolo11n.pt ($(ls -lh models/pothole_yolo11n.pt | awk '{print $5}'))"
else
    log_warn "Pothole model missing at models/pothole_yolo11n.pt!"
fi

if [ -f "models/yolo11n.pt" ]; then
    log_success "Traffic vehicle model weights found: models/yolo11n.pt ($(ls -lh models/yolo11n.pt | awk '{print $5}'))"
else
    log_warn "Traffic vehicle model missing at models/yolo11n.pt!"
fi

# Verify mediamtx.yml
if [ -f "mediamtx.yml" ]; then
    log_success "MediaMTX configuration verified: mediamtx.yml"
else
    log_error "mediamtx.yml missing in repository root!"
    exit 1
fi

# Verify config.yaml
if [ -f "config.yaml" ]; then
    log_success "Edge runtime configuration verified: config.yaml"
else
    log_error "config.yaml missing in repository root!"
    exit 1
fi

# ------------------------------------------------------------------------------
# 6. Central Platform Configuration & Environment Preservation
# ------------------------------------------------------------------------------
log_step "Step 6: Verifying Central Uplink Platform Configuration"

DEFAULT_PROD_URL="https://raahi.feminismindia.com"

if [ ! -f ".env" ]; then
    cat <<EOF > .env
# ==============================================================================
# RAAHI Edge Environment Configuration
# ==============================================================================
# Outbound Central Platform URL
# Defaults to production municipal fleet endpoint:
CENTRAL_URL=${DEFAULT_PROD_URL}

# For local development with a local Central server instance on port 5001, uncomment:
# CENTRAL_URL=http://localhost:5001
EOF
    log_success "Created default .env configured for production Central platform (${DEFAULT_PROD_URL})."
else
    log_info "Preserving existing .env configuration file."
fi

if [ -f ".env" ]; then
    set -a
    source .env
    set +a
fi

# Resolve Central URL through Edge resolution utility
RESOLVED_CENTRAL_URL="$("${VENV_PYTHON}" -c '
import os
from utils.config import resolve_central_url
print(resolve_central_url(log_source=False))
' 2>/dev/null || echo "")"

log_info "Effective Outbound Central URL: ${BOLD}${RESOLVED_CENTRAL_URL}${NC}"

if [[ "${RESOLVED_CENTRAL_URL}" == *"localhost"* ]]; then
    log_warn "Notice: Resolved Central URL contains 'localhost'. Suitable for offline/local development."
    log_warn "For team/fleet deployment, ensure CENTRAL_URL=https://raahi.feminismindia.com is set in .env."
else
    log_success "Production Central platform endpoint confirmed (${RESOLVED_CENTRAL_URL})."
fi

# ------------------------------------------------------------------------------
# 7. Local Network LAN IP Detection
# ------------------------------------------------------------------------------
log_step "Step 7: Detecting Local LAN IP for Android RAAHI-Eye"

LAN_IP=""
if [ "${OS}" = "Darwin" ]; then
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
    print("")
' 2>/dev/null || true)"
fi

if [ -n "${LAN_IP}" ]; then
    log_success "Detected Machine LAN IP: ${BOLD}${CYAN}${LAN_IP}${NC}"
    echo -e "    ${BOLD}Android RAAHI-Eye RTSP Target:${NC} ${GREEN}rtsp://${LAN_IP}:8555/live${NC}"
else
    log_warn "Could not determine local LAN IP automatically."
    echo -e "    Check your network settings (e.g. 'ifconfig' or 'ip addr') to find your IP."
fi

# ------------------------------------------------------------------------------
# 8. Sanity Smoke Checks (Python Imports & Acceleration Device)
# ------------------------------------------------------------------------------
log_step "Step 8: Running Python Import and Hardware Acceleration Sanity Checks"

"${VENV_PYTHON}" -c "
import cv2
import numpy
import yaml
import fastapi
import uvicorn
import pydantic
import websockets
import requests
import psutil
import torch
import ultralytics

print('  • Core modules successfully imported.')

# Check PyTorch acceleration
if torch.backends.mps.is_available():
    device_desc = 'Apple Silicon Metal Performance Shaders (MPS) - ACCELERATED'
elif torch.cuda.is_available():
    device_desc = f'NVIDIA CUDA ({torch.cuda.get_device_name(0)}) - ACCELERATED'
else:
    device_desc = 'CPU (Standard fallback)'

print(f'  • PyTorch Acceleration Device: {device_desc}')
"

# ------------------------------------------------------------------------------
# 9. Setup Completion Summary
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}======================================================================${NC}"
echo -e "${BOLD}${GREEN}               RAAHI-EDGE SETUP COMPLETED SUCCESSFULLY!               ${NC}"
echo -e "${BOLD}======================================================================${NC}"
echo -e "You can now launch the complete Edge system with:"
echo -e "  ${BOLD}${GREEN}./start.sh${NC}"
echo -e ""
echo -e "This will start:"
echo -e "  1. MediaMTX RTSP Server    ${CYAN}rtsp://127.0.0.1:8555/live${NC}"
echo -e "  2. Edge Pipeline & API     ${CYAN}http://127.0.0.1:5050${NC}"
echo -e "  3. Operator Dashboard      ${CYAN}http://127.0.0.1:5174${NC}"
echo -e ""
if [ -n "${LAN_IP}" ]; then
    echo -e "On the Android phone (RAAHI-Eye app):"
    echo -e "  Set RTSP destination to:   ${BOLD}${GREEN}rtsp://${LAN_IP}:8555/live${NC}"
    echo -e ""
fi
echo -e "To run automated test suite:"
echo -e "  ${BOLD}${CYAN}venv/bin/pytest tests/ -v${NC}"
echo -e "${BOLD}======================================================================${NC}\n"

exit 0
