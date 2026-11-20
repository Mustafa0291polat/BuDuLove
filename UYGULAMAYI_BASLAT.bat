@echo off
chcp 65001 >nul
title BuDuVerse - Bubu ve Dudu Sevgili Mobil Uygulamasi
cd /d "%~dp0"

echo ==============================================================
echo  🐼💕🐻 BuDuVerse (Bubu ^& Dudu Ortak Mobil Uygulama) Baslatiliyor...
echo ==============================================================
echo.
if not exist "node_modules" (
    echo Gerekli kutuphaneler yukleniyor...
    call npm install
)

start "" "http://localhost:3000/studio.html"
node server.js
pause
