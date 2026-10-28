import { useState, type FormEvent } from 'react';
import { api, message, setCsrf, type UserInfo } from '../api.js';
import { Button, Field, Notice } from '../components/Ui.js';

const deviceName = () => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android 手机';
  if (/Macintosh/.test(ua)) return 'Mac 浏览器';
  if (/Windows/.test(ua)) return 'Windows 浏览器';
  return '浏览器';
};

export function AuthPage({ initialized, onDone }: { initialized: boolean; onDone: () => void }) {
  const invite = new URLSearchParams(location.search).get('invite') ?? '';
  const kind = invite ? 'register' : initialized ? 'login' : 'setup';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = kind === 'setup' ? '初始化 WeFood' : kind === 'register' ? '加入 WeFood' : '登录 WeFood';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api<{ csrf: string; user: UserInfo }>(`/auth/${kind}`, { method: 'POST', json: { username, password, device: deviceName(), setupToken, invite } });
      setCsrf(r.csrf);
      if (invite) history.replaceState(null, '', '/');
      onDone();
    } catch (x) { setError(message(x)); } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <p className="brand">WEFOOD · 私人食记</p>
      <h1 className="auth-title">{title}</h1>
      <p className="muted">
        {kind === 'setup' ? '创建第一个账号。初始化令牌只显示在启动服务的终端里，防止别人抢先注册。'
          : kind === 'register' ? '你收到了邀请，创建自己的账号后，数据与邀请人互相独立。'
          : '同一个账号可以在多台手机上同时登录。'}
      </p>
      <form className="card" onSubmit={submit}>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="用户名" hint="2-60 个字符，可用中文、字母、数字、下划线">
          <input name="username" autoComplete="username" required minLength={2} maxLength={60} value={username} onChange={e => setUsername(e.target.value)} />
        </Field>
        <Field label="密码" hint={kind === 'login' ? undefined : '至少 10 个字符'}>
          <input name="password" type="password" autoComplete={kind === 'login' ? 'current-password' : 'new-password'} required minLength={kind === 'login' ? 1 : 10} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} />
        </Field>
        {kind === 'setup' && (
          <Field label="初始化令牌" hint="查看本机运行 WeFood 的终端输出">
            <input name="setup-token" autoComplete="off" required value={setupToken} onChange={e => setSetupToken(e.target.value)} />
          </Field>
        )}
        <Button type="submit" className="btn-block" disabled={busy}>{busy ? '请稍候…' : kind === 'setup' ? '创建账号' : kind === 'register' ? '注册并登录' : '登录'}</Button>
      </form>
    </div>
  );
}
