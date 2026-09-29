@echo off
setlocal enabledelayedexpansion

echo Setting up Shena Care Platform...
echo.

REM Check for PostgreSQL
where psql >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo PostgreSQL is not installed or not in PATH
    echo Please install PostgreSQL 14+ before continuing
    exit /b 1
)

echo Checking PostgreSQL database...
psql -U postgres -lqt | findstr /C:"shenacare" >nul
if %ERRORLEVEL% NEQ 0 (
    echo Creating database 'shenacare'...
    createdb -U postgres shenacare
    if %ERRORLEVEL% NEQ 0 (
        echo Failed to create database. Please create it manually:
        echo    createdb shenacare
        exit /b 1
    )
    echo Database created
) else (
    echo Database 'shenacare' already exists
)

echo.
echo Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 exit /b 1

echo.
echo Running database migrations...
cd apps\api
call npm run migration:run
if %ERRORLEVEL% NEQ 0 (
    cd ..\..
    exit /b 1
)

echo.
echo Seeding database with demo data...
call npm run seed
if %ERRORLEVEL% NEQ 0 (
    cd ..\..
    exit /b 1
)

cd ..\..

echo.
echo Setup complete!
echo.
echo Next steps:
echo    1. Start the API:      cd apps\api ^&^& npm run dev
echo    2. Start the frontend: cd apps\web ^&^& npm run dev
echo    3. Visit:              http://localhost:3000
echo.
echo See README.md for more information

endlocal
