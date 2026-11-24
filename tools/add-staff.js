// 운영진 계정 추가/등록
// 사용법:  node tools/add-staff.js <이름> <이메일> [비밀번호]
//  - 계정이 없으면 만들고(비밀번호 생략 시 임시 비밀번호 생성), staff 로 등록합니다.
//  - 이미 있는 계정이면 staff 등록만 합니다.
// 전제: 이 컴퓨터에서 `npx firebase-tools login` 으로 프로젝트 소유자 계정에 로그인되어 있어야 합니다.
const fs = require('fs'), os = require('os'), path = require('path');

const PROJECT = 'airkick-meeting';
const API_KEY = 'AIzaSyA6Bti0EZLzqVzqC-YrsafF_IXS_9H9_fU';
// firebase-tools 의 공개 OAuth 클라이언트 (firebase-tools 소스에 공개된 값)
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

async function accessToken() {
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/configstore/firebase-tools.json'), 'utf8'));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: cfg.tokens.refresh_token, grant_type: 'refresh_token' }),
  }).then((x) => x.json());
  if (!r.access_token) throw new Error('firebase 로그인이 필요합니다: npx firebase-tools login');
  return r.access_token;
}

async function api(token, method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.error?.message || ''}`);
  return j;
}

(async () => {
  const [name, email, pwArg] = process.argv.slice(2);
  if (!name || !email) { console.log('사용법: node tools/add-staff.js <이름> <이메일> [비밀번호]'); process.exit(1); }
  const token = await accessToken();
  const IT = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;

  const found = await api(token, 'POST', `${IT}/accounts:lookup`, { email: [email] });
  let uid = found.users?.[0]?.localId, password = null;
  if (!uid) {
    password = pwArg || 'airkick-' + Math.random().toString(36).slice(2, 8);
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, displayName: name }),
    }).then((x) => x.json());
    if (!r.localId) throw new Error('계정 생성 실패: ' + (r.error?.message || ''));
    uid = r.localId;
  } else {
    await api(token, 'POST', `${IT}/accounts:update`, { localId: uid, displayName: name });
  }
  await api(token, 'PATCH', `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/staff/${uid}`,
    { fields: { name: { stringValue: name }, email: { stringValue: email }, addedAt: { timestampValue: new Date().toISOString() } } });
  console.log(`✔ ${name} <${email}> 운영진 등록 완료` + (password ? ` · 임시 비밀번호: ${password}` : ' (기존 계정)'));
})().catch((e) => { console.error('✘ ' + e.message); process.exit(1); });
