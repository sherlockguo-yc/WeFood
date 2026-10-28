import { useEffect, useRef, useState } from 'react';
import { clusterPoints, type MapPoint } from '../../../shared/geo.js';
import { api, message } from '../api.js';
import { Button, Notice, useLoad } from './Ui.js';

export type MapConfig = { jsKey: string; searchEnabled: boolean; provider: 'tencent' };
type LatLng = { lat?: number; lng?: number; getLat?: () => number; getLng?: () => number };
type Geometry = { id: string; position: LatLng; styleId?: string };
type MapEvent = { latLng?: LatLng; geometry?: { id?: string } };
type MapInstance = { on: (event: string, fn: (e: MapEvent) => void) => void; setCenter: (p: LatLng) => void; setZoom: (z: number) => void; getZoom: () => number; fitBounds: (b: unknown, options: object) => void; destroy: () => void };
type MarkerInstance = { on: (event: string, fn: (e: MapEvent) => void) => void; setGeometries: (g: Geometry[]) => void; setStyles: (s: Record<string, unknown>) => void; setMap: (m: MapInstance | null) => void; setStopPropagation: (stop: boolean) => void };
type SDK = {
  Map: new (el: HTMLElement, options: object) => MapInstance;
  LatLng: new (lat: number, lng: number) => LatLng;
  LatLngBounds: new (sw: LatLng, ne: LatLng) => { extend: (p: LatLng) => void };
  MultiMarker: new (o: object) => MarkerInstance;
  MarkerStyle: new (o: object) => unknown;
};
declare global { interface Window { TMap?: SDK } }
let sdkLoad: Promise<SDK> | undefined;

function loadSDK(key: string): Promise<SDK> {
  if (window.TMap) return Promise.resolve(window.TMap);
  if (sdkLoad) return sdkLoad;
  sdkLoad = new Promise<SDK>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(key)}`;
    script.async = true; script.referrerPolicy = 'origin';
    const stop = () => { clearTimeout(timer); script.onload = null; script.onerror = null; };
    const timer = setTimeout(() => { stop(); script.remove(); reject(new Error('腾讯地图加载超时')); }, 15_000);
    script.onload = () => { stop(); if (window.TMap) resolve(window.TMap); else reject(new Error('腾讯地图没有成功初始化')); };
    script.onerror = () => { stop(); script.remove(); reject(new Error('腾讯地图加载失败')); };
    document.head.appendChild(script);
  }).catch(e => { sdkLoad = undefined; throw e; });
  return sdkLoad;
}

function coordinates(p?: LatLng) {
  const lat = p?.getLat ? p.getLat() : p?.lat, lng = p?.getLng ? p.getLng() : p?.lng;
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
function pin(count: number) {
  const label = count > 1 ? String(count) : '●';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="44"><path d="M20 43 L10 31 A18 18 0 1 1 30 31 Z" fill="#A8461F" stroke="#fff" stroke-width="2"/><text x="20" y="24" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function FoodMap({ points = [], center, onSelect, onPick, onNear }: { points?: MapPoint[]; center?: { lat: number; lng: number } | null; onSelect?: (id: string) => void; onPick?: (p: { lat: number; lng: number }) => void; onNear?: (p: { lat: number; lng: number }) => void }) {
  const config = useLoad(() => api<MapConfig>('/maps/config'), []);
  const element = useRef<HTMLDivElement>(null);
  const refs = useRef({ points, onSelect, onPick, onNear }); refs.current = { points, onSelect, onPick, onNear };
  const mapRef = useRef<MapInstance | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const fitRef = useRef<() => void>(() => undefined);
  const [tick, setTick] = useState(0), [error, setError] = useState(''), [ready, setReady] = useState(false), [locating, setLocating] = useState(false);
  const key = config.data?.jsKey;

  useEffect(() => {
    if (!key || !element.current) return;
    let live = true; let map: MapInstance | undefined; let markers: MarkerInstance | undefined;
    setError(''); setReady(false);
    loadSDK(key).then(T => {
      if (!live || !element.current) return;
      const p = center ?? refs.current.points[0] ?? { lat: 35, lng: 105 };
      map = new T.Map(element.current, { center: new T.LatLng(p.lat, p.lng), zoom: center || refs.current.points.length === 1 ? 15 : 5, pitch: 0, rotation: 0 });
      mapRef.current = map;
      markers = new T.MultiMarker({ map, geometries: [] });
      markers.setStopPropagation(true);
      let clusters = clusterPoints(refs.current.points, map.getZoom());
      const draw = () => {
        if (!map || !markers || !live) return;
        clusters = clusterPoints(refs.current.points, map.getZoom());
        const styles: Record<string, unknown> = {};
        for (const c of clusters) styles[String(c.members.length)] = new T.MarkerStyle({ width: 40, height: 44, anchor: { x: 20, y: 44 }, src: pin(c.members.length) });
        markers.setStyles(styles);
        markers.setGeometries(clusters.map(c => ({ id: c.id, styleId: String(c.members.length), position: new T.LatLng(c.lat, c.lng) })));
      };
      drawRef.current = draw;
      fitRef.current = () => {
        const pts = refs.current.points;
        if (!map || !pts.length) return;
        if (pts.length === 1) { map.setCenter(new T.LatLng(pts[0].lat, pts[0].lng)); map.setZoom(15); }
        else { const first = new T.LatLng(pts[0].lat, pts[0].lng); const bounds = new T.LatLngBounds(first, first); pts.forEach(x => bounds.extend(new T.LatLng(x.lat, x.lng))); map.fitBounds(bounds, { padding: 48, maxZoom: 16 }); }
      };
      map.on('zoom', draw);
      map.on('click', e => { const pos = coordinates(e.latLng); if (pos) refs.current.onPick?.(pos); });
      markers.on('click', e => {
        const c = clusters.find(c => c.id === e.geometry?.id); if (!c || !map) return;
        if (c.members.length === 1) refs.current.onSelect?.(c.members[0].id);
        else { map.setCenter(new T.LatLng(c.lat, c.lng)); map.setZoom(Math.min(map.getZoom() + 3, 20)); }
      });
      draw(); fitRef.current(); setReady(true);
    }).catch(e => { if (live) setError(message(e)); });
    return () => { live = false; markers?.setMap(null); map?.destroy(); mapRef.current = null; drawRef.current = () => undefined; fitRef.current = () => undefined; };
  }, [key, tick]);

  useEffect(() => { drawRef.current(); fitRef.current(); }, [points]);
  useEffect(() => { if (center && mapRef.current && window.TMap) { mapRef.current.setCenter(new window.TMap.LatLng(center.lat, center.lng)); mapRef.current.setZoom(15); } }, [center]);

  async function near() {
    if (!navigator.geolocation) { setError('浏览器不支持定位，请手动浏览地图'); return; }
    setLocating(true); setError('');
    try {
      const raw = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10_000, maximumAge: 60_000 }));
      const pos = await api<{ lat: number; lng: number }>('/maps/translate', { method: 'POST', json: { lat: raw.coords.latitude, lng: raw.coords.longitude } });
      if (mapRef.current && window.TMap) { mapRef.current.setCenter(new window.TMap.LatLng(pos.lat, pos.lng)); mapRef.current.setZoom(15); }
      refs.current.onNear?.(pos);
    } catch (e) { setError(e && typeof e === 'object' && 'code' in e && typeof e.code === 'number' ? '定位不可用或未获授权，可以手动浏览地图' : message(e)); } finally { setLocating(false); }
  }

  return <div className="food-map">
    {!config.data ? <Notice tone={config.error ? 'error' : 'info'}>{config.error ?? '正在读取地图配置…'}{config.error && <Button variant="soft" onClick={config.reload}>重试</Button>}</Notice>
      : !key ? <Notice tone="warn">尚未配置腾讯地图 JS Key，真实底图不可用。可以先手填店铺地址，之后再补地图标记。</Notice>
      : <>
        {!ready && !error && <p className="muted small">加载腾讯真实地图…</p>}
        {error && <Notice tone="error" action={<Button variant="soft" onClick={() => setTick(x => x + 1)}>重试地图</Button>}>{error}</Notice>}
        <div className="map-canvas" ref={element} aria-label={onPick ? '点击地图选择店铺位置' : '私人店铺地图'} />
        {ready && <div className="row map-tools"><Button variant="soft" onClick={() => fitRef.current()}>显示全部标记</Button><Button variant="ghost" disabled={locating || !config.data.searchEnabled} onClick={() => void near()}>{locating ? '正在定位…' : '我附近'}</Button></div>}
      </>}
    <p className="muted small">地图来自腾讯。搜索区域和主动授权的定位会发送给地图服务，点评、人物和照片不会发送。{onPick && '点击空白处落点；未选中的地点不会保存。'}</p>
  </div>;
}
