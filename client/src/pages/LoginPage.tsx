import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { api, apiError } from '../api/client';

type Mode = 'login' | 'register';

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [account, setAccount] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const setAuth = useStore((s) => s.setAuth);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (mode === 'login') {
      if (!account.trim() || !password) return setErr('请输入账号和密码');
    } else {
      if (nickname.trim().length < 2) return setErr('昵称至少 2 个字符');
      if (password.length < 6) return setErr('密码至少 6 位');
    }
    setBusy(true);
    try {
      const res =
        mode === 'login'
          ? await api.login(account.trim(), password)
          : await api.register(nickname.trim(), password);
      setAuth(res.user, res.token);
      navigate('/', { replace: true });
    } catch (ex) {
      setErr(apiError(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-banner">
          <div className="logo">QQ</div>
          <div>
            <h1>WebQQ</h1>
            <p>网页版即时通讯 · 独立演示项目</p>
          </div>
        </div>
        <form className="login-body" onSubmit={submit}>
          <div className="mode-tabs">
            <span className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setErr(''); }}>
              登录
            </span>
            <span className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setErr(''); }}>
              注册
            </span>
          </div>

          {mode === 'login' ? (
            <input
              placeholder="QQ 号 / 昵称"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoFocus
            />
          ) : (
            <input
              placeholder="昵称（2-20 字符）"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoFocus
              style={{ marginBottom: 12 }}
            />
          )}

          <input
            type="password"
            placeholder="密码（6 位以上）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {err && <div style={{ color: '#e64545', fontSize: 13, marginTop: 12 }}>{err}</div>}

          <button className="login-btn" type="submit" disabled={busy} style={{ marginTop: 16 }}>
            {busy ? '请稍候…' : mode === 'login' ? '登 录' : '注 册'}
          </button>

          <div className="login-tip">
            {mode === 'register' ? '注册后将自动分配一个 6 位 QQ 号' : '首次使用？切换到注册页创建一个新账号'}
          </div>
        </form>
      </div>
    </div>
  );
}
