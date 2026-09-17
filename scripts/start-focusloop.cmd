@echo off
rem ---------------------------------------------------------------------------
rem  FocusLoop — one-click launcher for the development build.
rem
rem  Double-click this file (or run it from a terminal) to build the renderer and
rem  the Electron main process, then open the app. It is the same thing as running
rem  `pnpm --filter @focusloop/desktop run start` from the repository root.
rem
rem  The window stays open on failure so the error is readable when launched from
rem  Explorer. On a normal exit it closes with the app.
rem ---------------------------------------------------------------------------
setlocal

rem Always work from the repository root, whatever the current directory is.
cd /d "%~dp0.."

where pnpm >nul 2>nul
if errorlevel 1 (
  echo.
  echo   pnpm was not found on PATH.
  echo.
  echo   Install it with one of:
  echo       corepack enable
  echo       npm install -g pnpm
  echo.
  pause
  exit /b 1
)

echo Building and starting FocusLoop from:
echo   %CD%
echo.

call pnpm --filter @focusloop/desktop run start
if errorlevel 1 (
  echo.
  echo   FocusLoop exited with an error. The output above has the details.
  echo.
  pause
  exit /b 1
)
