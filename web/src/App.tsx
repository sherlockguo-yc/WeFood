import { useCallback, useEffect, useState } from 'react';
import { BookOpen, PenLine, UserRound, Utensils } from 'lucide-react';
import { api, message, onUnauthorized, setCsrf, type UserInfo } from './api.js';
import { useLocation } from './router.js';
import { Button, Empty, Link, Notice } from './components/Ui.js';
import { AuthPage } from './pages/Auth.js';
import { Discover } from './pages/Discover.js';
import { Library } from './pages/Library.js';
import { RestaurantPage } from './pages/Restaurant.js';
import { Record } from './pages/Record.js';
import { Account } from './pages/Account.js';
import { Shares } from './pages/Shares.js';
import { PublicShare } from './pages/PublicShare.js';

type Boot = { status: 'loading' } | { status: 'error'; error: string } | { status: 'auth'; initialized: boolean } | { status: 'ready'; user: UserInfo };

export function App() {
  const loc = useLocation();
  const path = loc.split('?')[0];
  if (path.startsWith('/s/')) return <PublicShare token={decodeURIComponent(path.slice(3))} />;
  return <Private loc={loc} path={path} />;
}

function Private({ loc, path }: { loc: string; path: string }) {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const load = useCallback(async () => {
    try {
      const s = await api<{ initialized: boolean; user: UserInfo | null; csrf: string }>('/auth/status');
      setCsrf(s.csrf);
      setBoot(s.user ? { status: 'ready', user: s.user } : { status: 'auth', initialized: s.initialized });
    } catch (e) { setBoot({ status: 'error', error: message(e) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => onUnauthorized(() => { void load(); }), [load]);

  if (boot.status === 'loading') return <div className="boot">正在打开 WeFood…</div>;
  if (boot.status === 'error') return <div className="auth"><Notice tone="error" action={<Button variant="soft" onClick={() => void load()}>重试</Button>}>{boot.error}</Notice></div>;
  if (boot.status === 'auth') return <AuthPage initialized={boot.initialized} onDone={() => void load()} />;
  return <Shell user={boot.user} loc={loc} path={path} onSignedOut={() => void load()} />;
}

const TABS = [
  { to: '/', label: '吃什么', Icon: Utensils },
  { to: '/library', label: '记忆库', Icon: BookOpen },
  { to: '/record', label: '记录', Icon: PenLine },
  { to: '/me', label: '我的', Icon: UserRound }
];

function Shell({ user, loc, path, onSignedOut }: { user: UserInfo; loc: string; path: string; onSignedOut: () => void }) {
  const query = loc.split('?')[1] ?? '';
  const restaurant = path.match(/^\/restaurants\/([^/]+)$/);
  let page;
  if (path === '/') page = <Discover />;
  else if (path === '/library') page = <Library loc={loc} />;
  else if (restaurant) page = <RestaurantPage id={decodeURIComponent(restaurant[1])} />;
  else if (path === '/record') page = <Record key={query} user={user} loc={loc} />;
  else if (path === '/me') page = <Account user={user} onSignedOut={onSignedOut} />;
  else if (path === '/shares') page = <Shares />;
  else page = <Empty title="页面不存在"><Link to="/" className="btn btn-primary">回到首页</Link></Empty>;

  const active = (to: string) => to === '/' ? path === '/'
    : path.startsWith(to) || (to === '/library' && path.startsWith('/restaurants')) || (to === '/me' && path.startsWith('/shares'));

  return (
    <div className="app">
      <main className="main">{page}</main>
      <nav className="tabbar" aria-label="主导航">
        {TABS.map(({ to, label, Icon }) => (
          <Link key={to} to={to} className={`tab${active(to) ? ' is-on' : ''}`} current={active(to)}>
            <Icon size={22} aria-hidden /><span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
