@echo off
setlocal

echo ========================================
echo  Office Wayfinder - Startup
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org and re-run this script.
  pause
  exit /b 1
)
echo [OK] Node.js found.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Install it from https://python.org and re-run this script.
  pause
  exit /b 1
)
echo [OK] Python found.

if not exist node_modules (
  echo.
  echo Installing Node dependencies, this may take a minute...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo [OK] Node dependencies already installed.
)

echo.
echo Checking Python dependencies...
python -c "import cv2, fitz" >nul 2>nul
if errorlevel 1 (
  echo Installing Python dependencies, this may take a minute...
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERROR] pip install failed.
    pause
    exit /b 1
  )
) else (
  echo [OK] Python dependencies already installed.
)

echo.
echo Starting Office Wayfinder server in a new window...
start "Office Wayfinder Server" cmd /k npm run dev

echo Waiting for server to come up...
timeout /t 5 /nobreak >nul
start "" http://localhost:3000

echo.
echo Office Wayfinder is starting. Leave the server window open.
echo Close that window to stop the app.
pause
