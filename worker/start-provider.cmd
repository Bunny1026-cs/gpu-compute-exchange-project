@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Install Python 3.12 for Windows with the Python launcher, then open this file again.
  pause
  exit /b 1
)
py -3 provider_setup.py
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
