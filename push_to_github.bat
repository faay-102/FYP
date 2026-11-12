@echo off
title Push Updates to GitHub
echo ========================================================
echo           Pushing CampusGuard AI to GitHub              
echo ========================================================
cd /d "%~dp0"

echo [1/4] Checking repository status...
git status
echo.

set /p commit_msg="Enter commit message (press Enter for 'Update project files and configuration'): "
if "%commit_msg%"=="" set commit_msg=Update project files and configuration

echo.
echo [2/4] Staging changes...
git add .

echo.
echo [3/4] Committing changes...
git commit -m "%commit_msg%"

echo.
echo [4/4] Pushing to GitHub (origin main)...
git push origin main

echo.
echo ========================================================
echo Finished! Check your repo: https://github.com/faay-102/FYP
echo ========================================================
pause

