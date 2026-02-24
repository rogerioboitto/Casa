@echo off
echo Starting deployment...
call npm run deploy
if %ERRORLEVEL% NEQ 0 (
    echo Deployment failed!
    pause
    exit /b %ERRORLEVEL%
)
echo Deployment finished successfully.
pause
