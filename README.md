# 도미노피자 재고·발주 자동화 시스템

재고를 파악하고, **재고가 부족하면** 담당 기업 직원에게 **발주서 메일**을 보내는 웹 시스템입니다.

## 기능

- **팀 비밀번호**: 웹 접속 시 팀 비밀번호 입력 후 사용 (환경 변수 `TEAM_PASSWORD` 설정 시)
- **엑셀 연동**: 업로드한 엑셀 또는 **셀 직접 입력**으로 재고 데이터 입력
- **재고 분석**: 현재재고 < 안전재고 인 품목 자동 탐지
- **발주 권장 수량**: `MAX(MOQ, 안전재고 - 현재재고)` 로 계산
- **담당자 메일 발송**: 발주 필요 항목마다 **kanglim2@naver.com** 등 담당자에게 이메일 자동 발송

## 실행 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. 서버 실행

```bash
npm start
```

브라우저에서 **http://localhost:3000** 접속

### 3. 사용 방법

1. **기본 엑셀 분석**: "기본 엑셀 분석" 버튼 클릭 → 프로젝트 폴더의 `domino_inventory_training.xlsx` 로 재고 분석
2. **다른 엑셀 사용**: "엑셀 파일 선택"으로 파일 업로드 후 자동 분석
3. **발주 메일 보내기**: 분석 결과에서 "담당자에게 발주 요청 메일 보내기" 클릭 → **kanglim2@naver.com** 으로 발주 요청 메일 전송

## 메일 발송 설정 (Gmail)

실제로 메일을 보내려면 Gmail SMTP 설정이 필요합니다.

1. `.env.example` 을 복사해 `.env` 파일 생성
2. [Google 앱 비밀번호](https://myaccount.google.com/apppasswords) 에서 앱 비밀번호 발급
3. `.env` 에 입력:

```
GMAIL_USER=dlrkdfla2@gmail.com  (발신용)
GMAIL_APP_PASSWORD=앱비밀번호16자
```

4. 서버에서 `.env` 를 읽으려면 `dotenv` 패키지를 사용할 수 있습니다. (선택 사항)

```bash
npm install dotenv
```

`server.js` 최상단에 추가:

```js
require('dotenv').config();
```

- **수신 주소**는 코드에 **kanglim2@naver.com** 으로 고정되어 있습니다.
- Gmail 미설정 시 메일 발송 API 호출 시 에러가 나며, 화면에 "GMAIL_USER, GMAIL_APP_PASSWORD 환경변수를 확인하세요" 메시지가 표시됩니다.

## 엑셀 구조 (참고)

- **Inventory** 시트: 품목코드, 재료명, 규격, 단위, 현재재고, 안전재고, MOQ, 거래처, 알림담당자, 거래처이메일 등
- **Suppliers** 시트: 거래처명, 담당자, 이메일, 리드타임, 품목군 (현재 버전에서는 발주 알림을 kanglim2@naver.com 한 주소로 보냅니다)

## Git에 올리기

```bash
git init
git add .
git commit -m "재고·발주 자동화 초기 커밋"
git remote add origin https://github.com/사용자명/저장소명.git
git branch -M main
git push -u origin main
```

- `.env` 는 `.gitignore` 에 포함되어 있어 비밀번호가 저장소에 올라가지 않습니다.
- 엑셀 파일(`domino_inventory_training.xlsx`)은 필요하면 커밋하고, 민감하면 제외하세요.

---

## Vercel에 배포하기

1. **Vercel 가입**: [vercel.com](https://vercel.com) 에서 GitHub 로그인

2. **프로젝트 연결**
   - "Add New" → "Project" → GitHub 저장소 선택 (또는 `vercel` CLI로 배포)
   - Root Directory: 프로젝트 폴더 그대로
   - Framework Preset: Other
   - Build Command: 비워 두거나 `npm install`
   - Output Directory: 비움 (server.js 단일 앱)

3. **환경 변수 설정**
   - Project → Settings → Environment Variables 에 추가:
     - `TEAM_PASSWORD` = 팀원이 접속 시 입력할 비밀번호 (비우면 비밀번호 없이 사용)
     - `GMAIL_USER` = 발신용 Gmail 주소
     - `GMAIL_APP_PASSWORD` = Gmail 앱 비밀번호 (16자, 공백 없이)

4. **배포**
   - "Deploy" 클릭 후 배포 완료되면 `https://프로젝트명.vercel.app` 로 접속

5. **사용**
   - 배포된 URL에서 엑셀 업로드 또는 **직접 입력(셀 입력)** 후 **발주 자동 보내기** 사용
   - Vercel에서는 "기본 파일로 분석"은 동작하지 않을 수 있음 → 엑셀 업로드 또는 셀 입력 사용

---

## 폴더 구조

```
프로젝트/
├── domino_inventory_training.xlsx   # 재고 엑셀 (로컬용, 선택)
├── server.js                        # 백엔드 (로컬 + Vercel)
├── vercel.json                      # Vercel 배포 설정
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── 시작하기.bat                     # Windows 한 번 실행
├── public/
│   └── index.html                   # 웹 화면 (로그인 + 엑셀 업로드 + 셀 입력)
└── uploads/                          # 업로드 임시 (로컬만, 자동 생성)
```
