@echo off
chcp 65001 > nul
echo.
echo ================================================
echo   MERCADINHO - Gerador de Executavel Windows
echo ================================================
echo.

:: Verificar se Node.js está instalado
node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado!
    echo.
    echo Instale o Node.js em: https://nodejs.org
    echo Baixe a versao LTS e instale normalmente.
    echo Depois execute este arquivo novamente.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js encontrado: 
node --version
echo.

echo [1/3] Instalando dependencias (pode demorar alguns minutos)...
call npm install
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
)

echo.
echo [2/3] Gerando executavel para Windows...
call npm run build
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao gerar executavel.
    pause
    exit /b 1
)

echo.
echo ================================================
echo   PRONTO! Executavel gerado com sucesso!
echo ================================================
echo.
echo O instalador esta na pasta: dist\
echo Procure pelo arquivo: Mercadinho Setup X.X.X.exe
echo.
echo Execute o instalador para instalar o programa.
echo Sera criado um atalho na area de trabalho.
echo.
pause
