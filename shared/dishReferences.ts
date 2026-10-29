import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const originSchema = z.object({
  publisher: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  url: z.string().url().max(2000).refine(value => value.startsWith('https://'), '来源链接必须使用 HTTPS').optional(),
  photoId: z.string().uuid().optional(),
  publishedAt: day.nullable(),
  checkedAt: day,
  scope: z.enum(['brand', 'branch']),
  coverage: z.literal('partial'),
  restaurantName: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  rawName: z.string().max(120).optional()
});
const validOrigin = originSchema.refine(o => !!o.url !== !!o.photoId, '来源必须为公开HTTPS链接或私人菜单附件之一');
export const dishOriginSchema = originSchema.extend({ evidence: z.array(validOrigin).max(12).optional() }).refine(o => !!o.url !== !!o.photoId, '来源必须为公开HTTPS链接或私人菜单附件之一');
export type DishOrigin = z.infer<typeof dishOriginSchema>;
export type DishReference = { id: string; brand: string; origin: DishOrigin; names: string[] };
export type DishCandidate = { id: string; name: string; origins: DishOrigin[] };
export type CandidateSource = { channel: 'wechat' | 'ctrip' | 'search' | 'amap' | 'ocr'; status: 'ready' | 'idle' | 'empty' | 'failed' | 'stale' | 'pending'; message: string; count: number; origin?: DishOrigin };
export type SourcePlace = { name: string; address: string; url: string };
export type DishCandidateResult = { name: string; restaurantId: string; candidates: DishCandidate[]; sources: CandidateSource[]; sourceUrl: string; pending?: SourcePlace; choices?: SourcePlace[] };
export const normalizeDishName = (name: string) => name.normalize('NFKC').replace(/\s+/g, '').trim();
export function aggregateDishCandidates(groups: DishReference[]): DishCandidate[] {
  const items = new Map<string, DishCandidate>();
  for (const group of [...groups].sort((a, b) => Number(b.origin.scope === 'branch') - Number(a.origin.scope === 'branch'))) {
    for (const rawName of group.names) {
      const name = rawName.normalize('NFKC').trim().replace(/\s+/g, ' '), key = normalizeDishName(name);
      if (!key) continue;
      const item = items.get(key) ?? { id: key, name, origins: [] };
      if (!item.origins.some(o => o.url === group.origin.url && o.photoId === group.origin.photoId)) item.origins.push({ ...group.origin, rawName });
      items.set(key, item);
    }
  }
  return [...items.values()];
}

const fishingBoat: DishReference = {
  id: '79-fishing-boat-summer-2025',
  brand: '79号渔船',
  origin: {
    publisher: '79号渔船微信公众号',
    title: '暑假第一顿海鲜大餐，就来79号渔船！',
    url: 'https://mp.weixin.qq.com/s?__biz=Mzg4Nzc3MDkzOQ==&mid=2247505497&idx=1&sn=b18970af0a82ce91bf6ac87eb8d82c19',
    publishedAt: '2025-07-14', checkedAt: '2026-10-28', scope: 'brand', coverage: 'partial'
  },
  names: [
    '海贝煲汁青石斑',
    '豉油皇焗台山大九节虾',
    '百香果蒸鲍鱼',
    '蒜蓉开边蒸台山大对虾',
    '鸡油斩件蒸深海野游大黄鱼',
    '伊面干焗波龙王',
    '三叔烤罗虾',
    '蒜蓉粉丝蒸元贝',
    '姜葱炒生态大青肉蟹',
    '避风塘炒石岩蟹',
    '铁板啫北海灯照鲜鱿',
    '盐焗花螺',
    '海胆生煎包'
  ]
};

export function getDishReferences(name: string): DishReference[] {
  const normalized = name.replace(/\s/g, '').replace(/號/g, '号').replace(/漁/g, '渔');
  if (!/^79号渔船(?:$|[（(·]|海鲜|海鮮|餐厅|餐廳)/.test(normalized)) return [];
  return [structuredClone(fishingBoat)];
}
