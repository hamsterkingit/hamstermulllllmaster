/**
 * 도미노 재고·발주 자동화 서버
 * - 엑셀 업로드/로컬 엑셀 파싱
 * - 재고 부족 시 발주 권장 수량 계산
 * - 담당자(kanglim2@naver.com) 메일 발송
 */

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Vercel 등에서 대소문자 상관없이 팀 비밀번호 읽기
function getTeamPassword() {
  const v = process.env.TEAM_PASSWORD || process.env.team_password;
  if (v && String(v).trim()) return String(v).trim();
  for (const key of Object.keys(process.env || {})) {
    if (key.toLowerCase() === 'team_password' && process.env[key]) {
      return String(process.env[key]).trim();
    }
  }
  return '';
}
const TEAM_PASSWORD = getTeamPassword();
function authToken() {
  if (!TEAM_PASSWORD) return '';
  return crypto.createHash('sha256').update(TEAM_PASSWORD).digest('hex');
}
function requireAuth(req, res, next) {
  const pwd = getTeamPassword();
  if (!pwd) return next();
  const token = crypto.createHash('sha256').update(pwd).digest('hex');
  if (req.cookies && req.cookies.auth === token) return next();
  res.status(401).json({ error: '로그인이 필요합니다.' });
}

// 담당자 이메일 (발주 알림 수신)
const ORDER_RECIPIENT_EMAIL = 'kanglim2@naver.com';

// 엑셀 시트 이름 (domino_inventory_training.xlsx 구조)
const SHEET_NAMES = {
  SUPPLIERS: 'Suppliers',
  INVENTORY: 'Inventory',
};

// 컬럼 매핑 (한글 헤더)
const INVENTORY_HEADERS = {
  품목코드: 'code',
  재료명: 'name',
  규격: 'spec',
  단위: 'unit',
  현재재고: 'current',
  안전재고: 'safety',
  MOQ: 'moq',
  거래처: 'supplier',
  알림담당자: 'manager',
  거래처이메일: 'email',
  부족수량: 'shortage',
  발주권장수량: 'orderQty',
  상태: 'status',
  담당자알림메시지: 'message',
};

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  const pwd = getTeamPassword();
  if (!pwd) {
    return res.json({ ok: true });
  }
  if (String(password || '').trim() !== pwd) {
    return res.status(401).json({ ok: false, error: '비밀번호가 올바르지 않습니다.' });
  }
  const token = crypto.createHash('sha256').update(pwd).digest('hex');
  const isProd = process.env.VERCEL || process.env.NODE_ENV === 'production';
  res.cookie('auth', token, {
    httpOnly: true,
    secure: !!isProd,
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  res.json({ ok: true });
});

app.get('/api/auth/check', (req, res) => {
  const pwd = getTeamPassword();
  if (!pwd) {
    return res.json({ ok: true, passwordRequired: false });
  }
  const token = crypto.createHash('sha256').update(pwd).digest('hex');
  if (req.cookies && req.cookies.auth === token) {
    return res.json({ ok: true, passwordRequired: true });
  }
  res.json({ ok: false, passwordRequired: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth', { path: '/' });
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  const p = (req.path || '').replace(/^\/+/, '');
  if (p === 'auth' || p.startsWith('auth/')) return next();
  requireAuth(req, res, next);
});

const isVercel = process.env.VERCEL === '1';
const upload = multer({
  ...(isVercel
    ? { storage: multer.memoryStorage() }
    : { dest: path.join(__dirname, 'uploads') }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

if (!isVercel && !fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
}

/**
 * 워크북에서 재고 시트 파싱 후 재고 분석 (공통 로직)
 * 규칙: 현재재고 < 안전재고 → 부족수량 = 안전재고 - 현재재고, 발주권장수량 = MAX(MOQ, 부족수량)
 */
function parseWorkbook(workbook) {
  const sheet = workbook.Sheets[SHEET_NAMES.INVENTORY];
  if (!sheet) {
    return { error: 'Inventory 시트를 찾을 수 없습니다.', items: [], orders: [] };
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 2) {
    return { error: '재고 데이터가 없습니다.', items: [], orders: [] };
  }
  const headers = rows[0];
  const data = [];
  const orders = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const item = {};
    headers.forEach((h, idx) => {
      const key = INVENTORY_HEADERS[h];
      if (key) item[key] = row[idx];
    });
    const current = Number(item.current) || 0;
    const safety = Number(item.safety) || 0;
    const moq = Number(item.moq) || 0;
    const shortage = Math.max(0, safety - current);
    const orderQty = current < safety ? Math.max(moq, shortage) : 0;
    const status = current < safety ? '발주 필요' : '정상';
    const message = status === '발주 필요'
      ? `${item.name} 재고 부족 - 현재 ${current}${item.unit || ''}, 안전재고 ${safety}${item.unit || ''}, 권장발주 ${orderQty}${item.unit || ''}`
      : '';
    item.shortage = shortage;
    item.orderQty = orderQty;
    item.status = status;
    item.message = message;
    data.push(item);
    if (status === '발주 필요') {
      orders.push({ ...item, orderQty, message });
    }
  }
  return { items: data, orders, totalItems: data.length, orderCount: orders.length };
}

function parseAndAnalyzeInventory(filePath) {
  const workbook = XLSX.readFile(filePath, { type: 'file', cellDates: true });
  return parseWorkbook(workbook);
}

function parseAndAnalyzeFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return parseWorkbook(workbook);
}

/**
 * 업로드된 엑셀 또는 기본 엑셀 파일로 분석
 */
function getExcelPath(reqFile) {
  if (reqFile && reqFile.path && fs.existsSync(reqFile.path)) {
    return reqFile.path;
  }
  const defaultPath = path.join(__dirname, 'domino_inventory_training.xlsx');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  return null;
}

// API: 기본 엑셀 파일로 재고 분석
app.get('/api/analyze', (req, res) => {
  const excelPath = path.join(__dirname, 'domino_inventory_training.xlsx');
  if (!fs.existsSync(excelPath)) {
    return res.status(404).json({
      error: '엑셀 파일이 없습니다. domino_inventory_training.xlsx를 프로젝트 폴더에 넣어주세요.',
      items: [],
      orders: [],
    });
  }
  try {
    const result = parseAndAnalyzeInventory(excelPath);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err.message || '분석 중 오류가 발생했습니다.',
      items: [],
      orders: [],
    });
  }
});

// API: 엑셀 파일 업로드 후 재고 분석
app.post('/api/upload-analyze', upload.single('excel'), (req, res) => {
  try {
    if (req.file && req.file.buffer) {
      const result = parseAndAnalyzeFromBuffer(req.file.buffer);
      return res.json(result);
    }
    const filePath = getExcelPath(req.file);
    if (!filePath) {
      return res.status(400).json({
        error: '엑셀 파일을 업로드하거나 프로젝트에 domino_inventory_training.xlsx를 넣어주세요.',
        items: [],
        orders: [],
      });
    }
    const result = parseAndAnalyzeInventory(filePath);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.json(result);
  } catch (err) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    res.status(500).json({
      error: err.message || '분석 중 오류가 발생했습니다.',
      items: [],
      orders: [],
    });
  }
});

/**
 * 메일 발송 (수신: kanglim2@naver.com)
 * Gmail 사용 시: .env에 GMAIL_USER, GMAIL_APP_PASSWORD 설정 필요
 */
function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (user && pass) {
    const u = String(user).trim();
    const p = String(pass).trim().replace(/\s/g, '');
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user: u, pass: p },
      port: 587,
      secure: false,
      tls: { rejectUnauthorized: true },
    });
  }
  // 테스트용: Ethereal 또는 로그만
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: process.env.ETHEREAL_USER || 'test',
      pass: process.env.ETHEREAL_PASS || 'test',
    },
  });
}

// API: 발주 요청 메일 보내기
app.post('/api/send-order-email', express.json(), (req, res) => {
  const { orders = [], storeName = '도미노피자', summary = '' } = req.body;

  const toEmail = ORDER_RECIPIENT_EMAIL;
  const itemList = (orders || [])
    .map((o) => `· ${o.name} | 현재 ${o.current}${o.unit || ''} | 안전재고 ${o.safety}${o.unit || ''} | 권장발주 ${o.orderQty}${o.unit || ''}`)
    .join('\n');

  const html = `
    <h2>발주 요청 알림</h2>
    <p>도미노피자 ${storeName} 재고·발주 자동화 시스템에서 발주 요청이 발생했습니다.</p>
    <p><strong>발주 필요 품목 수:</strong> ${orders.length}건</p>
    <hr/>
    <h3>발주 권장 목록</h3>
    <pre>${itemList || '(없음)'}</pre>
    ${summary ? `<p>${summary}</p>` : ''}
    <hr/>
    <p>첨부한 발주서 확인 부탁드립니다.<br/>감사합니다.</p>
  `;

  const mailOptions = {
    from: process.env.GMAIL_USER || 'noreply@domino.local',
    to: toEmail,
    subject: `[발주요청] ${storeName} / ${new Date().toLocaleDateString('ko-KR')}`,
    text: itemList || '발주 필요 품목이 없습니다.',
    html,
  };

  const transporter = createTransporter();
  const user = process.env.GMAIL_USER;

  if (!user || !process.env.GMAIL_APP_PASSWORD) {
    const hint = process.env.VERCEL
      ? ' Vercel: Settings → Environment Variables 에 GMAIL_USER, GMAIL_APP_PASSWORD 추가 후 재배포.'
      : ' 로컬: 프로젝트 폴더에 .env 파일 생성 후 GMAIL_USER, GMAIL_APP_PASSWORD 입력.';
    return res.status(400).json({
      success: false,
      message: 'Gmail 발신 설정이 없습니다.' + hint,
      error: 'Missing credentials',
    });
  }

  transporter.sendMail(mailOptions)
    .then((info) => {
      res.json({
        success: true,
        message: `발주 요청 메일이 ${toEmail}(으)로 발송되었습니다.`,
        messageId: info.messageId,
      });
    })
    .catch((err) => {
      console.error('Mail error:', err);
      const hint = err.message && (err.message.includes('Invalid login') || err.message.includes('Username and Password'))
        ? ' Gmail 주소(dlrkdfla2 vs dllrkdfla2)와 앱 비밀번호를 확인하고, Google 계정에서 2단계인증 후 앱 비밀번호를 발급받으세요.'
        : '';
      res.status(500).json({
        success: false,
        message: '메일 발송 실패.' + hint,
        error: err.message,
      });
    });
});

// API: 메일 설정 확인 (브라우저에서 호출해 보면 원인 파악에 도움)
app.get('/api/check-email', (req, res) => {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    const msg = process.env.VERCEL
      ? 'Vercel 대시보드 → 프로젝트 → Settings → Environment Variables 에 GMAIL_USER, GMAIL_APP_PASSWORD 를 추가한 뒤 Deploy를 다시 실행하세요.'
      : '프로젝트 폴더에 .env 파일을 만들고 GMAIL_USER, GMAIL_APP_PASSWORD 를 넣으세요. (.env.example 참고)';
    return res.json({ ok: false, message: msg });
  }
  const transporter = createTransporter();
  transporter.verify((err) => {
    if (err) {
      console.error('Gmail verify error:', err);
      const msg = err.message || '';
      let hint = '';
      if (msg.includes('Invalid login') || msg.includes('Username and Password')) {
        hint = ' Gmail 주소와 앱 비밀번호를 확인하세요. 2단계인증 켜고 앱 비밀번호를 다시 발급받으세요.';
      }
      return res.json({ ok: false, message: 'Gmail 로그인 실패: ' + msg + hint });
    }
    res.json({ ok: true, message: 'Gmail 설정 정상. 발송 가능합니다.', from: user });
  });
});

// API: 개별 항목마다 담당자에게 메일 발송 (항목당 1통)
app.post('/api/send-order-emails', express.json(), (req, res) => {
  const { orders = [] } = req.body;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    const hint = process.env.VERCEL
      ? ' Vercel: 프로젝트 → Settings → Environment Variables 에 GMAIL_USER, GMAIL_APP_PASSWORD 추가 후 재배포.'
      : ' 로컬: 프로젝트 폴더에 .env 파일 만들고 GMAIL_USER, GMAIL_APP_PASSWORD 입력.';
    return res.status(400).json({
      success: false,
      message: 'Gmail 설정이 없어 메일을 보낼 수 없습니다.' + hint,
      sent: 0,
      failed: orders.length,
      error: 'Missing credentials',
    });
  }

  if (!orders.length) {
    return res.json({ success: true, message: '발주 항목이 없습니다.', sent: 0, failed: 0 });
  }

  const transporter = createTransporter();
  const dateStr = new Date().toLocaleDateString('ko-KR');
  const fromStr = `"도미노 재고발주" <${user.trim()}>`;
  let sent = 0;
  let failed = 0;
  let firstError = null;
  const sentTo = [];

  const promises = orders.map((o) => {
    const to = ORDER_RECIPIENT_EMAIL;
    const text = `${o.name} 재고 부족 - 현재 ${o.current}${o.unit || ''}, 안전재고 ${o.safety}${o.unit || ''}, 권장발주 ${o.orderQty}${o.unit || ''}`;
    const html = `
      <h2>발주 요청</h2>
      <p>도미노피자 재고·발주 자동화에서 아래 품목에 대해 발주 요청드립니다.</p>
      <p><strong>${o.name}</strong></p>
      <ul>
        <li>현재재고: ${o.current} ${o.unit || ''}</li>
        <li>안전재고: ${o.safety} ${o.unit || ''}</li>
        <li>권장발주: ${o.orderQty} ${o.unit || ''}</li>
      </ul>
      <p>첨부한 발주서 확인 부탁드립니다.<br/>감사합니다.</p>
    `;
    return transporter
      .sendMail({
        from: fromStr,
        to: to.trim(),
        subject: `[발주요청] ${o.name} / ${dateStr}`,
        text,
        html,
      })
      .then((info) => {
        sent++;
        sentTo.push({ to: to.trim(), messageId: info.messageId || null });
        if (info.rejected && info.rejected.length) {
          console.error('Rejected:', to, info.rejected);
        }
      })
      .catch((err) => {
        if (!firstError) firstError = err.message || String(err);
        console.error('Send fail:', to, err.message);
        failed++;
      });
  });

  Promise.all(promises).then(() => {
    let message = `총 ${orders.length}건 중 ${sent}건 발송 완료`;
    if (failed > 0) message += `, ${failed}건 실패`;
    if (firstError) message += '. 오류: ' + firstError;
    else message += '.';
    if (sent > 0) message += ' 메일이 안 오면 수신함·스팸함을 확인해 보세요.';
    res.json({
      success: failed === 0,
      message,
      sent,
      failed,
      sentTo,
      error: firstError || undefined,
    });
  });
});

// 프론트엔드 (캐시 방지로 수정 내용 바로 반영)
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// Vercel: app만 export. 로컬: listen
if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`재고·발주 자동화 서버: http://localhost:${PORT}`);
    console.log(`담당자 메일 수신 주소: ${ORDER_RECIPIENT_EMAIL}`);
  });
}
