import { useMemo, useState } from 'react';
import type { FoodLocation } from '../../../shared/geo.js';
import { api } from '../api.js';
import { Button, Field, Notice, useLoad } from './Ui.js';
import { FoodMap, type MapConfig } from './FoodMap.js';
import { PlaceSearch, PlaceResults, usePlaces } from './usePlaces.js';

export type PlaceValue = { address: string; location: FoodLocation | null; name?: string };

export function PlacePicker({ address, location, required = false, keyword = '', onChange }: { address: string; location?: FoodLocation | null; required?: boolean; keyword?: string; onChange: (v: PlaceValue) => void }) {
  const [open, setOpen] = useState(false);
  const places = usePlaces();
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(location ?? null);
  const config = useLoad(() => open ? api<MapConfig>('/maps/config') : Promise.resolve(null), [open]);
  const { candidate } = places;
  const points = useMemo(() => {
    if (candidate) return [{ id: 'candidate', ...candidate.location }];
    if (places.rows.length) return places.rows.map((r, i) => ({ id: String(i), ...r.location }));
    return location ? [{ id: 'saved', ...location }] : [];
  }, [candidate, places.rows, location]);
  function cancel() { places.clear(); setOpen(false); }

  return <div className="place-picker">
    <Field label={required ? '店铺地址（堂食必填）' : '店铺地址'} hint="选择正确分店，或手动填写；不要填写私人收货地址">
      <input required={required} maxLength={300} value={address} placeholder="例如：广州市天河区体育西路 100 号"
        onChange={e => onChange({ address: e.target.value, location: null })} />
    </Field>
    {location ? <p className="muted small">已标记地图位置（{location.source === 'tencent' ? '腾讯地点' : '手动标点'}）<Button variant="ghost" onClick={() => onChange({ address, location: null })}>移除位置</Button></p>
      : <p className="muted small">尚未标记地图位置；只有文字地址的店不会生成虚假坐标。</p>}
    <Button variant="soft" onClick={() => { if (open) cancel(); else setOpen(true); }} aria-expanded={open}>从真实地图选店 / 标记位置</Button>
    {open && <section className="place-panel" aria-label="店铺位置选择">
      <div className="split"><h3>选择店铺位置</h3><Button variant="ghost" onClick={cancel}>取消选址</Button></div>
      {config.error && <Notice tone="error" action={<Button variant="soft" onClick={config.reload}>重试</Button>}>{config.error}</Notice>}
      {config.data && <PlaceSearch places={places} enabled={config.data.searchEnabled} keyword={keyword} mapCenter={mapCenter} />}
      <FoodMap points={points} center={places.center ?? location} variant="candidate" onPick={p => void places.pick(p)} onPoi={p => void places.poi(p)} onCenter={setMapCenter}
        onSelect={id => { const row = places.rows[Number(id)]; if (row) places.choose(row); }} onNear={places.setCenter} />
      {candidate && <section className="card candidate" aria-label="待确认位置">
        <strong>{candidate.name || '手动选中的位置'}</strong>
        <Field label="候选店铺地址"><input value={candidate.address} maxLength={300} onChange={e => places.choose({ ...candidate, address: e.target.value })} /></Field>
        <p className="muted small">{candidate.location.lat.toFixed(6)}, {candidate.location.lng.toFixed(6)} · GCJ-02</p>
        <Button disabled={places.busy || !candidate.address.trim()} onClick={() => {
          onChange({ address: candidate.address.trim(), location: candidate.location, ...(candidate.name ? { name: candidate.name } : {}) }); cancel();
        }}>使用这个位置</Button>
      </section>}
      <PlaceResults places={places} />
      <p className="muted small">点击底图店名可选真实地点，空白处用于手动标点。地点资料不代表营业、菜单或好不好吃已核实。</p>
    </section>}
  </div>;
}
