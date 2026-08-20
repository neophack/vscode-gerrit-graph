@echo off
setlocal

rem ============================================================
rem  Gerrit Graph extension: compile + package + install to VS Code
rem  Equivalent to npm run package-and-install (vsce package runs
rem  vscode:prepublish, i.e. npm run compile, then installs the
rem  generated .vsix)
rem ============================================================

rem Change to the script directory so it works when double-clicked
rem or run from any terminal
cd /d "%~dp0"

echo ============================================================
echo   Gerrit Graph  Build - Package - Install
echo   Directory: %cd%
echo ============================================================
echo.

rem ---- Environment checks ----
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] node not found. Please install Node.js first: https://nodejs.org/
    goto :fail
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found. Please install Node.js first: https://nodejs.org/
    goto :fail
)

where code >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 'code' command not found. In VS Code, press Ctrl+Shift+P and run
    echo        "Shell Command: Install 'code' command in PATH", then retry.
    goto :fail
)

rem ---- Step 1: dependencies (install automatically if node_modules is missing) ----
if exist "node_modules\" (
    echo [1/2] node_modules exists, skipping npm install
) else (
    echo [1/2] Installing dependencies: npm install ...
    call npm install
    if errorlevel 1 goto :fail
)
echo.

rem ---- Step 2: compile + package + install ----
echo [2/2] Building, packaging and installing: npm run package-and-install ...
echo        (vsce package compiles first: lint, clean, build src and web,
echo          then generates the .vsix and installs it into VS Code; this may take a while)
call npm run package-and-install
if errorlevel 1 goto :fail
echo.

echo ============================================================
echo   Done! The extension has been installed into VS Code.
echo   Restart VS Code for the change to take effect.
echo   The generated package (.vsix) is in the project root directory.
echo ============================================================
goto :end

:fail
echo.
echo ============================================================
echo   Failed! Please check the error messages above.
echo ============================================================
exit /b 1

:end
pause
