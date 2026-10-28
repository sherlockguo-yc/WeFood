import { useEffect, useMemo, useRef, useState } from 'react';
import type { FoodLocation } from '../../../shared/geo.js';
import { api, message } from '../api.js';
import { Button, Field, Notice, useLoad } from './Ui.js';
import { FoodMap, type MapConfig } from './FoodMap.js';

type Place = { name: string; address: string; category: string; location: FoodLocation };
export type PlaceValue = { address: string; location: FoodLocation | null; name?: string };

export function PlacePicker({ address, location, required = false, keyword = '', onChange }: { address: string; location?: FoodLocation | null; required?: boolean; keyword?: string; onChange: (v: PlaceValue) => void }) {
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState('');
  const [search, setSearch] = useState(keyword);
  const [rows, setRows] = useState<Place[]>([]);
  const [page, setPage] = useState(0), [more, setMore] = useState(false), [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [candidate, setCandidate] = useState<Place | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(location ?? null);
  const request = useRef(0);
  const lastQuery = useRef({ keyword: '', region: '' });
  useEffect(() => () => { request.current++; }, []);
  const config = useLoad(() => open ? api<MapConfig>('/maps/config') : Promise.resolve(null), [open]);
  const points = useMemo(() => {
    if (candidate) return [{ id: 'candidate', ...candidate.location }];
    if (rows.length) return rows.map((r, i) => ({ id: String(i), ...r.location }));
    return location ? [{ id: 'saved', ...location }] : [];
  }, [candidate, rows, location]);

  async function query(nextPage = 1) {
    if (!region.trim() || !search.trim()) { setError('请填写城市/区域和店名'); return; }
    if (nextPage === 1) lastQuery.current = { keyword: search.trim(), region: region.trim() };
    const ticket = ++request.current; setBusy(true); setError(''); setCandidate(null);
    try {
      const r = await api<{ places: Place[]; hasMore: boolean }>('/maps/search', { method: 'POST', json: { ...lastQuery.current, page: nextPage } });
      if (ticket !== request.current) return;
      setRows(nextPage === 1 ? r.places : x => [...x, ...r.places]); setPage(nextPage); setMore(r.hasMore); setSearched(true);
    } catch (e) { if (ticket === request.current) setError(message(e)); } finally { if (ticket === request.current) setBusy(false); }
  }
  async function pick(p: { lat: number; lng: number }) {
    const ticket = ++request.current; setBusy(true); setError('');
    const manual: Place = { name: '', address: '', category: '手动标记', location: { ...p, crs: 'GCJ-02', source: 'manual' } };
    setCandidate(manual); setCenter(p);
    try {
      const r = await api<{ address: string }>('/maps/reverse', { method: 'POST', json: p });
      if (ticket === request.current) setCandidate({ ...manual, address: r.address });
    } catch (e) { if (ticket === request.current) setError(`${message(e)}，位置已保留，请手填店铺地址。`); } finally { if (ticket === request.current) setBusy(false); }
  }
  function adopt(p: Place) {
    onChange({ address: p.address.trim(), location: p.location, ...(p.name ? { name: p.name } : {}) });
    request.current++; setBusy(false); setOpen(false); setError(''); setCandidate(null);
  }
  function cancel() { request.current++; setOpen(false); setBusy(false); setCandidate(null); setError(''); }
  function choose(p: Place) { request.current++; setBusy(false); setError(''); setCandidate(p); setCenter(p.location); }

  return <div className="place-picker">
    <Field label={required ? '店铺地址（堂食必填）' : '店铺地址'} hint="选择正确分店，或手动填写；不要填写私人收货地址">
      <input required={required} maxLength={300} value={address} placeholder="例如：广州市天河区体育西路 100 号"
        onChange={e => onChange({ address: e.target.value, location: null })} />
    </Field>
    {location ? <p className="muted small">已标记地图位置（{location.source === 'tencent' ? '腾讯地点' : '手动标点'}）<Button variant="ghost" onClick={() => onChange({ address, location: null })}>移除位置</Button></p>
      : <p className="muted small">尚未标记地图位置；只有文字地址的店不会生成虚假坐标。</p>}
    <Button variant="soft" onClick={() => { setSearch(keyword); setOpen(!open); }} aria-expanded={open}>从真实地图选店 / 标记位置</Button>
    {open && <section className="place-panel" aria-label="店铺位置选择">
      <div className="split"><h3>选择店铺位置</h3><Button variant="ghost" onClick={cancel}>取消选址</Button></div>
      {config.data && !config.data.searchEnabled && <Notice tone="warn">尚未配置腾讯 WebService Key，无法搜索店铺或解析地址；可以手填地址。</Notice>}
      {config.error && <Notice tone="error" action={<Button variant="soft" onClick={config.reload}>重试</Button>}>{config.error}</Notice>}
      <Field label="城市或区域"><input value={region} maxLength={80} onChange={e => setRegion(e.target.value)} placeholder="例如：广州、广州天河区" /></Field>
      <div className="inline-add">
        <input aria-label="地图搜索店名" value={search} maxLength={96} onChange={e => setSearch(e.target.value)} placeholder="输入店名，点击搜索"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void query(); } }} />
        <Button variant="soft" disabled={busy || !config.data?.searchEnabled} onClick={() => void query()}>{busy ? '查询中…' : '搜索店铺'}</Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <FoodMap points={points} center={center} onPick={p => void pick(p)} onSelect={id => { const row = rows[Number(id)]; if (row) choose(row); }} onNear={setCenter} />
      {candidate && <div className="card candidate" aria-label="待确认位置">
        <strong>{candidate.name || '手动选中的位置'}</strong>
        <Field label="候选店铺地址"><input value={candidate.address} maxLength={300} onChange={e => choose({ ...candidate, address: e.target.value })} /></Field>
        <p className="muted small">{candidate.location.lat.toFixed(6)}, {candidate.location.lng.toFixed(6)} · GCJ-02</p>
        <Button disabled={busy || !candidate.address.trim()} onClick={() => adopt(candidate)}>使用这个位置</Button>
      </div>}
      {rows.length > 0 && <ul className="list poi-list" aria-label="地图候选店铺">{rows.map((p, i) => <li key={`${p.location.providerId}-${i}`}>
        <div><strong>{p.name}</strong><p className="small">{p.address || '地址缺失，请选点后补充'}</p><p className="muted small">{p.category}</p></div>
        <Button variant="soft" onClick={() => choose(p)}>选这家</Button>
      </li>)}</ul>}
      {searched && !rows.length && !busy && <p className="muted small">没有找到，换个区域/关键词，或手动标点。</p>}
      {more && <Button variant="soft" disabled={busy} onClick={() => void query(page + 1)}>更多地点</Button>}
      <p className="muted small">地图只提供地点资料，不代表营业状态、菜单或好不好吃已核实。</p>
    </section>}
  </div>;
}
