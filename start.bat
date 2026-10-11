@echo off
rem Builds the React app into the backend, then starts the server.

rem Free ports 8443 and 8088 if a previous run is still holding them.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8443.*LISTENING" 2^>nul') do (
    echo Killing PID %%p on port 8443...
    taskkill /PID %%p /F >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8088.*LISTENING" 2^>nul') do (
    echo Killing PID %%p on port 8088...
    taskkill /PID %%p /F >nul 2>&1
)

cd /d "%~dp0frontend"
call npm install || exit /b 1
call npm run build || exit /b 1
cd /d "%~dp0backend"
call mvnw.cmd spring-boot:run
