@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo .env not found — run setup.bat first.
  exit /b 1
)

echo Starting Next.js dev server and scraper worker in separate windows...
start "MSR Insight - Next.js dev server" cmd /k "cd /d "%~dp0" && npm run dev"
start "MSR Insight - Scraper worker" cmd /k "cd /d "%~dp0" && npm run worker"

echo.
echo Dev server:  http://localhost:3000
echo Worker:      polling scrape_jobs every 3s
echo (Close the two opened windows to stop them.)
endlocal
