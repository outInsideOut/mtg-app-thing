@echo off
echo Installing dependencies...
pip install -r requirements.txt --quiet
echo Starting MTG Card Picker...
start http://localhost:5000
py app.py
pause
