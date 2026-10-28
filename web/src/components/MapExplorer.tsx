import { useMemo, useState } from 'react';
import { api, message, newKey, type Restaurant } from '../api.js';
import { navigate } from '../router.js';
import { Button, Link, Notice, useLoad } from './Ui.js';
import { FoodMap, type MapConfig } from './FoodMap.js';
import { PlaceSearch, PlaceResults, usePlaces } from './usePlaces.js';
import type { MapPoint } from '../../../shared/geo.js';

export function MapExplorer({ points, onSelect, onRefresh }: { points: MapPoint[]; onSelect: (id: string) => void; onRefresh: () => void }) {
  const places = usePlaces();
  const config = useLoad(() => api<MapConfig>('/maps/config'), []);
  const library = useLoad(() => api<Restaurant[]>('/restaurants?archived=include&limit=1000'), []);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [saveKeys] = useState(() => new Map<string, string>());
  const { candidate } = places;
  const found = candidate?.location.providerId ? library.data?.find(r => r.location?.source === 'tencent' && r.location.providerId === candidate.location.providerId) : undefined;
  const candidates = useMemo(() => candidate ? [{ id: 'candidate', ...candidate.location }]
    : places.rows.map((p, i) => ({ id: `poi:${i}`, ...p.location })), [candidate, places.rows]);
  const searchMode = !!(candidate || places.rows.length);

  async function save(record = false) {
    if (!candidate || !candidate.address.trim() || !candidate.name.trim()) return;
    setSaving(true); setError('');
    try {
      let restaurant = found;
      if (!restaurant) {
        const id = candidate.location.providerId || `${candidate.name}:${candidate.location.lat}:${candidate.location.lng}`;
        if (!saveKeys.has(id)) saveKeys.set(id, newKey());
        restaurant = await api<Restaurant>('/restaurants', { method: 'POST', key: saveKeys.get(id), json: { name: candidate.name, address: candidate.address, location: candidate.location } });
      }
      if (restaurant.archived) { navigate(`/restaurants/${restaurant.id}`); return; }
      if (record) navigate(`/record?restaurant=${restaurant.id}`);
      else { library.reload(); onRefresh(); setNotice('已加入记忆库，没有自动添加就餐经历或口味评价'); }
    } catch (e) { setError(message(e)); } finally { setSaving(false); }
  }

  return <>
    {config.error && <Notice tone="error" action={<Button variant="soft" onClick={config.reload}>重试</Button>}>{config.error}</Notice>}
    {config.data && <PlaceSearch places={places} enabled={config.data.searchEnabled} mapCenter={mapCenter} />}
    <p className="muted small">{searchMode ? '蓝色标记是地图候选，不是自己的推荐' : '橙色标记是自己的食记'}。点底图店名查看，或搜索店铺名称。</p>
    <FoodMap points={searchMode ? candidates : points} center={places.center} variant={searchMode ? 'candidate' : 'private'} onCenter={setMapCenter} onNear={places.setCenter}
      onPoi={p => { setNotice(''); setError(''); onSelect(''); void places.poi(p); }}
      onSelect={id => { if (searchMode) { const p = places.rows[Number(id.slice(4))]; if (p) places.choose(p); } else onSelect(id); }} />
    {searchMode && <Button variant="ghost" onClick={() => { places.clear(true); library.reload(); onRefresh(); }}>回到自己的店铺</Button>}
    {notice && <Notice tone="ok">{notice}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {candidate && <section className="card map-result" aria-label="地图店铺卡片">
      <h2>{candidate.name}</h2><p className="small">{candidate.address || '地址缺失，请到记录页手动补充'}</p><p className="muted small">{candidate.category}</p>
      {found ? <>
        <p className="muted small">{found.archived ? '这家店已归档，可打开后恢复' : '已在你的记忆库里，不会重复添加'}</p>
        <div className="row"><Link to={`/restaurants/${found.id}`} className="btn btn-soft">查看已有食记</Link>
          {!found.archived && <Button disabled={saving} onClick={() => void save(true)}>用这家店记录</Button>}
        </div>
      </> : <div className="row"><Button variant="soft" disabled={saving || !candidate.address.trim()} onClick={() => void save()}>加入记忆库</Button><Button disabled={saving || !candidate.address.trim()} onClick={() => void save(true)}>用这家店记录</Button></div>}
      <p className="muted small">地图仅提供地点资料，评价由你们自己记录；选中不会自动保存。</p>
    </section>}
    <PlaceResults places={places} />
  </>;
}
