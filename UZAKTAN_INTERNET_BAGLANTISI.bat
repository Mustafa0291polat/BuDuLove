@echo off
chcp 65001 >nul
title BuDuVerse - Global HTTPS iPhone ve Uzaktan Baglanti (Cloudflare)
cd /d "%~dp0"

echo ==============================================================
echo  🌍 BuDuVerse - iPhone Safari ^& 4G/5G Uzaktan HTTPS Baglantisi
echo ==============================================================
echo.
echo NOT: UYGULAMAYI_BASLAT.bat artik bu HTTPS baglantisini OTOMATIK acar
echo ve Stüdyo ekranindaki QR koda yerlestirir!
echo.
echo Eger ayri bir pencereden yeni bir HTTPS linki almak isterseniz:
echo.
"node_modules\cloudflared\bin\cloudflared.exe" tunnel --url http://localhost:3000
pause
