import { useEffect, useRef, useState } from 'react';
import { distanceMeters, type MapPoi, type Place } from '../../../shared/geo.js';
import { api, message } from '../api.js';
import { Button, Field, Notice } from './Ui.js';

type SearchInput = { keyword: string; region?: string; center?: { lat: number; lng: number; crs: 'GCJ-02' }; radiusMeters?: number };

export function usePlaces() {
  const [rows, setRows] = useState<Place[]>([]), [candidate, setCandidate] = useState<Place | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [searched, setSearched] = useState(false);
  const [more, setMore] = useState(false), [page, setPage] = useState(0);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const request = useRef(0), lastQuery = useRef<SearchInput | null>(null);
  useEffect(() => () => { request.current++; }, []);
  function choose(p: Place) { request.current++; setBusy(false); setError(''); setCandidate(p); setCenter(p.location); }
  function clear(resetRows = false) { request.current++; setBusy(false); setCandidate(null); setError(''); if (resetRows) { setRows([]); setMore(false); setSearched(false); setCenter(null); } }

  async function search(input: SearchInput, nextPage = 1) {
    if (!input.keyword.trim() || (!input.region?.trim() && !input.center)) { setError('请填写店名和城市/区域，或选择地图中心附近'); return; }
    if (nextPage === 1) { lastQuery.current = input; setRows([]); setPage(0); setMore(false); setSearched(false); }
    const ticket = ++request.current; setBusy(true); setError(''); setCandidate(null);
    try {
      const r = await api<{ places: Place[]; hasMore: boolean }>('/maps/search', { method: 'POST', json: { ...lastQuery.current, page: nextPage } });
      if (ticket !== request.current) return;
      setRows(nextPage === 1 ? r.places : x => [...x, ...r.places]); setPage(nextPage); setMore(r.hasMore); setSearched(true);
    } catch (e) { if (ticket === request.current) setError(message(e)); }
    finally { if (ticket === request.current) setBusy(false); }
  }
  async function poi(p: MapPoi) {
    const ticket = ++request.current; setBusy(true); setError(''); setCandidate(null); setCenter(p); setRows([]); setMore(false);
    const input: SearchInput = { keyword: p.name, center: { lat: p.lat, lng: p.lng, crs: 'GCJ-02' }, radiusMeters: 1000 };
    lastQuery.current = input;
    try {
      const r = await api<{ places: Place[]; hasMore: boolean }>('/maps/search', { method: 'POST', json: { ...input, page: 1 } });
      if (ticket !== request.current) return;
      setRows(r.places); setMore(r.hasMore); setPage(1); setSearched(true);
      const matched = r.places.filter(x => x.name === p.name && distanceMeters(x.location, p) <= 150);
      if (matched.length === 1 && !r.hasMore) setCandidate(matched[0]);
      else setError(r.places.length ? `「${p.name}」可能有多家分店，请从候选中选正确的一家` : `未查询到「${p.name}」的完整资料，可换关键词搜索或手动标点`);
    } catch (e) { if (ticket === request.current) setError(message(e)); }
    finally { if (ticket === request.current) setBusy(false); }
  }
  async function pick(p: { lat: number; lng: number }) {
    const ticket = ++request.current; setBusy(true); setError('');
    const manual: Place = { name: '', address: '', category: '手动标记', location: { ...p, crs: 'GCJ-02', source: 'manual' } };
    setCandidate(manual); setCenter(p);
    try {
      const r = await api<{ address: string }>('/maps/reverse', { method: 'POST', json: p });
      if (ticket === request.current) setCandidate({ ...manual, address: r.address });
    } catch (e) { if (ticket === request.current) setError(`${message(e)}，位置已保留，请手填店铺地址。`); }
    finally { if (ticket === request.current) setBusy(false); }
  }
  return { rows, candidate, busy, error, searched, more, center, choose, clear, search, poi, pick, setCenter, loadMore: () => lastQuery.current ? search(lastQuery.current, page + 1) : Promise.resolve() };
}

export function PlaceSearch({ places, enabled, keyword = '', mapCenter }: { places: ReturnType<typeof usePlaces>; enabled: boolean; keyword?: string; mapCenter?: { lat: number; lng: number } | null }) {
  const [region, setRegion] = useState(''), [text, setText] = useState(keyword), [nearby, setNearby] = useState(false);
  const submit = () => void places.search(nearby && mapCenter ? { keyword: text.trim(), center: { ...mapCenter, crs: 'GCJ-02' }, radiusMeters: 1000 } : { keyword: text.trim(), region: region.trim() });
  return <div className="place-search" role="group" aria-label="搜索地图店铺">
    {!enabled && <Notice tone="warn">尚未配置腾讯 WebService Key，无法搜索店铺或解析地址；可以手填地址。</Notice>}
    <Field label="城市或区域"><input value={region} maxLength={80} onChange={e => setRegion(e.target.value)} placeholder="例如：广州、广州天河区" disabled={nearby} /></Field>
    <div className="inline-add">
      <input aria-label="地图搜索店名" value={text} maxLength={96} onChange={e => setText(e.target.value)} placeholder="输入店铺名"
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (enabled) submit(); } }} />
      <Button variant="soft" disabled={places.busy || !enabled} onClick={submit}>{places.busy ? '查询中…' : '搜索店铺'}</Button>
    </div>
    <label className="check"><input type="checkbox" checked={nearby} disabled={!mapCenter} onChange={e => setNearby(e.target.checked)} />搜索地图中心附近（1 公里）</label>
    {places.error && <Notice tone="error">{places.error}</Notice>}
    {places.busy && <p className="muted small" role="status">正在查询店铺资料…</p>}
  </div>;
}

export function PlaceResults({ places }: { places: ReturnType<typeof usePlaces> }) {
  return <>
    {places.rows.length > 0 && <ul className="list poi-list" aria-label="地图候选店铺">{places.rows.map((p, i) => <li key={`${p.location.providerId}-${i}`}>
      <div><strong>{p.name}</strong><p className="small">{p.address || '地址缺失，请补充'}</p><p className="muted small">{p.category}</p></div>
      <Button variant="soft" onClick={() => places.choose(p)}>选这家</Button>
    </li>)}</ul>}
    {places.searched && !places.rows.length && !places.busy && <p className="muted small">没有找到，换个区域/关键词，或手动标点。</p>}
    {places.more && <Button variant="soft" disabled={places.busy} onClick={() => void places.loadMore()}>更多地点</Button>}
  </>;
}
