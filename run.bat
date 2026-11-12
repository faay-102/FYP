@echo off
title CampusGuard AI
echo ========================================================
echo               Starting CampusGuard AI                    
echo ========================================================
cd /d "%~dp0"

REM Check if virtual environment exists
if exist venv\Scripts\activate.bat (
    echo [OK] Activating virtual environment...
    call venv\Scripts\activate.bat
) else (
    echo [INFO] Virtual environment not found. Running with system Python...
)

echo [OK] Starting Flask server on http://localhost:5000 ...
python app.py
pause

