@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Cria um atalho do "Iniciar Nano" na pasta Inicializar do Windows: o Nano abre sozinho quando o computador ligar.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Nano.lnk'); $s.TargetPath='%~dp0Iniciar Nano.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Nano.lnk'); $s.TargetPath='%~dp0Iniciar Nano.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
echo.
echo  Pronto! O Nano vai abrir sozinho quando o computador ligar, e tem um atalho "Nano" na area de trabalho.
echo  Para desfazer: apague o atalho "Nano" em  shell:startup  (cole isso no Executar, Win+R).
pause
