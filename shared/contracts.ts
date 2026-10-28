import { z } from 'zod';
import { locationSchema } from './geo.js';
export type { Period } from './period.js';

const text = (max = 200) => z.string().trim().max(max);
const ids = z.array(z.string().min(1).max(100)).max(100).default([]);
const tagList = z.array(text(40).min(1)).max(30).default([]);

export const opinionSchema = z.object({
  personId: z.string().min(1).max(100),
  dishId: z.string().min(1).max(100).optional(),
  feeling: z.enum(['like', 'neutral', 'dislike']).nullable().default(null),
  again: z.boolean().nullable().default(null),
  note: text(2000).default('')
});

export const schemas = {
  people: z.object({ name: text(60).min(1, '请填写名字'), archived: z.boolean().default(false) }),
  restaurants: z.object({
    name: text(120).min(1, '请填写店名'),
    address: text(300).default(''),
    location: locationSchema.nullable().default(null),
    note: text(4000).default(''),
    link: text(1500).refine(v => !v || /^https?:\/\/[^\s]+$/i.test(v), '链接需使用 http:// 或 https:// 开头').default(''),
    tags: tagList,
    budget: z.number().int().nonnegative().max(1000000).nullable().default(null),
    archived: z.boolean().default(false),
    photos: ids
  }),
  dishes: z.object({
    name: text(120).min(1, '请填写菜名'),
    restaurantId: z.string().min(1).max(100),
    variant: text(100).default(''),
    note: text(4000).default(''),
    tags: tagList,
    archived: z.boolean().default(false),
    photos: ids
  }),
  meals: z.object({
    restaurantId: z.string().min(1).max(100),
    date: z.string().max(40).refine(v => Number.isFinite(Date.parse(v)), '日期无效'),
    mode: z.enum(['dine-in', 'takeaway']).default('dine-in'),
    amount: z.number().int().nonnegative().max(100000000).nullable().default(null),
    note: text(4000).default(''),
    people: ids,
    dishes: ids,
    opinions: z.array(opinionSchema).max(300).default([]),
    photos: ids
  }),
  opinions: opinionSchema.extend({ restaurantId: z.string().min(1).max(100), mealId: z.string().min(1).max(100).optional() }),
  tags: z.object({ name: text(40).min(1, '请填写标签名'), category: z.enum(['口味', '场景', '自定义']).default('自定义') })
};

export type Resource = keyof typeof schemas;
export type UserInfo = { id: string; username: string; role: string };
