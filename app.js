// 에어킥태권도 회의록 관리
// 구분(수업 / 홍보·마케팅 / 특이사항)은 고정, 오른쪽 내용과 체크(교수님·실장님·담당자)만 편집합니다.

const DELETE = Symbol('delete');
const CHECKS = [
  { key: 'prof', name: '교수님' },
  { key: 'mgr', name: '실장님' },
  { key: 'owner', name: '담당자' },
];
// 고정 구분. group 이 있으면 특이사항처럼 소제목 + 번호 목록 형태.
const SECTIONS = [
  { key: 'class', name: '수업', labelPlaceholder: '반 / 시간' },
  { key: 'promo', name: '홍보·마케팅', labelPlaceholder: '항목' },
  {
    key: 'notes', name: '특이사항', groups: [
      { key: 'today', title: '금일 특이사항' },
      { key: 'fixed', title: '고정 사항' },
    ],
  },
];

// 처음 만들 때(이전 회의록이 없을 때) 쓰는 기본 틀
const DEFAULT_ROWS = [
  ['class', '예비고3\n5:00 - 6:00'],
  ['class', '주니어시범단\n5:30 - 6:00'],
  ['class', '주니어 시범단,선수단\n6:00 - 6:30'],
  ['class', '주니어시범단,선수단\n6:30 - 7:00'],
  ['class', '선수단\n7:00 - 8:00'],
  ['class', '선수단\n8:00 - 9:00'],
  ['promo', '현장 홍보'],
  ['promo', 'SNS 선수단'],
  ['promo', 'SNS 시범단'],
  ['today', ''],
  ['fixed', ''],
];

// ---------------------------------------------------------------- utils
const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function titleFor(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월${d}일 회의 및 진행사항`;
}
function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}. ${m}. ${d}. (${WEEK[new Date(y, m - 1, d).getDay()]})`;
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
  const last = keys[keys.length - 1];
  if (value === DELETE) delete o[last]; else o[last] = value;
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}
function userLabel(email) { return email ? email.split('@')[0] : '로컬'; }

// ---------------------------------------------------------------- stores
class LocalStore {
  constructor() { this.key = 'airkick-minutes-v1'; this.fns = new Set(); this.mode = 'local';
    window.addEventListener('storage', (e) => { if (e.key === this.key) this.emit(); }); }
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } }
  save(d) { localStorage.setItem(this.key, JSON.stringify(d)); this.emit(); }
  emit() { const d = this.load(); this.fns.forEach((f) => f(d)); }
  async init(onUser) { onUser({ email: null }); }
  watchAll(fn) { this.fns.add(fn); fn(this.load()); }
  async get(id) { return this.load()[id] || null; }
  async create(id, data) { const d = this.load(); d[id] = data; this.save(d); }
  async update(id, fields) {
    const d = this.load(); if (!d[id]) return;
    for (const [p, v] of Object.entries(fields)) setPath(d[id], p, v);
    d[id].updatedAt = Date.now(); this.save(d);
  }
  async remove(id) { const d = this.load(); delete d[id]; this.save(d); }
}

class FirebaseStore {
  constructor(config) { this.config = config; this.mode = 'cloud'; }
  async init(onUser) {
    const V = '10.12.2';
    const [app, auth, fs] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
    ]);
    this.fs = fs; this.authLib = auth;
    const a = app.initializeApp(this.config);
    this.auth = auth.getAuth(a);
    this.db = fs.getFirestore(a);
    this.col = fs.collection(this.db, 'meetings');
    auth.onAuthStateChanged(this.auth, (u) => onUser(u));
  }
  login(email, pw) { return this.authLib.signInWithEmailAndPassword(this.auth, email, pw); }
  logout() { this.unsub?.(); return this.authLib.signOut(this.auth); }
  watchAll(fn) {
    this.unsub?.();
    this.unsub = this.fs.onSnapshot(this.col, (snap) => {
      const d = {}; snap.forEach((doc) => { d[doc.id] = doc.data(); }); fn(d);
    }, (err) => alert('데이터를 불러오지 못했습니다: ' + err.message));
  }
  async get(id) { const s = await this.fs.getDoc(this.fs.doc(this.col, id)); return s.exists() ? s.data() : null; }
  create(id, data) { return this.fs.setDoc(this.fs.doc(this.col, id), data); }
  update(id, fields) {
    const f = { updatedAt: Date.now() };
    for (const [p, v] of Object.entries(fields)) f[p] = v === DELETE ? this.fs.deleteField() : v;
    return this.fs.updateDoc(this.fs.doc(this.col, id), f);
  }
  remove(id) { return this.fs.deleteDoc(this.fs.doc(this.col, id)); }
}

// ---------------------------------------------------------------- state
const store = window.FIREBASE_CONFIG ? new FirebaseStore(window.FIREBASE_CONFIG) : new LocalStore();
let me = null;            // 로그인 사용자
let all = {};             // { 'YYYY-MM-DD': meeting }
let currentId = null;
let renderedSig = '';     // 행 구성 시그니처 (바뀌면 다시 그림)

function sortedRows(m, section) {
  return Object.entries(m.rows || {})
    .filter(([, r]) => r.section === section)
    .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
}
function progress(m) {
  const rows = Object.values(m.rows || {});
  let done = 0; rows.forEach((r) => CHECKS.forEach((c) => { if (r.checks?.[c.key]) done++; }));
  return { done, total: rows.length * CHECKS.length };
}

async function save(fields, msg = '저장됨') {
  const s = $('#save-state'); s.textContent = '저장 중…';
  try { await store.update(currentId, fields); s.textContent = `${msg} · ${new Date().toLocaleTimeString('ko-KR')}`; }
  catch (e) { s.textContent = '저장 실패'; alert('저장 실패: ' + e.message); }
}

// ---------------------------------------------------------------- list
function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const ul = $('#meeting-list'); ul.replaceChildren();
  const ids = Object.keys(all).sort().reverse().filter((id) => {
    if (!q) return true;
    const m = all[id];
    const text = [id, m.title, ...Object.values(m.rows || {}).map((r) => `${r.label || ''} ${r.content || ''}`)].join(' ').toLowerCase();
    return text.includes(q);
  });
  if (!ids.length) ul.append(el('li', { class: 'muted small pad' }, q ? '검색 결과 없음' : '아직 회의록이 없습니다.'));
  for (const id of ids) {
    const p = progress(all[id]);
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    ul.append(el('li', { class: id === currentId ? 'active' : '', onclick: () => select(id) },
      el('div', { class: 'li-date' }, dateLabel(id)),
      el('div', { class: 'li-meta' },
        el('span', { class: 'bar' }, el('i', { style: `width:${pct}%` })),
        el('span', { class: 'small muted' }, `${p.done}/${p.total}`))));
  }
}

function select(id) {
  currentId = id; renderedSig = '';
  location.hash = id;
  renderList(); renderDoc();
}

// ---------------------------------------------------------------- doc
function autoGrow(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

function textArea(rowId, field, value, placeholder, cls) {
  let timer;
  const t = el('textarea', { class: cls, rows: 1, placeholder, 'data-row': rowId, 'data-field': field });
  t.value = value || '';
  const commit = () => { clearTimeout(timer); if (t.dataset.dirty) { delete t.dataset.dirty; save({ [`rows.${rowId}.${field}`]: t.value }); } };
  t.addEventListener('input', () => { autoGrow(t); t.dataset.dirty = '1'; clearTimeout(timer); timer = setTimeout(commit, 800); });
  t.addEventListener('blur', commit);
  requestAnimationFrame(() => autoGrow(t));
  return t;
}

function checkCell(rowId, row, c) {
  const v = row.checks?.[c.key];
  const box = el('input', { type: 'checkbox', checked: !!v, 'data-row': rowId, 'data-check': c.key,
    title: v ? `${userLabel(v.by)} · ${new Date(v.at).toLocaleString('ko-KR')}` : `${c.name} 확인`,
    onchange: (e) => save({ [`rows.${rowId}.checks.${c.key}`]: e.target.checked ? { by: me?.email || null, at: Date.now() } : DELETE },
      e.target.checked ? `${c.name} 확인` : `${c.name} 확인 취소`) });
  return el('td', { class: 'chk' }, el('label', { class: 'chk-wrap' }, box,
    el('span', { class: 'who', 'data-who': `${rowId}.${c.key}` }, v ? userLabel(v.by) : '')));
}

function rowActions(m, rowId, section) {
  const list = sortedRows(m, section);
  const idx = list.findIndex(([id]) => id === rowId);
  const swap = (j) => {
    if (j < 0 || j >= list.length) return;
    const [a, ra] = list[idx], [b, rb] = list[j];
    const oa = ra.order ?? idx, ob = rb.order ?? j;
    save({ [`rows.${a}.order`]: ob === oa ? oa + (j > idx ? 1 : -1) : ob, [`rows.${b}.order`]: oa }, '순서 변경');
  };
  return el('td', { class: 'act no-print' },
    el('button', { class: 'icon', title: '위로', onclick: () => swap(idx - 1) }, '▲'),
    el('button', { class: 'icon', title: '아래로', onclick: () => swap(idx + 1) }, '▼'),
    el('button', { class: 'icon del', title: '행 삭제', onclick: () => {
      const r = m.rows[rowId];
      if ((r.content || r.label) && !confirm('이 행을 삭제할까요?')) return;
      save({ [`rows.${rowId}`]: DELETE }, '행 삭제');
    } }, '✕'));
}

function addRowButton(m, section, text) {
  const list = sortedRows(m, section);
  const next = list.length ? (list[list.length - 1][1].order ?? list.length) + 1 : 0;
  return el('button', { class: 'add-row no-print', onclick: () =>
    save({ [`rows.${uid()}`]: { section, label: '', content: '', order: next, checks: {} } }, '행 추가') }, text);
}

function sigOf(m) {
  return SECTIONS.flatMap((s) => (s.groups || [s]).map((g) => g.key + ':' + sortedRows(m, g.key).map(([id]) => id).join(','))).join('|');
}

function renderDoc() {
  const m = currentId && all[currentId];
  $('#empty-state').hidden = !!m; $('#doc-view').hidden = !m;
  if (!m) return;
  $('#doc-title').textContent = m.title || titleFor(currentId);

  const sig = sigOf(m);
  if (sig === renderedSig) return patchDoc(m);
  renderedSig = sig;

  const tbody = $('#minutes-body'); tbody.replaceChildren();
  for (const s of SECTIONS) {
    const trs = [];
    if (s.groups) {
      for (const g of s.groups) {
        trs.push(el('tr', { class: 'group-head' }, el('td', { colspan: 5 }, g.title, ' ', addRowButton(m, g.key, '+ 항목')), el('td', { class: 'act no-print' })));
        sortedRows(m, g.key).forEach(([id, r], i) => trs.push(el('tr', {},
          el('td', { colspan: 2, class: 'content' }, el('div', { class: 'numbered' },
            el('span', { class: 'num' }, `${i + 1}.`), textArea(id, 'content', r.content, '내용 입력', 'cell'))),
          ...CHECKS.map((c) => checkCell(id, r, c)), rowActions(m, id, g.key))));
      }
    } else {
      sortedRows(m, s.key).forEach(([id, r]) => trs.push(el('tr', {},
        el('td', { class: 'label' }, textArea(id, 'label', r.label, s.labelPlaceholder, 'cell center')),
        el('td', { class: 'content' }, textArea(id, 'content', r.content, '내용 입력', 'cell')),
        ...CHECKS.map((c) => checkCell(id, r, c)), rowActions(m, id, s.key))));
      trs.push(el('tr', { class: 'add-line no-print' }, el('td', { colspan: 5 }, addRowButton(m, s.key, `+ ${s.name} 행 추가`)), el('td', { class: 'act' })));
    }
    const cat = el('th', { class: 'cat', rowspan: trs.length, scope: 'rowgroup' }, s.name);
    trs[0].prepend(cat);
    tbody.append(...trs);
  }
}

// 행 구성이 그대로면 값만 갱신 (입력 중인 칸은 건드리지 않음)
function patchDoc(m) {
  document.querySelectorAll('#minutes-body textarea').forEach((t) => {
    if (t === document.activeElement || t.dataset.dirty) return;
    const v = m.rows[t.dataset.row]?.[t.dataset.field] || '';
    if (t.value !== v) { t.value = v; autoGrow(t); }
  });
  document.querySelectorAll('#minutes-body input[data-check]').forEach((b) => {
    const v = m.rows[b.dataset.row]?.checks?.[b.dataset.check];
    b.checked = !!v;
    b.title = v ? `${userLabel(v.by)} · ${new Date(v.at).toLocaleString('ko-KR')}` : '';
    const who = document.querySelector(`[data-who="${b.dataset.row}.${b.dataset.check}"]`);
    if (who) who.textContent = v ? userLabel(v.by) : '';
  });
}

// ---------------------------------------------------------------- create / delete
async function createMeeting() {
  const date = $('#new-date').value;
  if (!date) return alert('날짜를 선택하세요.');
  if (all[date]) { if (confirm('이미 해당 날짜의 회의록이 있습니다. 열까요?')) select(date); return; }
  const rows = {};
  const prevId = Object.keys(all).filter((id) => id < date).sort().pop();
  if ($('#copy-prev').checked && prevId) {
    // 이전 회의록의 내용을 복사 (체크는 초기화, 금일 특이사항은 비움)
    for (const r of Object.values(all[prevId].rows || {})) {
      rows[uid()] = { section: r.section, label: r.label || '', content: r.section === 'today' ? '' : (r.content || ''), order: r.order ?? 0, checks: {} };
    }
    const todays = Object.entries(rows).filter(([, r]) => r.section === 'today');
    todays.slice(1).forEach(([id]) => delete rows[id]);
    if (!todays.length) rows[uid()] = { section: 'today', label: '', content: '', order: 0, checks: {} };
  } else {
    DEFAULT_ROWS.forEach(([section, label], i) => { rows[uid()] = { section, label, content: '', order: i, checks: {} }; });
  }
  await store.create(date, { title: titleFor(date), date, rows, createdAt: Date.now(), createdBy: me?.email || null, updatedAt: Date.now() });
  select(date);
}

async function deleteMeeting() {
  if (!currentId) return;
  if (!confirm(`${dateLabel(currentId)} 회의록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
  await store.remove(currentId);
  currentId = null; location.hash = '';
}

// ---------------------------------------------------------------- boot
function showApp(user) {
  me = user;
  $('#login-view').hidden = !!user; $('#app-view').hidden = !user;
  $('#logout-btn').hidden = !(user && store.mode === 'cloud');
  $('#user-name').textContent = user ? (store.mode === 'cloud' ? userLabel(user.email) : '') : '';
  if (!user) return;
  store.watchAll((d) => {
    all = d;
    if (!currentId) { const h = decodeURIComponent(location.hash.slice(1)); if (all[h]) currentId = h; }
    if (currentId && !all[currentId]) currentId = null;
    renderList(); renderDoc();
  });
}

function boot() {
  $('#mode-badge').textContent = store.mode === 'cloud' ? '공유 모드' : '로컬 모드 (공유 안 됨)';
  $('#mode-badge').classList.add(store.mode);
  $('#new-date').value = todayStr();
  $('#new-btn').onclick = createMeeting;
  $('#delete-btn').onclick = deleteMeeting;
  $('#print-btn').onclick = () => window.print();
  $('#search').oninput = renderList;
  $('#logout-btn').onclick = () => store.logout();
  window.addEventListener('hashchange', () => { const h = decodeURIComponent(location.hash.slice(1)); if (all[h] && h !== currentId) select(h); });
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault(); $('#login-error').textContent = '';
    try { await store.login($('#login-email').value.trim(), $('#login-pw').value); }
    catch (err) { $('#login-error').textContent = '로그인 실패: 이메일 또는 비밀번호를 확인하세요.'; }
  };
  store.init(showApp).catch((e) => alert('초기화 실패: ' + e.message));
}
boot();
