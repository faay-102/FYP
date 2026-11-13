@echo off
echo ==============================================
echo   Pushing CampusGuard AI Updates to GitHub...
echo ==============================================
cd /d "%~dp0"
git add .
git commit -m "feat: redesign UI with CyberGuard theme, simplified dashboard, green header/footer, and camera hub"
git push origin main
echo ==============================================
echo   Done! Your repository is up to date.
echo ==============================================
pause

