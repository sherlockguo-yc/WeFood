import { useEffect, useRef, useState } from 'react';
import { api, message } from '../api.js';
import type { DishReference } from '../../../shared/dishReferences.js';
import { Button, Field, Notice } from './Ui.js';

type Result = { text: string; names: string[]; confidence: number; photoId: string; checkedAt: string };
export function MenuOcr({ name, disabled, onAdopt }: { name: string; disabled: boolean; onAdopt: (group: DishReference) => void }) {
  const [result, setResult] = useState<Result | null>(null), [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const identity = useRef(name); identity.current = name;
  async function recognize(file: File) {
    if (busy) return;
    if (file.size > 10 * 1024 * 1024) { setError('菜单图片不能超过10MB'); return; }
    const target = name; setBusy(true); setError('');
    try {
      const form = new FormData(); form.append('menu', file);
      const data = await api<Result>('/menu-ocr', { method: 'POST', body: form });
      if (alive.current && identity.current === target) { setResult(data); setText(data.names.join('\n')); }
    } catch (e) { if (alive.current && identity.current === target) setError(message(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section aria-label="菜单图片识别" className="card inset">
    <h3 className="sub-title">识别菜单照片</h3>
    <p className="small">图片只上传到自己的服务，本地识别，不发送给云OCR。菜名可能识别错，请校对后采纳；不会自动标记吃过。</p>
    <Field label="菜单图片"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={e => { const file = e.target.files?.[0]; if (file) void recognize(file); e.target.value = ''; }} /></Field>
    {busy && <p role="status">正在本地识别菜单，首次加载语言包可能较慢…</p>}
    {error && <Notice tone="error">{error}</Notice>}
    {result && <>
      <p className="small">识别置信度 {Math.round(result.confidence)}%（不代表菜名正确） · <a href={`/api/photos/${result.photoId}`} target="_blank" rel="noopener noreferrer">查看原菜单</a></p>
      <Field label="校对菜名（每行一道）"><textarea rows={6} maxLength={12000} value={text} onChange={e => setText(e.target.value)} disabled={disabled || busy} /></Field>
      <Button variant="soft" disabled={disabled || busy || !text.trim()} onClick={() => {
        const names = [...new Set(text.split('\n').map(n => n.trim()).filter(n => n && n.length <= 120))].slice(0, 100);
        if (!names.length) { setError('请填写核对后的菜名'); return; }
        onAdopt({ id: result.photoId, brand: name, names, origin: { publisher: '本人菜单照片（已校对）', title: `${name}菜单照片`, photoId: result.photoId, publishedAt: null, checkedAt: result.checkedAt, scope: 'branch', coverage: 'partial', restaurantName: name } });
        setResult(null); setText('');
      }}>确认校对并加入候选</Button>
    </>}
  </section>;
}
