@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js non trovato. Installalo da https://nodejs.org ^(versione LTS^) e riprova. & pause & exit /b)
node server.js
pause
