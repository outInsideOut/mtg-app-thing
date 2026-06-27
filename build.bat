@echo off
echo Installing dependencies...
py -m pip install -r requirements.txt --trusted-host pypi.org --trusted-host files.pythonhosted.org --quiet

echo Building executable...
py -m PyInstaller ^
  --onefile ^
  --windowed ^
  --name "MTG Card Picker" ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  --hidden-import webview ^
  --hidden-import webview.platforms.winforms ^
  --hidden-import clr ^
  --collect-all webview ^
  app.py

echo.
echo Done! Executable is in the dist\ folder.
pause
