@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "KRYA_TEST_HOME=%LOCALAPPDATA%\Kryakl-Dictation-Test"
set "KRYA_TEST_PORT=8797"
start "" "%~dp0Kryakl.exe"
