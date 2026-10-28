export type Feeling = 'like' | 'neutral' | 'dislike';
export type Base = { id: string; version: number; createdAt: string; updatedAt: string };
export type UserInfo = { id: string; username: string; role: string };
export type Person = Base & { name: string; archived?: boolean };
export type Restaurant = Base & { name: string; address: string; note: string; link: string; tags: string[]; budget: number | null; archived?: boolean; photos: string[] };
export type Dish = Base & { name: string; restaurantId: string; variant: string; note: string; tags: string[]; archived?: boolean; photos: string[] };
export type Opinion = Base & { personId: string; dishId?: string; restaurantId: string; mealId?: string; feeling: Feeling | null; again: boolean | null; note: string };
export type Meal = Base & { restaurantId: string; date: string; mode: 'dine-in' | 'takeaway'; amount: number | null; note: string; people: string[]; dishes: string[]; photos: string[]; opinions: Opinion[] };
export type TagGroup = { category: string; names: string[] };
export type Period = { unit: 'day' | 'month' | 'forever'; count: number };
export type PublicOpinion = { person: string; feeling: Feeling | null; again: boolean | null; note: string };
export type PublicSnapshot = {
  title: string;
  expiresAt?: string | null;
  restaurants: { name: string; address: string; link: string; tags: string[]; photos: string[]; opinions: PublicOpinion[]; dishes: { name: string; variant: string; tags: string[]; photos: string[]; opinions: PublicOpinion[] }[] }[];
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

let csrf = '';
const unauthorized = new Set<() => void>();
export const setCsrf = (token: string) => { csrf = token; };
export const onUnauthorized = (fn: () => void) => { unauthorized.add(fn); return () => { unauthorized.delete(fn); }; };

type Init = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit; key?: string };

export async function api<T>(path: string, init: Init = {}): Promise<T> {
  const { json, key, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  const headers = new Headers(rest.headers);
  let body = rest.body;
  if (json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(json); }
  if (method !== 'GET') headers.set('X-CSRF-Token', csrf);
  if (key) headers.set('Idempotency-Key', key);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...rest, method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK', '网络连接失败，已填写的内容仍保留，请稍后重试');
  }
  const payload = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string } } | null;
  if (!res.ok) {
    if (res.status === 401 && !/^\/auth\/(login|setup|register|status)/.test(path)) unauthorized.forEach(fn => fn());
    throw new ApiError(res.status, payload?.error?.code ?? 'HTTP', payload?.error?.message ?? `请求失败（${res.status}）`);
  }
  return payload?.data as T;
}

export const message = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请重试');

/** 非 HTTPS 局域网访问时 crypto.randomUUID 不可用，统一用 getRandomValues 生成保存标识。 */
export const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
