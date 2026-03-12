@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

echo [1/3] 재고 발주 자동화 서버를 시작합니다...
if not exist "node_modules" (
  echo 최초 실행: 패키지 설치 중...
  call npm install
  echo.
)

start "재고발주 서버" cmd /k "node server.js"

echo [2/3] 서버가 켜질 때까지 잠시 기다리는 중...
echo.

REM 서버가 포트 3000에서 응답할 때까지 최대 30초 대기
powershell -NoProfile -ExecutionPolicy Bypass -Command "$i=0; while($i -lt 30) { try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 3000); $c.Close(); exit 0 } catch { Start-Sleep -Seconds 1; $i++ } }; exit 1"
if %errorlevel% neq 0 (
  echo 서버가 30초 안에 켜지지 않았습니다. Node.js가 설치되어 있는지 확인하세요.
  pause
  exit /b 1
)

echo [3/3] 브라우저를 엽니다.
start "" "http://localhost:3000/?v=1"

echo.
echo 브라우저에서 엑셀 올리고 [발주 자동 보내기] 누르면 됩니다.
echo (검은 창 "재고발주 서버"를 닫으면 서버가 종료됩니다)
echo.
pause
