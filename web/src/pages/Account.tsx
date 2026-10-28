import { useState, type FormEvent } from 'react';
import { Download, LogOut, Share2 } from 'lucide-react';
import { api, message, type Person, type TagGroup, type UserInfo } from '../api.js';
import { Button, Field, Link, LoadState, Notice, PageHead, fmtTime, useLoad, yuan } from '../components/Ui.js';

type Session = { id: string; device: string; createdAt: number; lastSeen: number; current: boolean };
type Stats = { totalMeals: number; monthly: { month: string; count: number }[]; modes: { dineIn: number; takeaway: number }; topRestaurants: { id: string; name: string; count: number }[]; againDishes: number; unratedMeals: number; amount: { total: number; withAmount: number; missing: number }; range: { from: string; to: string } | null };

function StatsCard() {
  const s = useLoad(() => api<Stats>('/stats'), []);
  if (!s.data) return <LoadState error={s.error} onRetry={s.reload} />;
  const d = s.data;
  const max = Math.max(1, ...d.monthly.map(m => m.count));
  return (
    <section className="card" aria-labelledby="stats-title">
      <h2 className="card-title" id="stats-title">回顾</h2>
      {d.totalMeals === 0 ? <p className="muted small">还没有就餐记录。</p> : (<>
        <div className="stat-grid">
          <div className="stat"><b>{d.totalMeals}</b><span>已记录的就餐</span></div>
          <div className="stat"><b>{d.againDishes}</b><span>想再吃的菜</span></div>
          <div className="stat"><b>{d.modes.dineIn} / {d.modes.takeaway}</b><span>堂食 / 外卖</span></div>
          <div className="stat"><b>{d.unratedMeals}</b><span>还没评价的记录</span></div>
        </div>
        <div className="bars" aria-label="近 12 个月就餐次数">
          {d.monthly.map(m => <div key={m.month} className="bar" style={{ height: `${(m.count / max) * 100}%` }} title={`${m.month}：${m.count} 次`} />)}
        </div>
        <div className="bar-labels" aria-hidden>{d.monthly.map(m => <span key={m.month}>{Number(m.month.slice(5))}</span>)}</div>
        {d.topRestaurants.length > 0 && <p className="small">常去：{d.topRestaurants.map(r => `${r.name}（${r.count} 次）`).join('、')}</p>}
        <p className="small muted">
          有金额的 {d.amount.withAmount} 次共 {yuan(d.amount.total)}；{d.amount.missing} 次没填金额，不计入。
          {d.range && ` 记录范围：${fmtTime(d.range.from)} 至 ${fmtTime(d.range.to)}，只统计你记下来的经历。`}
        </p>
      </>)}
    </section>
  );
}

function PeopleCard() {
  const people = useLoad(() => api<Person[]>('/people?archived=include'), []);
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => { setError(''); try { await fn(); people.reload(); } catch (x) { setError(message(x)); } };
  return (
    <section className="card" aria-labelledby="people-title">
      <h2 className="card-title" id="people-title">口味人物</h2>
      <p className="muted small">共用账号时，用人物区分“我喜欢”和“她不喜欢”。人物不需要注册。</p>
      {error && <Notice tone="error">{error}</Notice>}
      {!people.data ? <LoadState error={people.error} onRetry={people.reload} /> : (
        <ul className="plain-list">
          {people.data.map(p => (
            <li key={p.id} className="split">
              <input aria-label={`${p.name}的名字`} value={edit[p.id] ?? p.name} maxLength={60} onChange={e => setEdit({ ...edit, [p.id]: e.target.value })} />
              <div className="row">
                {(edit[p.id] ?? p.name) !== p.name && <Button variant="soft" onClick={() => run(() => api(`/people/${p.id}`, { method: 'PUT', json: { name: edit[p.id], version: p.version } }))}>保存</Button>}
                {p.archived
                  ? <Button variant="ghost" onClick={() => run(() => api(`/people/${p.id}`, { method: 'PUT', json: { archived: false, version: p.version } }))}>恢复</Button>
                  : <Button variant="ghost" onClick={() => run(() => api(`/people/${p.id}`, { method: 'DELETE' }))}>归档</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="inline-add" onSubmit={(e: FormEvent) => { e.preventDefault(); if (name.trim()) void run(async () => { await api('/people', { method: 'POST', json: { name: name.trim() } }); setName(''); }); }}>
        <input aria-label="新人物名字" placeholder="如：女朋友、小王" value={name} maxLength={60} onChange={e => setName(e.target.value)} />
        <Button type="submit" variant="soft" disabled={!name.trim()}>添加</Button>
      </form>
    </section>
  );
}

function TagsCard() {
  const groups = useLoad(() => api<TagGroup[]>('/tag-options'), []);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const all = [...new Set((groups.data ?? []).flatMap(g => g.names))];
  const custom = groups.data?.find(g => g.category === '我的标签')?.names ?? [];
  const run = async (fn: () => Promise<string>) => { setMsg(null); try { setMsg({ tone: 'ok', text: await fn() }); groups.reload(); } catch (x) { setMsg({ tone: 'error', text: message(x) }); } };
  return (
    <section className="card" aria-labelledby="tags-title">
      <h2 className="card-title" id="tags-title">标签</h2>
      <p className="muted small">常用分类已内置；自定义标签：{custom.length ? custom.join('、') : '暂无'}</p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <form className="inline-add" onSubmit={e => { e.preventDefault(); if (name.trim()) void run(async () => { await api('/tags', { method: 'POST', json: { name: name.trim() } }); setName(''); return '已添加标签'; }); }}>
        <input aria-label="新标签" placeholder="如：深夜救命" value={name} maxLength={40} onChange={e => setName(e.target.value)} />
        <Button type="submit" variant="soft" disabled={!name.trim()}>添加</Button>
      </form>
      <details className="merge">
        <summary>合并同义标签</summary>
        <Field label="把这个标签"><select value={from} onChange={e => setFrom(e.target.value)}><option value="">选择</option>{all.map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field label="合并为"><select value={to} onChange={e => setTo(e.target.value)}><option value="">选择</option>{all.map(t => <option key={t}>{t}</option>)}</select></Field>
        <Button variant="soft" disabled={!from || !to || from === to} onClick={() => void run(async () => { const r = await api<{ changed: number }>('/tags/merge', { method: 'POST', json: { from, to } }); return `已合并，更新了 ${r.changed} 条记录`; })}>合并</Button>
      </details>
    </section>
  );
}

function SecurityCard({ user, onSignedOut }: { user: UserInfo; onSignedOut: () => void }) {
  const sessions = useLoad(() => api<Session[]>('/auth/sessions'), []);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [invite, setInvite] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const fail = (x: unknown) => setMsg({ tone: 'error', text: message(x) });
  return (
    <section className="card" aria-labelledby="sec-title">
      <h2 className="card-title" id="sec-title">账号与设备</h2>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {!sessions.data ? <LoadState error={sessions.error} onRetry={sessions.reload} /> : (
        <ul className="plain-list">
          {sessions.data.map(s => (
            <li key={s.id} className="split">
              <div><strong>{s.device}</strong>{s.current && <span className="badge">这台设备</span>}<p className="muted small">最近使用 {fmtTime(s.lastSeen)}</p></div>
              {!s.current && <Button variant="ghost" onClick={async () => { try { await api(`/auth/sessions/${s.id}`, { method: 'DELETE' }); sessions.reload(); } catch (x) { fail(x); } }}>移除</Button>}
            </li>
          ))}
        </ul>
      )}
      <Button variant="danger" className="btn-block" onClick={async () => { try { await api('/auth/logout', { method: 'POST' }); onSignedOut(); } catch (x) { fail(x); } }}><LogOut size={18} aria-hidden />退出这台设备</Button>
      <details>
        <summary>修改密码</summary>
        <form onSubmit={async e => { e.preventDefault(); try { await api('/auth/password', { method: 'POST', json: { current, password: next } }); onSignedOut(); } catch (x) { fail(x); } }}>
          <Field label="原密码"><input type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} /></Field>
          <Field label="新密码" hint="至少 10 个字符；修改后所有设备需要重新登录"><input type="password" autoComplete="new-password" required minLength={10} maxLength={72} value={next} onChange={e => setNext(e.target.value)} /></Field>
          <Button type="submit" variant="soft">修改密码</Button>
        </form>
      </details>
      {user.role === 'admin' && (
        <details>
          <summary>邀请朋友注册</summary>
          <p className="muted small">朋友会得到自己独立的账号和数据；邀请 7 天内有效，只能用一次。</p>
          {invite ? <Field label="邀请链接"><input readOnly value={invite} onFocus={e => e.target.select()} /></Field>
            : <Button variant="soft" onClick={async () => { try { const r = await api<{ token: string }>('/auth/invites', { method: 'POST' }); setInvite(`${location.origin}/join?invite=${r.token}`); } catch (x) { fail(x); } }}>生成邀请链接</Button>}
        </details>
      )}
    </section>
  );
}

export function Account({ user, onSignedOut }: { user: UserInfo; onSignedOut: () => void }) {
  return (
    <>
      <PageHead title="我的" sub={`已登录：${user.username}`} />
      <div className="row quick">
        <Link to="/shares" className="btn btn-soft"><Share2 size={18} aria-hidden />分享管理</Link>
        <a className="btn btn-ghost" href="/api/export" download><Download size={18} aria-hidden />导出数据</a>
      </div>
      <StatsCard />
      <PeopleCard />
      <TagsCard />
      <SecurityCard user={user} onSignedOut={onSignedOut} />
    </>
  );
}
