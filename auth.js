// auth.js — signup/login (localStorage demo)
(() => {
    const KEY_USERS = 'dj_users_v1';
    let users = {};
    try { const u = localStorage.getItem(KEY_USERS); if (u) users = JSON.parse(u) || {}; } catch {}
    const saveUsers = () => localStorage.setItem(KEY_USERS, JSON.stringify(users));
  
    async function sha256(text){
      if (crypto?.subtle?.digest){
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
      }
      return text; // fallback (데모)
    }
  
    function switchAuthTab(mode){
      const loginBtn = document.getElementById('authTabLogin');
      const signBtn  = document.getElementById('authTabSignup');
      const loginFrm = document.getElementById('loginForm');
      const signFrm  = document.getElementById('signupForm');
      const active = ['bg-slate-900','text-white'];
      const idle   = ['border','border-slate-300'];
  
      if (!loginBtn || !signBtn || !loginFrm || !signFrm) return;
  
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
  
    // 탭
    document.getElementById('authTabLogin') ?.addEventListener('click', ()=>switchAuthTab('login'));
    document.getElementById('authTabSignup')?.addEventListener('click', ()=>switchAuthTab('signup'));
  
    // 회원가입
    document.getElementById('signupForm')?.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const id  = document.getElementById('signupId').value.trim();
      const pw  = document.getElementById('signupPw').value;
      const pw2 = document.getElementById('signupPw2').value;
  
      if (!id || !pw)           return alert('아이디/비밀번호를 입력하세요.');
      if (pw.length < 8)        return alert('비밀번호는 8자 이상으로 설정하세요.');
      if (pw !== pw2)           return alert('비밀번호가 일치하지 않습니다.');
      if (users[id])            return alert('이미 존재하는 아이디입니다.');
  
      const pwHash = await sha256(pw);
      users[id] = { pwHash, createdAt: new Date().toISOString() };
      saveUsers();
  
      // 자동 로그인
      window.auth = { id, name:id, email:`${id}@local` };
      window.saveAuth?.();
      window.renderAuth?.();
    });
  
    // 로그인
    document.getElementById('loginForm')?.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const id = document.getElementById('loginId').value.trim();
      const pw = document.getElementById('loginPw').value;
      const user = users[id];
      if (!user) return alert('존재하지 않는 아이디입니다.');
  
      const pwHash = await sha256(pw);
      if (pwHash !== user.pwHash) return alert('비밀번호가 올바르지 않습니다.');
  
      window.auth = { id, name:id, email:`${id}@local` };
      window.saveAuth?.();
      window.renderAuth?.();
    });
  
    // 초기 상태: 로그인 탭
    switchAuthTab('login');
  })();
  