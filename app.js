// app.js
'use strict';

/* ===========================
   LocalStorage Keys & State
=========================== */
const KEY_SETTINGS   = 'dj_settings_v1';
const KEY_ENTRIES    = 'dj_entries_v1';
const KEY_AUTH       = 'dj_auth_v1';
const KEY_API_LINKS  = 'dj_api_links_v1';
const KEY_USERS      = 'dj_users_v1';     // 회원가입 사용자 저장

let settings = { ccy:'USDT', initialEquity:10000 };
let entries  = [];
let auth     = null;
let apiLinks = {};
let users    = {};                        // { [id]: { pwHash, createdAt } }
let KRW_PER_USDT = null;                  // 환율 캐시

/* ===========================
   Helpers
=========================== */
const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0,10);
const fmt = (n, ccy) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(n) + (ccy ? ' ' + ccy : '');

/* Save/Load */
function saveSettings(){ localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings)); }
function saveEntries(){ localStorage.setItem(KEY_ENTRIES, JSON.stringify(entries)); }
function saveAuth(){ localStorage.setItem(KEY_AUTH, JSON.stringify(auth)); }
function saveApiLinks(){ localStorage.setItem(KEY_API_LINKS, JSON.stringify(apiLinks)); }
function saveUsers(){ localStorage.setItem(KEY_USERS, JSON.stringify(users)); }

(function loadAll(){
  try{ const s=localStorage.getItem(KEY_SETTINGS); if(s) settings=JSON.parse(s)||settings; }catch{}
  try{ const e=localStorage.getItem(KEY_ENTRIES);  if(e) entries =JSON.parse(e)||entries; }catch{}
  try{ const a=localStorage.getItem(KEY_AUTH);     if(a) auth    =JSON.parse(a)||auth; }catch{}
  try{ const l=localStorage.getItem(KEY_API_LINKS);if(l) apiLinks=JSON.parse(l)||apiLinks; }catch{}
  try{ const u=localStorage.getItem(KEY_USERS);    if(u) users   =JSON.parse(u)||users; }catch{}
})();

/* ===========================
   Tickers & Normalization
=========================== */
const DEFAULT_TICKERS = ['BTC/USDT','ETH/USDT','SOL/USDT','XRP/USDT','BNB/USDT'];
function populateTickerList(){
  const dl = $('tickerList');
  if (!dl) return;
  dl.innerHTML = DEFAULT_TICKERS.map(t=>`<option value="${t}">`).join('');
}
function normalizeTicker(s){
  return s ? s.trim().toUpperCase().replace(/[-_]/g,'/').replace(/\s+/g,'') : '';
}

/* ===========================
   PnL Aggregate & Equity/MDD
=========================== */
function aggregateDaily(){
  const map = new Map();
  for (const e of entries){
    if (!e.date) continue;
    const k = e.date;
    map.set(k, (map.get(k)||0) + Number(e.pnl||0));
  }
  return [...map.entries()]
    .map(([d,pnl])=>({ d, pnl }))
    .sort((a,b)=>a.d.localeCompare(b.d));
}
function computeEquitySeries(daily){
  let equity = Number(settings.initialEquity||0);
  const eq = [];
  let peak = equity;
  let mdd  = 0;
  const ddSeries = [];
  for (const x of daily){
    equity += Number(x.pnl||0);
    eq.push({ d:x.d, e:equity });
    peak = Math.max(peak, equity);
    const dd = peak>0 ? (equity - peak) / peak : 0;
    ddSeries.push({ d:x.d, dd });
    mdd = Math.min(mdd, dd);
  }
  return { eq, ddSeries, mdd };
}

/* ===========================
   Table Rendering
=========================== */
function rebuildTable(){
  const tbody = $('rows');
  if (!tbody) return;
  tbody.innerHTML = '';
  const sorted = [...entries].sort((a,b)=>a.date.localeCompare(b.date));
  for (const e of sorted){
    const krwHint = (settings.ccy==='USDT' && KRW_PER_USDT && isFinite(e.pnl))
      ? `<div class="text-[11px] text-slate-500">≈ ${fmt(e.pnl * KRW_PER_USDT, 'KRW')}</div>` : '';
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-200/50';
    tr.dataset.id = e.id;
    tr.innerHTML = `
      <td class="py-2 px-2">${e.date||''}</td>
      <td class="px-2">${e.symbol||''}</td>
      <td class="px-2">${e.side||''}</td>
      <td class="px-2 ${e.pnl>=0?'text-emerald-600':'text-rose-500'} font-medium">
        ${isFinite(e.pnl) ? (e.pnl>=0? ('+'+e.pnl):e.pnl) : ''}${krwHint}
      </td>
      <td class="px-2 max-w-[240px] truncate" title="${e.reason??''}">${e.reason??''}</td>
      <td class="px-2"><button class="text-xs underline" data-del="${e.id}">🗑</button></td>`;
    tbody.appendChild(tr);
  }
}
$('rows')?.addEventListener('click', (ev)=>{
  const id = ev.target?.dataset?.del;
  if (!id) return;
  entries = entries.filter(x=>x.id!==id);
  saveEntries();
  rebuildTable();
  refreshCharts();
  updateEquityHeader();
});

/* ===========================
   Charts (Chart.js)
=========================== */
let equityChart, pnlChart, ddChart;
function refreshCharts(){
  const daily = aggregateDaily();
  const { eq, ddSeries, mdd } = computeEquitySeries(daily);
  const labels = daily.map(x=>x.d);
  const tot = daily.reduce((a,b)=>a+b.pnl,0);
  const ret = settings.initialEquity ? (eq.length ? (eq.at(-1).e / settings.initialEquity - 1) : 0) : 0;

  if ($('equitySummary')){
    $('equitySummary').textContent =
      `누적 ${fmt(tot, settings.ccy)} / 수익률 ${(ret*100).toFixed(2)}% / MDD ${(mdd*100).toFixed(2)}%`;
  }

  for (const c of [equityChart, pnlChart, ddChart]){ if (c) c.destroy(); }
  if (window.Chart){
    if ($('equityChart')){
      equityChart = new Chart($('equityChart'), {
        type: 'line',
        data: { labels, datasets: [{ label:'Equity', data: eq.map(x=>x.e), borderWidth:2, pointRadius:0, tension:0.25, fill:true }] },
        options: { plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:{ maxTicksLimit:6 } }, y:{ beginAtZero:false } } }
      });
    }
    if ($('pnlChart')){
      pnlChart = new Chart($('pnlChart'), {
        type: 'bar',
        data: { labels, datasets: [{ label:'PnL', data: daily.map(x=>x.pnl) }] },
        options: { plugins:{ legend:{ display:false } } }
      });
    }
    if ($('ddChart')){
      ddChart = new Chart($('ddChart'), {
        type: 'bar',
        data: { labels, datasets: [{ label:'Drawdown(%)', data: ddSeries.map(x=>(x.dd*100).toFixed(2)) }] },
        options: { plugins:{ legend:{ display:false } }, scales:{ y:{ ticks:{ callback:v=>v+'%' } } } }
      });
    }
  }
}

/* ===========================
   Header (Net / Initial)
=========================== */
function updateEquityHeader(){
  if ($('initialEquityView')){
    $('initialEquityView').textContent = fmt(Number(settings.initialEquity||0), settings.ccy);
  }
  const tot = entries.reduce((a,b)=> a + Number(b.pnl||0), 0);
  const net = Number(settings.initialEquity||0) + tot;

  let html = fmt(net, settings.ccy);
  if (settings.ccy === 'USDT' && KRW_PER_USDT){
    const netKrw = net * KRW_PER_USDT;
    html += `<div class="text-xs text-slate-500">≈ ${fmt(netKrw, 'KRW')}</div>`;
  }
  if ($('netEquity')) $('netEquity').innerHTML = html;
}

/* ===========================
   Forms (Entry, Settings)
=========================== */
$('tickerPreset')?.addEventListener('change', (e)=>{
  const v = e.target.value;
  if (v && v!=='__custom') { $('symbol').value = v; }
  if (v==='__custom') { $('symbol').focus(); }
});

$('entryForm')?.addEventListener('submit', (e)=>{
  e.preventDefault();
  const sym = normalizeTicker($('symbol').value || $('tickerPreset').value);
  if (!sym){ alert('티커를 선택하거나 입력하세요 (예: BTC/USDT)'); return; }
  const entry = {
    id: crypto.randomUUID(),
    date: $('date').value,
    symbol: sym,
    side: $('side').value,
    pnl: Number($('pnl').value),
    reason: $('reason').value.trim()
  };
  entries.push(entry);
  saveEntries();
  rebuildTable();
  refreshCharts();
  updateEquityHeader();
  resetForm();
});
function resetForm(){
  if ($('date')) $('date').value = today();
  if ($('tickerPreset')) $('tickerPreset').value = '';
  if ($('symbol')) $('symbol').value = '';
  if ($('side')) $('side').value = 'LONG';
  if ($('pnl')) $('pnl').value = '';
  if ($('reason')) $('reason').value = '';
}
$('clearForm')?.addEventListener('click', resetForm);

$('saveSettings')?.addEventListener('click', ()=>{
  settings.ccy = $('ccy')?.value || settings.ccy;
  settings.initialEquity = Number($('initialEquity')?.value || 0);
  saveSettings();
  refreshCharts();
  rebuildTable();
  updateEquityHeader();
});
function hydrateSettings(){
  if ($('ccy')) $('ccy').value = settings.ccy || 'USDT';
  if ($('initialEquity')) $('initialEquity').value = settings.initialEquity ?? '';
}

/* ===========================
   Excel Export (xlsx)
=========================== */
function exportToExcel(){
  if (!window.XLSX){ alert('엑셀 라이브러리 로드 오류'); return; }

  const daily = aggregateDaily();
  const { eq, ddSeries, mdd } = computeEquitySeries(daily);
  const wb = XLSX.utils.book_new();

  const wsEntries = XLSX.utils.json_to_sheet(
    entries.map(e => ({
      날짜: e.date,
      심볼: e.symbol,
      방향: e.side,
      손익금: e.pnl,
      손익금_KRW: (settings.ccy==='USDT' && KRW_PER_USDT && isFinite(e.pnl))
        ? Math.round(e.pnl * KRW_PER_USDT * 100) / 100 : '',
      매매근거: e.reason
    }))
  );
  XLSX.utils.book_append_sheet(wb, wsEntries, 'Entries');

  const wsDaily = XLSX.utils.json_to_sheet(
    daily.map(d => ({
      날짜: d.d,
      일일손익: d.pnl,
      일일손익_KRW: (settings.ccy==='USDT' && KRW_PER_USDT)
        ? Math.round(d.pnl * KRW_PER_USDT * 100) / 100 : ''
    }))
  );
  XLSX.utils.book_append_sheet(wb, wsDaily, 'DailyPnL');

  const wsEq = XLSX.utils.json_to_sheet(
    eq.map((r,i) => ({
      날짜: r.d,
      자산: r.e,
      드로우다운퍼센트: Number((ddSeries[i].dd * 100).toFixed(2))
    }))
  );
  XLSX.utils.book_append_sheet(wb, wsEq, 'Equity');

  const tot = daily.reduce((a,b)=>a+b.pnl,0);
  const ret = settings.initialEquity ? (eq.length ? (eq.at(-1).e / settings.initialEquity - 1) : 0) : 0;

  const wsSummary = XLSX.utils.json_to_sheet([{
    기준통화: settings.ccy,
    초기자본: settings.initialEquity,
    누적손익: tot,
    누적손익_KRW: (settings.ccy==='USDT' && KRW_PER_USDT)
      ? Math.round(tot * KRW_PER_USDT * 100) / 100 : '',
    수익률퍼센트: Number((ret * 100).toFixed(2)),
    MDD퍼센트: Number((mdd * 100).toFixed(2)),
    환율_출처: 'CoinGecko (USDT→KRW)'
  }]);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  XLSX.writeFile(wb, `coinpnl_${new Date().toISOString().slice(0,10)}.xlsx`);
}
$('exportXlsxBtn')?.addEventListener('click', exportToExcel);
$('meExportXlsxBtn')?.addEventListener('click', exportToExcel);

/* ===========================
   Exchange Link (Demo)
=========================== */
function markExchangeLinked(){
  document.querySelectorAll('.exch-connect-btn')?.forEach(b=>{
    const ex = b.dataset.exchange;
    if (apiLinks[ex]?.linked){
      b.classList.add('bg-emerald-50','border-emerald-300');
      b.textContent = `${ex} 연동됨`;
    }
  });
}
function wireExchangeButtons(){
  document.querySelectorAll('.exch-connect-btn')?.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const ex = btn.dataset.exchange;
      $('apiConnectPanel')?.classList.remove('hidden');
      if ($('apiExchangeName')) $('apiExchangeName').textContent = ex;
      if ($('apiKey')) $('apiKey').value = '';
      if ($('apiSecret')) $('apiSecret').value = '';
      if ($('apiPassphrase')) $('apiPassphrase').value = '';
      if ($('apiStatus')){
        $('apiStatus').textContent = '';
        $('apiStatus').className = 'text-sm text-slate-500';
      }
      if ($('btnDoLink')) $('btnDoLink').dataset.exchange = ex;
    });
  });
}
$('btnDoLink')?.addEventListener('click', ()=>{
  const ex   = $('btnDoLink').dataset.exchange;
  const key  = $('apiKey')?.value.trim() || '';
  const sec  = $('apiSecret')?.value.trim() || '';
  const pass = $('apiPassphrase')?.value.trim() || '';
  if (key.length < 8 || sec.length < 8){
    if ($('apiStatus')){
      $('apiStatus').textContent = '❌ 실패: API Key/Secret을 확인하세요 (8자 이상).';
      $('apiStatus').className = 'text-sm text-rose-600';
    }
    return;
  }
  if ($('apiStatus')){
    $('apiStatus').textContent = '연동 중...';
    $('apiStatus').className = 'text-sm text-slate-500';
  }
  setTimeout(()=>{
    if (/fail/i.test(key + sec + pass)){
      if ($('apiStatus')){
        $('apiStatus').textContent = '❌ 연동 실패: 키 정보를 다시 확인하세요.';
        $('apiStatus').className = 'text-sm text-rose-600';
      }
    } else {
      apiLinks[ex] = { linked:true, at:new Date().toISOString() };
      saveApiLinks();
      if ($('apiStatus')){
        $('apiStatus').textContent = '✅ 연동 성공! (키는 저장하지 않음)';
        $('apiStatus').className = 'text-sm text-emerald-600';
      }
      markExchangeLinked();
    }
  }, 400);
});

/* ===========================
   Indicators (1min refresh)
=========================== */
function smoothUpdate(elId, nextText){
  const el = $(elId);
  if (!el) return;
  if (el.textContent === nextText) return;
  el.style.transform = 'translateY(4px)';
  el.style.opacity = '0';
  setTimeout(()=>{
    el.textContent = nextText;
    el.style.transform = 'translateY(0)';
    el.style.opacity = '1';
  }, 160);
}
async function fetchIndicatorsOnce(){
  try{
    // 1) USDT→KRW
    const res1 = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=krw');
    const js1  = await res1.json();
    const krw  = js1?.tether?.krw ?? null;
    if (krw != null){
      KRW_PER_USDT = krw;
      smoothUpdate('usdtKrw', new Intl.NumberFormat('ko-KR').format(krw));
      updateEquityHeader();
      rebuildTable();
    }

    // 2) BTC Dominance
    const res2 = await fetch('https://api.coingecko.com/api/v3/global');
    const js2  = await res2.json();
    const btcDom = js2?.data?.market_cap_percentage?.btc;
    if (typeof btcDom === 'number'){
      smoothUpdate('btcDominance', btcDom.toFixed(2) + '%');
    }

    // 3) Fear & Greed
    const res3 = await fetch('https://api.alternative.me/fng/');
    const js3  = await res3.json();
    const fg   = js3?.data?.[0]?.value ?? null;
    if (fg != null){
      smoothUpdate('fearGreed', String(fg));
    }
  }catch(err){
    console.error('지표 불러오기 실패:', err);
  }
}
let _indicatorsTimer = null;
function startIndicators(){
  fetchIndicatorsOnce();
  if (_indicatorsTimer) clearInterval(_indicatorsTimer);
  _indicatorsTimer = setInterval(fetchIndicatorsOnce, 60*1000);
}

/* ===========================
   Auth (Login / Signup)
=========================== */
async function sha256(text){
  try{
    if (crypto?.subtle?.digest){
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
    }
  }catch{}
  return text; // fallback (데모)
}
function switchAuthTab(mode){
  const loginBtn = $('authTabLogin');
  const signBtn  = $('authTabSignup');
  const loginFrm = $('loginForm');
  const signFrm  = $('signupForm');
  if (!loginBtn || !signBtn || !loginFrm || !signFrm) return;

  const active = ['bg-slate-900','text-white'];
  const idle   = ['border','border-slate-300'];

  if (mode === 'signup'){
    loginBtn.classList.remove(...active); loginBtn.classList.add(...idle);
    signBtn.classList.remove(...idle);    signBtn.classList.add(...active);
    loginFrm.classList.add('hidden');     signFrm.classList.remove('hidden');
  } else {
    signBtn.classList.remove(...active);  signBtn.classList.add(...idle);
    loginBtn.classList.remove(...idle);   loginBtn.classList.add(...active);
    signFrm.classList.add('hidden');      loginFrm.classList.remove('hidden');
  }
}
$('authTabLogin') ?.addEventListener('click', ()=>switchAuthTab('login'));
$('authTabSignup')?.addEventListener('click', ()=>switchAuthTab('signup'));

/* 회원가입 */
$('signupForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const id  = $('signupId')?.value.trim();
  const pw  = $('signupPw')?.value;
  const pw2 = $('signupPw2')?.value;

  if (!id || !pw)               return alert('아이디/비밀번호를 입력하세요.');
  if (pw.length < 8)            return alert('비밀번호는 8자 이상으로 설정하세요.');
  if (pw !== pw2)               return alert('비밀번호가 일치하지 않습니다.');
  if (users[id])                return alert('이미 존재하는 아이디입니다.');

  const pwHash = await sha256(pw);
  users[id] = { pwHash, createdAt: new Date().toISOString() };
  saveUsers();

  // 자동 로그인
  auth = { id, name:id, email:`${id}@local` };
  saveAuth();
  renderAuth();
});

/* 로그인 */
$('loginForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const id = $('loginId')?.value.trim();
  const pw = $('loginPw')?.value;

  const user = users[id];
  if (!user) return alert('존재하지 않는 아이디입니다.');

  const pwHash = await sha256(pw);
  if (pwHash !== user.pwHash) return alert('비밀번호가 올바르지 않습니다.');

  auth = { id, name:id, email:`${id}@local` };
  saveAuth();
  renderAuth();
});

/* Auth View 렌더링 + 로그인 후 라우팅 */
function renderAuth(){
  const out = $('authLoggedOut');
  const inn = $('authLoggedIn');
  if (!out || !inn) return;

  if (auth){
    out.classList.add('hidden');
    inn.classList.remove('hidden');
    if ($('authName')) $('authName').textContent = auth.name || '사용자';
    if ($('authEmail')) $('authEmail').textContent = auth.id || '';
    // 로그인/회원가입 직후 저널 탭으로
    switchTab('journal');
  } else {
    inn.classList.add('hidden');
    out.classList.remove('hidden');
    switchAuthTab('login'); // 기본은 로그인 탭
  }
}
$('btnLogout')?.addEventListener('click', ()=>{
  auth = null;
  saveAuth();
  renderAuth();
  switchTab('me');
});

/* ===========================
   Tabs & Guard
=========================== */
const tabs = document.querySelectorAll('.tab-item');
function switchTab(tab){
  tabs.forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('[data-page]')?.forEach(p=>p.classList.add('hidden'));
  document.querySelector(`[data-page="${tab}"]`)?.classList.remove('hidden');
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
}
tabs.forEach(t => t.addEventListener('click', (e)=>{
  const dest = t.dataset.tab;
  if (!auth && dest !== 'me'){
    e.preventDefault();
    switchTab('me');
    $('authBox')?.classList.add('ring-2','ring-emerald-400');
    setTimeout(()=>$('authBox')?.classList.remove('ring-2','ring-emerald-400'), 700);
    return;
  }
  switchTab(dest);
}));

/* ===========================
   Init
=========================== */
function init(){
  if ($('date')) $('date').value = today();
  populateTickerList();
  hydrateSettings();
  renderAuth();
  rebuildTable();
  refreshCharts();
  updateEquityHeader();
  wireExchangeButtons();
  markExchangeLinked();
  startIndicators();

  // 최초 진입: 로그인 안 했으면 'me'로, 했으면 'journal'
  if (!auth) {
    switchTab('me');
  } else {
    switchTab('journal');
  }
}

// DOM ready (defer 스크립트면 바로 호출해도 OK)
if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
