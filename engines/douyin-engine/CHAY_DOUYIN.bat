@echo off
chcp 65001 >nul
echo ============================================
echo        DANG CAI DAT THU VIEN...
echo ============================================
echo.

echo [1/4] Cai dat requirements.txt...
pip install -r requirements.txt
if errorlevel 1 ( echo LOI: pip install -r requirements.txt that bai! & pause & exit /b 1 )

echo.
echo [2/4] Cai dat playwright...
pip install playwright
if errorlevel 1 ( echo LOI: pip install playwright that bai! & pause & exit /b 1 )

echo.
echo [3/4] Cai dat trinh duyet Chromium...
python -m playwright install chromium
if errorlevel 1 ( echo LOI: playwright install chromium that bai! & pause & exit /b 1 )

echo.
echo [4/4] Dang mo trinh duyet de lay cookie...
echo ============================================
echo  Hay dang nhap Douyin trong cua so vua mo.
echo  Sau khi trang chu hien ra va da dang nhap,
echo  quay lai day va nhan ENTER de tiep tuc.
echo ============================================
echo.
python -m tools.cookie_fetcher --config config.yml
if errorlevel 1 ( echo LOI: cookie_fetcher that bai! & pause & exit /b 1 )

echo.
echo ============================================
echo          CAI DAT HOAN TAT!
echo ============================================
echo.
echo Chon che do chay:
echo   [1]  Nhap URL de chay
echo   [2]  Chay mac dinh (khong can URL)
echo.

:CHOOSE
set /p CHOICE="Nhap lua chon cua ban (1 hoac 2): "

if "%CHOICE%"=="1" goto RUN_WITH_URL
if "%CHOICE%"=="2" goto RUN_DEFAULT

echo Lua chon khong hop le. Vui long nhap 1 hoac 2.
goto CHOOSE

:RUN_WITH_URL
echo.
set /p USER_URL="Nhap URL: "
if "%USER_URL%"=="" (
    echo URL khong duoc de trong. Vui long nhap lai.
    goto RUN_WITH_URL
)
echo.
echo Dang chay: python run.py -c config.yml -u "%USER_URL%"
echo.
python run.py -c config.yml -u "%USER_URL%"
goto END

:RUN_DEFAULT
echo.
echo Dang chay: python run.py -c config.yml
echo.
python run.py -c config.yml
goto END

:END
echo.
echo ============================================
echo              HOAN THANH!
echo ============================================
pause