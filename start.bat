@echo off
cd /d "%~dp0"

if not exist node_modules (
  echo Installing npm dependencies...
  call npm install
)

echo Starting Wayfinder dev server...
call npm run dev
