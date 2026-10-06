@echo off
rem Tanki online server (rooms for playing with a friend). Open http://localhost:8095
cd /d "%~dp0server"
if not exist node_modules call npm install
start "" http://localhost:8095
node server.js 8095
