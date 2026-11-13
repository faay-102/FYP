Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Pushing CampusGuard AI Updates to GitHub... " -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Cyan

Set-Location -Path $PSScriptRoot
git add .
git commit -m "feat: redesign UI with CyberGuard theme, simplified dashboard, green header/footer, and camera hub"
git push origin main

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Done! Your repository is up to date.        " -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Cyan

