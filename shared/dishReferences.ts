import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const dishOriginSchema = z.object({
  publisher: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  url: z.string().url().max(2000).refine(value => value.startsWith('https://'), '来源链接必须使用 HTTPS'),
  publishedAt: day,
  checkedAt: day,
  scope: z.literal('brand'),
  coverage: z.literal('partial')
});
export type DishOrigin = z.infer<typeof dishOriginSchema>;
export type DishReference = { id: string; brand: string; origin: DishOrigin; names: string[] };

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
