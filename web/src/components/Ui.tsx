import { cloneElement, useEffect, useId, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Camera, ChevronLeft, Heart, Meh, ThumbsDown, X } from 'lucide-react';
import { api, message, type Feeling, type TagGroup } from '../api.js';
import { navigate } from '../router.js';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, error: undefined }));
    fn().then(data => { if (alive) setState({ data, loading: false }); }).catch(e => { if (alive) setState(s => ({ ...s, loading: false, error: message(e) })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick(t => t + 1) };
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'ghost' | 'danger' };
export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: BtnProps) {
  return <button type={type} className={`btn btn-${variant} ${className}`.trim()} {...rest} />;
}

export function Link({ to, className, children, label, current }: { to: string; className?: string; children: ReactNode; label?: string; current?: boolean }) {
  return (
    <a href={to} className={className} aria-label={label} aria-current={current ? 'page' : undefined}
      onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(to); }}>
      {children}
    </a>
  );
}

export function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return <button type="button" className={`chip${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={label} onClick={onClick}>{children}</button>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement<{ id?: string; 'aria-describedby'?: string }> }) {
  const id = useId();
  const controlId = children.props.id ?? id;
  return <div className="field"><label className="field-label" htmlFor={controlId}>{label}</label>
    {cloneElement(children, { id: controlId, 'aria-describedby': hint ? `${id}-hint` : children.props['aria-describedby'] })}
    {hint && <span id={`${id}-hint`} className="field-hint">{hint}</span>}</div>;
}

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field" role="group" aria-label={label}><span className="field-label">{label}</span>{children}</div>;
}

export function Notice({ tone = 'info', children, action }: { tone?: 'info' | 'error' | 'ok' | 'warn'; children: ReactNode; action?: ReactNode }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><div>{children}</div>{action}</div>;
}

export function PageHead({ title, sub, back, action }: { title: string; sub?: ReactNode; back?: string; action?: ReactNode }) {
  return (
    <header className="page-head">
      {back && <Link to={back} className="back" label="返回"><ChevronLeft size={24} aria-hidden /></Link>}
      <div className="page-title"><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {action}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><p className="empty-title">{title}</p>{children}</div>;
}

export function LoadState({ error, onRetry }: { error?: string; onRetry: () => void }) {
  if (error) return <Notice tone="error" action={<Button variant="soft" onClick={onRetry}>重试</Button>}>{error}</Notice>;
  return <p className="muted loading">正在加载…</p>;
}

const FEELINGS: { v: Feeling; label: string; Icon: typeof Heart }[] = [
  { v: 'like', label: '喜欢', Icon: Heart },
  { v: 'neutral', label: '一般', Icon: Meh },
  { v: 'dislike', label: '不合口味', Icon: ThumbsDown }
];

export function FeelingPicker({ name, feeling, again, onChange }: { name: string; feeling: Feeling | null; again: boolean | null; onChange: (v: { feeling: Feeling | null; again: boolean | null }) => void }) {
  return (
    <div className="feeling" role="group" aria-label={`${name}的感受`}>
      {FEELINGS.map(({ v, label, Icon }) => (
        <button key={v} type="button" className={`feel feel-${v}${feeling === v ? ' is-on' : ''}`} aria-pressed={feeling === v}
          onClick={() => onChange({ feeling: feeling === v ? null : v, again })}>
          <Icon size={16} aria-hidden />{label}
        </button>
      ))}
      <button type="button" className={`feel feel-again${again === true ? ' is-on' : ''}`} aria-pressed={again === true} onClick={() => onChange({ feeling, again: again === true ? null : true })}>想再吃</button>
      <button type="button" className={`feel feel-never${again === false ? ' is-on' : ''}`} aria-pressed={again === false} onClick={() => onChange({ feeling, again: again === false ? null : false })}>不再点</button>
    </div>
  );
}

export const feelingText = (feeling: Feeling | null, again: boolean | null) =>
  [feeling === 'like' ? '喜欢' : feeling === 'neutral' ? '一般' : feeling === 'dislike' ? '不合口味' : '', again === true ? '想再吃' : again === false ? '不再点' : '']
    .filter(Boolean).join(' · ') || '未评价';

export const isPositive = (o: { feeling: Feeling | null; again: boolean | null }) => o.feeling === 'like' || o.again === true;
export const isNegative = (o: { feeling: Feeling | null; again: boolean | null }) => o.feeling === 'dislike' || o.again === false;

export const photoSrc = (id: string) => `/api/photos/${encodeURIComponent(id)}`;

export function PhotoStrip({ ids, src = photoSrc, onRemove }: { ids: string[]; src?: (id: string) => string; onRemove?: (id: string) => void }) {
  if (!ids.length) return null;
  return (
    <div className="photos">
      {ids.map((id, i) => (
        <figure key={id} className="photo">
          <img src={src(id)} alt={`照片 ${i + 1}`} loading="lazy" />
          {onRemove && <button type="button" className="photo-x" aria-label={`移除照片 ${i + 1}`} onClick={() => onRemove(id)}><X size={16} aria-hidden /></button>}
        </figure>
      ))}
    </div>
  );
}

export function PhotoInput({ onAdd }: { onAdd: (ids: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="photo-input">
      <label className={`btn btn-soft${busy ? ' is-busy' : ''}`}>
        <Camera size={18} aria-hidden />{busy ? '照片上传中…' : '添加照片'}
        <input className="visually-hidden" type="file" accept="image/*" multiple disabled={busy}
          onChange={async e => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (!files.length) return;
            if (files.length > 8) { setError('一次最多上传 8 张，已只上传前 8 张'); }
            else setError('');
            setBusy(true);
            try {
              const form = new FormData();
              files.slice(0, 8).forEach(f => form.append('photos', f));
              const saved = await api<{ id: string }[]>('/photos', { method: 'POST', body: form });
              onAdd(saved.map(s => s.id));
            } catch (x) { setError(message(x)); } finally { setBusy(false); }
          }} />
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}

export function TagInput({ value, onChange, groups, label }: { value: string[]; onChange: (v: string[]) => void; groups: TagGroup[]; label: string }) {
  const [text, setText] = useState('');
  const known = new Set(groups.flatMap(g => g.names));
  const extra = value.filter(v => !known.has(v));
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter(x => x !== t) : [...value, t]);
  const add = () => { const t = text.trim(); if (t && !value.includes(t)) onChange([...value, t]); setText(''); };
  return (
    <div className="tag-input" role="group" aria-label={label}>
      {groups.map(g => g.names.length ? (
        <div key={g.category} className="tag-group"><span className="tag-cat">{g.category}</span><div className="chips">{g.names.map(n => <Chip key={n} on={value.includes(n)} onClick={() => toggle(n)}>{n}</Chip>)}</div></div>
      ) : null)}
      {extra.length > 0 && <div className="tag-group"><span className="tag-cat">新增</span><div className="chips">{extra.map(n => <Chip key={n} on onClick={() => toggle(n)}>{n}</Chip>)}</div></div>}
      <div className="inline-add">
        <input aria-label={`${label}：自定义`} placeholder="自定义标签，如：下雨想吃" value={text} maxLength={40}
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button variant="soft" onClick={add} disabled={!text.trim()}>加标签</Button>
      </div>
    </div>
  );
}

const BJ = 'Asia/Shanghai';
export const fmtDay = (v: string | number) => new Intl.DateTimeFormat('zh-CN', { timeZone: BJ, year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(v));
export const fmtTime = (v: string | number) => new Intl.DateTimeFormat('zh-CN', { timeZone: BJ, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(v));
export const yuan = (cents: number) => `¥${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
