@echo off
cd /d "%~dp0"
echo Iniciando Gestao de Freezers...
echo.
echo Acesse neste computador:
echo http://localhost:4174
echo.
echo Acesse em outros computadores da mesma rede:
echo http://192.168.0.89:4174
echo.
node server.js
pause
