@echo off
rem Starts the local game server and opens the game in the default browser.
cd /d "%~dp0"
start "" http://localhost:8090
python serve.py 8090
