import { z } from 'zod';

export const coordinatesSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export const locationSchema = coordinatesSchema.extend({
  crs: z.literal('GCJ-02'), source: z.enum(['manual', 'tencent']), providerId: z.string().trim().min(1).max(200).optional()
}).refine(p => p.source !== 'tencent' || !!p.providerId, '腾讯地点需有地点 ID');
export type FoodLocation = z.infer<typeof locationSchema>;
export type Place = { name: string; address: string; category: string; location: FoodLocation };
export type MapPoi = { name: string; lat: number; lng: number };
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180, dlat = (b.lat - a.lat) * rad, dlng = (b.lng - a.lng) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export type MapPoint = { id: string; lat: number; lng: number };
export type PointCluster = { id: string; lat: number; lng: number; members: MapPoint[] };

export function clusterPoints(points: MapPoint[], zoom: number): PointCluster[] {
  const scale = 256 * 2 ** Math.min(20, Math.max(0, zoom));
  const buckets = new Map<string, MapPoint[]>();
  for (const p of points) {
    const lat = Math.min(85, Math.max(-85, p.lat)) * Math.PI / 180;
    const x = (p.lng + 180) / 360 * scale;
    const y = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * scale;
    const key = zoom >= 19 ? p.id : `${Math.floor(x / 60)}:${Math.floor(y / 60)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), p]);
  }
  return [...buckets.entries()].map(([key, members]) => ({ id: key, lat: members.reduce((s, p) => s + p.lat, 0) / members.length, lng: members.reduce((s, p) => s + p.lng, 0) / members.length, members }));
}
