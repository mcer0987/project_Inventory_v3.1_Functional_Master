@echo off
setlocal
cd /d "%~dp0"

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker Desktop/Engine calismiyor. Once Docker Desktop'i acin.
  pause
  exit /b 1
)

docker load --input "%~dp0medipol-envanter-v3.2-stable.tar"
if errorlevel 1 (
  echo Docker imaji yuklenemedi.
  pause
  exit /b 1
)

docker container inspect medipol-envanter-v3.2 >nul 2>&1
if errorlevel 1 (
  docker run --detach --name medipol-envanter-v3.2 --restart unless-stopped --publish 127.0.0.1:8088:80 medipol-envanter:v3.2-stable
) else (
  docker start medipol-envanter-v3.2
)
if errorlevel 1 (
  echo Konteyner baslatilamadi. 8088 portunun bosta oldugunu kontrol edin.
  pause
  exit /b 1
)

start "" "http://localhost:8088"
echo v3.2 hazir: http://localhost:8088
pause
