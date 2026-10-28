import { useRef, useState } from 'react';
import { Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { expiryFrom } from '../../../shared/period.js';
import { api, message, type Period, type PublicSnapshot, type Restaurant } from '../api.js';
import { Button, Chip, Field, Group, LoadState, Notice, PageHead, fmtTime, photoSrc, useLoad } from '../components/Ui.js';
import { SnapshotView } from './PublicShare.js';

type ShareView = { id: string; token: string; title: string; createdAt: string; expiresAt: string | null; revoked: boolean; status: 'active' | 'expired' | 'revoked'; restaurantCount: number };
const PRESETS: [string, Period][] = [['3 天', { unit: 'day', count: 3 }], ['7 天', { unit: 'day', count: 7 }], ['1 个月', { unit: 'month', count: 1 }], ['3 个月', { unit: 'month', count: 3 }], ['永久', { unit: 'forever', count: 1 }]];
const same = (a: Period, b: Period) => a.unit === b.unit && (a.unit === 'forever' || a.count === b.count);
const STATUS = { active: '有效', expired: '已到期', revoked: '已撤销' };
const linkOf = (token: string) => `${location.origin}/s/${token}`;

function PeriodPicker({ value, onChange, label }: { value: Period; onChange: (p: Period) => void; label: string }) {
  const [custom, setCustom] = useState(!PRESETS.some(([, p]) => same(p, value)));
  const expires = expiryFrom(value);
  return (
    <Group label={label}>
      <div className="chips">
        {PRESETS.map(([l, p]) => <Chip key={l} on={!custom && same(p, value)} onClick={() => { setCustom(false); onChange(p); }}>{l}</Chip>)}
        <Chip on={custom} onClick={() => { setCustom(true); if (value.unit === 'forever') onChange({ unit: 'day', count: 14 }); }}>自定义</Chip>
      </div>
      {custom && (
        <div className="inline-add">
          <input aria-label="自定义时长" inputMode="numeric" value={value.count} onChange={e => onChange({ unit: value.unit === 'forever' ? 'day' : value.unit, count: Math.max(1, Math.min(Number(e.target.value.replace(/[^\d]/g, '')) || 1, value.unit === 'month' ? 120 : 3650)) })} />
          <select aria-label="时长单位" value={value.unit === 'forever' ? 'day' : value.unit} onChange={e => onChange({ unit: e.target.value as 'day' | 'month', count: value.count })}><option value="day">天</option><option value="month">个月</option></select>
        </div>
      )}
      <span className="field-hint">{expires ? `将于 ${fmtTime(expires)}（北京时间）到期` : '永久有效，可以随时撤销'}</span>
    </Group>
  );
}

async function copy(text: string, input: HTMLInputElement | null) {
  try { await navigator.clipboard.writeText(text); return '已复制链接'; }
  catch { input?.select(); return '请长按链接手动复制'; }
}

function ShareItem({ s, onChanged }: { s: ShareView; onChanged: (text: string) => void }) {
  const [renewing, setRenewing] = useState(false);
  const [period, setPeriod] = useState<Period>({ unit: 'day', count: 7 });
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setError(''); try { await fn(); onChanged(ok); } catch (x) { setError(message(x)); } };
  return (
    <li className="card">
      <div className="split"><h3>{s.title}</h3><span className={`badge status-${s.status}`}>{STATUS[s.status]}</span></div>
      <p className="muted small">{s.restaurantCount} 家店 · 创建于 {fmtTime(s.createdAt)} · {s.expiresAt ? `${s.status === 'expired' ? '已于' : '将于'} ${fmtTime(s.expiresAt)} 到期` : '永久'}</p>
      {error && <Notice tone="error">{error}</Notice>}
      {s.status !== 'revoked' && (<>
        <Field label="分享链接"><input ref={input} readOnly value={linkOf(s.token)} onFocus={e => e.target.select()} /></Field>
        <div className="row">
          <Button variant="soft" onClick={async () => onChanged(await copy(linkOf(s.token), input.current))}><Copy size={16} aria-hidden />复制</Button>
          <a className="btn btn-ghost" href={`/s/${s.token}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} aria-hidden />打开</a>
          <Button variant="ghost" onClick={() => run(() => api(`/shares/${s.id}`, { method: 'PUT', json: {} }), '已按当前记录更新分享内容，有效期不变')}><RefreshCw size={16} aria-hidden />更新内容</Button>
          <Button variant="ghost" onClick={() => setRenewing(!renewing)} aria-expanded={renewing}>续期</Button>
          <Button variant="danger" onClick={() => { if (confirm(`撤销「${s.title}」？撤销后链接立即失效，且不能恢复。`)) void run(() => api(`/shares/${s.id}`, { method: 'DELETE' }), '已撤销分享'); }}>撤销</Button>
        </div>
        {renewing && (
          <div className="inset">
            <PeriodPicker label="从现在起延长" value={period} onChange={setPeriod} />
            <Button variant="soft" onClick={() => run(() => api(`/shares/${s.id}/renew`, { method: 'POST', json: { period } }), '已续期')}>确认续期</Button>
          </div>
        )}
      </>)}
    </li>
  );
}

export function Shares() {
  const shares = useLoad(() => api<ShareView[]>('/shares'), []);
  const restaurants = useLoad(() => api<Restaurant[]>('/restaurants'), []);
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [showPeople, setShowPeople] = useState(false);
  const [period, setPeriod] = useState<Period>({ unit: 'day', count: 7 });
  const [preview, setPreview] = useState<PublicSnapshot | null>(null);
  const [created, setCreated] = useState<ShareView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const createdInput = useRef<HTMLInputElement>(null);
  const selection = { title: title.trim(), restaurants: picked, showPeople };
  const valid = !!title.trim() && picked.length > 0;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (x) { setError(message(x)); } finally { setBusy(false); } };

  return (
    <>
      <PageHead title="分享管理" back="/me" sub="分享的是发布时的快照，私人修改不会自动公开" />
      {notice && <Notice tone="ok">{notice}</Notice>}
      <section className="card" aria-labelledby="new-share">
        <h2 className="card-title" id="new-share">新建分享</h2>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="分享标题"><input maxLength={80} value={title} onChange={e => { setTitle(e.target.value); setPreview(null); }} placeholder="例如：周末清淡好店" /></Field>
        <Group label="选择店铺">
          {!restaurants.data ? <LoadState error={restaurants.error} onRetry={restaurants.reload} />
            : restaurants.data.length === 0 ? <p className="muted small">还没有店铺可以分享。</p>
            : <div className="chips">{restaurants.data.map(r => <Chip key={r.id} on={picked.includes(r.id)} onClick={() => { setPicked(picked.includes(r.id) ? picked.filter(x => x !== r.id) : [...picked, r.id]); setPreview(null); }}>{r.name}</Chip>)}</div>}
          <span className="field-hint">默认只带上被评为喜欢/想再吃的菜和对应评价，不包含私人备注、金额和就餐记录。</span>
        </Group>
        <label className="check"><input type="checkbox" checked={showPeople} onChange={e => { setShowPeople(e.target.checked); setPreview(null); }} />显示评价人的名字</label>
        <PeriodPicker label="有效期" value={period} onChange={setPeriod} />
        <div className="row form-actions">
          <Button variant="ghost" disabled={!valid || busy} onClick={() => run(async () => setPreview(await api<PublicSnapshot>('/shares/preview', { method: 'POST', json: selection })))}>预览</Button>
          <Button disabled={!valid || busy} onClick={() => run(async () => {
            const s = await api<ShareView>('/shares', { method: 'POST', json: { ...selection, period } });
            setCreated(s); setPreview(null); setTitle(''); setPicked([]); shares.reload();
          })}>{busy ? '处理中…' : '生成分享'}</Button>
        </div>
        {created && (
          <Notice tone="ok">
            已生成「{created.title}」。
            <Field label="新分享链接"><input ref={createdInput} readOnly value={linkOf(created.token)} onFocus={e => e.target.select()} /></Field>
            <Button variant="soft" onClick={async () => setNotice(await copy(linkOf(created.token), createdInput.current))}><Copy size={16} aria-hidden />复制链接</Button>
          </Notice>
        )}
      </section>
      {preview && (
        <section className="preview" aria-labelledby="preview-title">
          <h2 className="section-title" id="preview-title">访客将看到：{preview.title}</h2>
          <SnapshotView data={preview} photoSrc={photoSrc} />
        </section>
      )}
      <section className="section" aria-labelledby="share-list">
        <h2 className="section-title" id="share-list">已创建的分享</h2>
        {!shares.data ? <LoadState error={shares.error} onRetry={shares.reload} />
          : !shares.data.length ? <p className="muted small">还没有分享。</p>
          : <ul className="list">{shares.data.map(s => <ShareItem key={s.id} s={s} onChanged={text => { setNotice(text); shares.reload(); }} />)}</ul>}
      </section>
    </>
  );
}
