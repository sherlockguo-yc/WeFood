import { Router } from 'express';
import type { FoodDB } from './database.js';
import { fail } from './errors.js';
import { createStore, list, str, type Rec } from './library.js';

export const DEFAULT_TAGS: Record<string, string[]> = {
  口味: ['清淡', '重口', '辣', '不辣', '酸甜', '油重'],
  场景: ['适合聚餐', '约会', '快手简餐', '深夜', '适合外卖']
};

const score = (o: Rec) => (o.feeling === 'like' ? 2 : o.feeling === 'dislike' ? -3 : 0) + (o.again === true ? 2 : o.again === false ? -3 : 0);
const positive = (o: Rec) => o.feeling === 'like' || o.again === true;
const negative = (o: Rec) => o.feeling === 'dislike' || o.again === false;
const beijingMonth = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 7);

export function insightsRouter(db: FoodDB) {
  const s = createStore(db);
  const router = Router();

  router.get('/tag-options', (req, res) => {
    const owner = req.identity!.id;
    const known = new Set(Object.values(DEFAULT_TAGS).flat());
    const custom = new Set<string>();
    for (const t of s.all('tags', owner)) if (!known.has(t.name)) custom.add(t.name);
    for (const r of [...s.all('restaurants', owner), ...s.all('dishes', owner)]) for (const t of (r.tags ?? []) as string[]) if (!known.has(t)) custom.add(t);
    res.json({ data: [...Object.entries(DEFAULT_TAGS).map(([category, names]) => ({ category, names })), { category: '我的标签', names: [...custom].sort((a, b) => a.localeCompare(b, 'zh-CN')) }] });
  });

  router.get('/discover', (req, res) => {
    const owner = req.identity!.id;
    const mode = ['dine-in', 'takeaway'].includes(str(req.query.mode)) ? str(req.query.mode) : '';
    const tags = list(req.query.tags), selected = list(req.query.people);
    const budgetText = str(req.query.budget).trim();
    const budget = budgetText ? Number(budgetText) : null;
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) fail(400, 'VALIDATION', '预算需要是非负数字');
    const people = s.all('people', owner);
    const name = (pid: string) => people.find(p => p.id === pid)?.name ?? '某人';
    const restaurants = s.all('restaurants', owner).filter(r => !r.archived);
    const dishes = s.all('dishes', owner).filter(d => !d.archived);
    const meals = s.all('meals', owner), opinions = s.all('opinions', owner);
    const results = [];

    for (const r of restaurants) {
      const rd = dishes.filter(d => d.restaurantId === r.id), rm = meals.filter(m => m.restaurantId === r.id), ro = opinions.filter(o => o.restaurantId === r.id);
      const reasons: string[] = [], warnings: string[] = [];
      if (mode && !rm.some(m => m.mode === mode)) continue;
      if (mode) reasons.push(mode === 'takeaway' ? '点过这家的外卖' : '去店里吃过');
      let matches = true;
      for (const tag of tags) {
        if ((r.tags ?? []).includes(tag)) { reasons.push(`店铺标签「${tag}」`); continue; }
        const d = rd.find(x => (x.tags ?? []).includes(tag));
        if (!d) { matches = false; break; }
        reasons.push(`「${tag}」可点：${d.name}`);
      }
      if (!matches) continue;
      if (budget !== null) {
        if (typeof r.budget !== 'number' || r.budget > budget) continue;
        reasons.push(`人均约 ${r.budget} 元`);
      }

      const judges = selected.length ? selected : [...new Set(ro.map(o => o.personId as string))];
      const relevant = ro.filter(o => judges.includes(o.personId));
      let total = 0;
      const fans: string[] = [], unrated: string[] = [];
      for (const pid of judges) {
        const mine = relevant.filter(o => o.personId === pid);
        if (!mine.length) { unrated.push(name(pid)); continue; }
        const v = mine.reduce((sum, o) => sum + score(o) * (o.dishId ? 0.5 : 1), 0);
        total += v;
        if (mine.some(positive)) fans.push(name(pid));
      }
      if (fans.length) reasons.unshift(fans.length > 1 ? `${fans.join('、')}都给过好评` : `${fans[0]}给过好评`);
      if (unrated.length) warnings.push(`${unrated.join('、')}尚未评价`);

      const mustOrder = rd.filter(d => relevant.some(o => o.dishId === d.id && positive(o)) && !relevant.some(o => o.dishId === d.id && negative(o))).map(d => d.name as string).slice(0, 4);
      const avoid = rd.flatMap(d => {
        const bad = relevant.filter(o => o.dishId === d.id && negative(o));
        return bad.length ? [`${[...new Set(bad.map(o => name(o.personId)))].join('、')}不喜欢 ${d.name}`] : [];
      }).slice(0, 3);
      const last = rm.reduce<number | null>((acc, m) => { const t = Date.parse(m.date); return acc === null || t > acc ? t : acc; }, null);
      if (last !== null) {
        const days = Math.floor((Date.now() - last) / 86400_000);
        if (days <= 3) { total -= 2; warnings.push('最近 3 天刚吃过'); }
        else if (days >= 30 && total > 0) { total += Math.min(days / 30, 3); reasons.push(`已经 ${Math.floor(days / 30)} 个多月没去了`); }
      }
      results.push({ restaurant: r, score: Math.round(total * 10) / 10, reasons, warnings, mustOrder, avoid, lastVisit: last === null ? null : new Date(last).toISOString(), rated: relevant.length > 0 });
    }
    results.sort((a, b) => Number(b.rated) - Number(a.rated) || b.score - a.score || String(a.restaurant.name).localeCompare(String(b.restaurant.name), 'zh-CN'));
    res.json({ data: { results, libraryEmpty: restaurants.length === 0 } });
  });

  router.get('/stats', (req, res) => {
    const owner = req.identity!.id;
    const meals = s.all('meals', owner), restaurants = s.all('restaurants', owner), opinions = s.all('opinions', owner);
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 15));
      return d.toISOString().slice(0, 7);
    });
    const monthly = months.map(m => ({ month: m, count: meals.filter(x => beijingMonth(x.date) === m).length }));
    const visits = new Map<string, number>();
    for (const m of meals) visits.set(m.restaurantId, (visits.get(m.restaurantId) ?? 0) + 1);
    const topRestaurants = [...visits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([rid, count]) => ({ id: rid, name: restaurants.find(r => r.id === rid)?.name ?? '已删除的店铺', count }));
    const withAmount = meals.filter(m => typeof m.amount === 'number');
    const mealsWithOpinion = new Set(opinions.map(o => o.mealId).filter(Boolean));
    const dates = meals.map(m => m.date as string).sort();
    res.json({
      data: {
        totalMeals: meals.length,
        monthly,
        modes: { dineIn: meals.filter(m => m.mode === 'dine-in').length, takeaway: meals.filter(m => m.mode === 'takeaway').length },
        topRestaurants,
        againDishes: new Set(opinions.filter(o => o.dishId && positive(o)).map(o => o.dishId)).size,
        unratedMeals: meals.filter(m => !mealsWithOpinion.has(m.id)).length,
        amount: { total: withAmount.reduce((sum, m) => sum + m.amount, 0), withAmount: withAmount.length, missing: meals.length - withAmount.length },
        range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null
      }
    });
  });

  router.get('/export', (req, res) => {
    const owner = req.identity!.id;
    const shares = (db.prepare('SELECT id,title,created_at createdAt,expires_at expiresAt,revoked FROM shares WHERE owner_id=?').all(owner));
    const payload = {
      format: 'wefood-export', version: 1, exportedAt: new Date().toISOString(), username: req.identity!.username,
      people: s.all('people', owner), restaurants: s.all('restaurants', owner), dishes: s.all('dishes', owner),
      meals: s.all('meals', owner), opinions: s.all('opinions', owner), tags: s.all('tags', owner), shares,
      note: '照片文件不包含在导出中；完整备份请按 README 备份 data 目录。'
    };
    res.set('Content-Disposition', `attachment; filename="wefood-${new Date().toISOString().slice(0, 10)}.json"`);
    res.type('application/json').send(JSON.stringify(payload, null, 2));
  });

  return router;
}
