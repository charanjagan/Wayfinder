#!/usr/bin/env bash
set -e

echo "========================================"
echo " Office Wayfinder - Startup"
echo "========================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install it from https://nodejs.org and re-run this script."
  exit 1
fi
echo "[OK] Node.js found."

PYTHON_BIN=python3
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN=python
fi
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "[ERROR] Python not found. Install it from https://python.org and re-run this script."
  exit 1
fi
echo "[OK] Python found ($PYTHON_BIN)."

if [ ! -d node_modules ]; then
  echo
  echo "Installing Node dependencies, this may take a minute..."
  npm install
else
  echo "[OK] Node dependencies already installed."
fi

echo
echo "Checking Python dependencies..."
if ! "$PYTHON_BIN" -c "import cv2, fitz" >/dev/null 2>&1; then
  echo "Installing Python dependencies, this may take a minute..."
  "$PYTHON_BIN" -m pip install -r requirements.txt
else
  echo "[OK] Python dependencies already installed."
fi

echo
echo "Starting Office Wayfinder..."
(
  sleep 3
  if command -v open >/dev/null 2>&1; then
    open http://localhost:3000
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:3000
  fi
) &

npm run dev
