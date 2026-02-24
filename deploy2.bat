@echo off
echo Starting deploy2: Firebase + GitHub...

call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo Build failed!
    pause
    exit /b %ERRORLEVEL%
)

call firebase deploy --only "hosting,functions"
if %ERRORLEVEL% NEQ 0 (
    echo Firebase deploy failed!
    pause
    exit /b %ERRORLEVEL%
)

echo Firebase deploy done. Pushing to GitHub...
git add .
git commit -m "deploy2: %DATE% %TIME%"
git push origin master

if %ERRORLEVEL% NEQ 0 (
    echo Git push failed!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo Deploy2 finished! Firebase + GitHub updated.
pause
