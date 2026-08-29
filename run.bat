@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo .env not found ? run setup.bat first.
  exit /b 1
)

echo Starting Next.js dev server...
start "MSR Insight" cmd /k "cd /d "%~dp0" && npm run dev"

echo.
echo Dev server:  http://localhost:3000
echo (Close the opened window to stop.)
endlocal
