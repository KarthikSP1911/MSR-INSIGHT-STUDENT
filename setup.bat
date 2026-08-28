@echo off
setlocal
cd /d "%~dp0"

echo === MSR Insight Student Dashboard: setup ===

echo.
echo [1/3] Installing dependencies...
call npm install
if errorlevel 1 (
  echo npm install failed.
  exit /b 1
)

echo.
echo [2/3] Checking .env...
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo   Created .env from .env.example — fill in DATABASE_URL, JWT_SECRET, ENCRYPTION_SECRET before running.
) else (
  echo   .env already exists, leaving it as-is.
)

echo.
echo [3/3] Applying database migrations...
findstr /r /c:"^DATABASE_URL=" ".env" >nul
if errorlevel 1 (
  echo   DATABASE_URL not set in .env yet — skipping migrations. Run "npm run db:migrate" once it is set.
) else (
  call npm run db:generate
  call npm run db:migrate
)

echo.
echo Setup complete. Run run.bat to start the app.
endlocal
