@echo off
chcp 65001 >nul
cd /d "%~dp0"

title 재고 발주 - 서버
echo.
echo  ========================================
echo    재고 발주 자동화 - 서버 켜는 중
echo  ========================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo  [안내] Node.js가 없어서 서버를 켤 수 없습니다.
  echo.
  echo  해결: 인터넷에서 "nodejs" 검색해서 공식 사이트에서
  echo  LTS 버전 받아 설치한 뒤, 이 파일을 다시 더블클릭하세요.
  echo.
  echo  또는: Vercel에 배포해 두었다면, 그 웹 주소로만 들어가서
  echo  쓰시면 됩니다. (이 컴퓨터에서 서버 안 켜도 됨)
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  [1/3] 처음이시면 패키지 설치 중... (1~2분 걸릴 수 있어요)
  echo.
  call npm install
  echo.
)

echo  [2/3] 서버 켜는 중...
start "재고발주 서버" cmd /k "title [재고발주 서버 - 이 창 닫지 마세요] && node server.js"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$i=0; while($i -lt 30) { try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 3000); $c.Close(); exit 0 } catch { Start-Sleep -Seconds 1; $i++ } }; exit 1"
if %errorlevel% neq 0 (
  echo  서버가 안 켜졌어요. 잠시 후 다시 "시작하기" 더블클릭 해보세요.
  pause
  exit /b 1
)

echo  [3/3] 브라우저 여는 중...
start "" "http://localhost:3000/?v=1"

echo.
echo  완료! 브라우저가 열렸을 거예요.
echo  거기서 팀 비밀번호 입력하고 쓰시면 됩니다.
echo.
echo  ★ 나중에 끌 때: "재고발주 서버"라고 써 있는 검은 창만 닫으면 됩니다.
echo.
pause
