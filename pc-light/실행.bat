@echo off
chcp 65001 > nul
cd /d "%~dp0"
rem 최신 데이터 확인(가벼움) 후 시뮬레이터 열기 — 인터넷 없으면 기존 데이터로 바로 열립니다.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0업데이트.ps1"
start "" "%~dp0gbo2-simulator.html"
