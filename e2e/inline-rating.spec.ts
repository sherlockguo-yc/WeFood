import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('用户名').fill('e2e_owner');
  await page.getByLabel('密码').fill('e2e-password-123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天吃什么' })).toBeVisible();
}
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name });

test('三档菜品内联评分、两人口味分开，重点评不重复入口也不丢备注', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page); await nav(page, '记录').click();
  await page.getByLabel('店铺', { exact: true }).fill('内联评分测试店');
  await page.getByRole('button', { name: '新建「内联评分测试店」' }).click();
  await page.getByLabel('店铺地址（堂食必填）').fill('测试路 10 号');
  await page.getByRole('group', { name: '同行的人', exact: true }).getByRole('button', { name: '女朋友', exact: true }).click();
  for (const name of ['清蒸鲈鱼', '油炸豆腐', '只记吃过']) {
    await page.getByLabel('新菜名').fill(name);
    await page.getByRole('button', { name: '添加菜品', exact: true }).click();
  }
  const me = page.getByRole('region', { name: '菜品 清蒸鲈鱼', exact: true }).getByRole('group', { name: '我对清蒸鲈鱼的感受', exact: true });
  const gf = page.getByRole('region', { name: '菜品 清蒸鲈鱼', exact: true }).getByRole('group', { name: '女朋友对清蒸鲈鱼的感受', exact: true });
  await me.getByRole('button', { name: '好吃', exact: true }).click();
  await me.getByRole('button', { name: '想再吃', exact: true }).click();
  await me.getByLabel('我对清蒸鲈鱼的一句话').fill('这次清淡鲜嫩');
  await gf.getByRole('button', { name: '不好吃', exact: true }).click();
  await expect(page.getByRole('group', { name: '我对清蒸鲈鱼的感受', exact: true })).toHaveCount(1);
  await me.getByRole('button', { name: '好吃', exact: true }).click();
  await expect(me.getByRole('button', { name: '好吃', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(me.getByRole('button', { name: '想再吃', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(me.getByLabel('我对清蒸鲈鱼的一句话')).toHaveValue('这次清淡鲜嫩');
  await me.getByRole('button', { name: '一般', exact: true }).click();
  await page.getByRole('group', { name: '我对油炸豆腐的感受', exact: true }).getByRole('button', { name: '好吃', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/inline-dish-ratings-320.png', fullPage: true });
  const saved = page.waitForResponse(r => r.url().endsWith('/api/meals') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '保存这一顿', exact: true }).click();
  const meal = (await (await saved).json()).data;
  const persons = (await (await page.request.get('/api/people')).json()).data as { id: string; name: string }[];
  const dishes = (await (await page.request.get(`/api/dishes?restaurantId=${meal.restaurantId}`)).json()).data as { id: string; name: string }[];
  const fishId = dishes.find(d => d.name === '清蒸鲈鱼')!.id;
  const meId = persons.find(p => p.name === '我')!.id, gfId = persons.find(p => p.name === '女朋友')!.id;
  expect(meal.opinions).toHaveLength(3);
  expect(meal.opinions.find((o: { dishId: string; personId: string }) => o.dishId === fishId && o.personId === meId)).toMatchObject({ feeling: 'neutral', again: true, note: '这次清淡鲜嫩' });
  expect(meal.opinions.find((o: { dishId: string; personId: string }) => o.dishId === fishId && o.personId === gfId)).toMatchObject({ feeling: 'dislike', again: null });
  await expect(page.getByRole('heading', { name: '内联评分测试店', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '再记一顿' }).click();
  const existing = page.getByRole('region', { name: '菜品 清蒸鲈鱼', exact: true });
  await expect(existing.getByRole('button', { name: '清蒸鲈鱼', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await existing.getByRole('group', { name: '我对清蒸鲈鱼的感受', exact: true }).getByRole('button', { name: '好吃', exact: true }).click();
  await expect(existing.getByRole('button', { name: '清蒸鲈鱼', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: '店铺整体感受', exact: true }).getByRole('group', { name: /清蒸鲈鱼/ })).toHaveCount(0);
  await page.getByRole('button', { name: '保存这一顿', exact: true }).click();
  await expect(page.getByRole('heading', { name: '内联评分测试店', level: 1 })).toBeVisible();
  expect((await (await page.request.get(`/api/dishes?restaurantId=${meal.restaurantId}`)).json()).data).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('旧格式菜品草稿在内联行恢复，响应丢失重试保留评分与来源', async ({ page }) => {
  await login(page);
  const user = (await (await page.request.get('/api/auth/me')).json()).data.user;
  await page.evaluate(({ id }) => {
    localStorage.setItem(`wefood:draft:${id}`, JSON.stringify({
      key: 'legacy-inline-test-key', restaurantId: '', newRestaurant: true, restaurantName: '旧草稿测试店', restaurantTags: [],
      restaurantAddress: '旧草稿地址', restaurantLocation: null, addressEdited: false, date: '2026-10-29T12:00', mode: 'dine-in',
      people: [], dishes: [], newDishes: ['旧草稿蒸鱼'], ratings: {}, amount: '', note: '老草稿的备注', photos: []
    }));
  }, { id: user.id });
  const me = ((await (await page.request.get('/api/people')).json()).data as { id: string; name: string }[]).find(p => p.name === '我')!;
  await page.evaluate(({ userId, personId }) => {
    const key = `wefood:draft:${userId}`, d = JSON.parse(localStorage.getItem(key)!);
    d.people = [personId]; d.ratings[`${personId}|new:旧草稿蒸鱼`] = { feeling: 'dislike', again: false, note: '旧评分不要丢' };
    localStorage.setItem(key, JSON.stringify(d));
  }, { userId: user.id, personId: me.id });
  await page.goto('/record');
  const rating = page.getByRole('region', { name: '菜品 旧草稿蒸鱼', exact: true }).getByRole('group', { name: '我对旧草稿蒸鱼的感受', exact: true });
  await expect(rating.getByRole('button', { name: '不好吃', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rating.getByRole('button', { name: '不再点', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rating.getByLabel('我对旧草稿蒸鱼的一句话')).toHaveValue('旧评分不要丢');
  let failed = false;
  await page.route('**/api/meals', async route => {
    if (!failed) { failed = true; const r = await route.fetch(); expect(r.status()).toBe(201); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: '保存这一顿', exact: true }).click();
  await expect(page.getByText('网络连接失败，已填写的内容仍保留，请稍后重试')).toBeVisible();
  const afterRating = page.getByRole('group', { name: '我对旧草稿蒸鱼的感受', exact: true });
  await expect(afterRating.getByRole('button', { name: '不好吃', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const response = page.waitForResponse(r => r.url().endsWith('/api/meals') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '保存这一顿', exact: true }).click();
  const meal = (await (await response).json()).data;
  expect(meal.opinions).toHaveLength(1);
  expect(meal.opinions[0]).toMatchObject({ feeling: 'dislike', again: false, note: '旧评分不要丢' });
  await expect(page.getByRole('heading', { name: '旧草稿测试店', level: 1 })).toBeVisible();
  const overview = (await (await page.request.get(`/api/restaurants/${meal.restaurantId}/overview`)).json()).data;
  expect(overview.meals).toHaveLength(1); expect(overview.dishes).toHaveLength(1);
});

test('旧草稿同名参考菜合并到已有ID，取消真正清空本次评价，不隐藏导入', async ({ page }) => {
  await login(page);
  const user = (await (await page.request.get('/api/auth/me')).json()).data.user;
  const person = ((await (await page.request.get('/api/people')).json()).data as { id: string; name: string }[]).find(p => p.name === '我')!;
  const referenceRestaurant = (await (await page.request.get('/api/restaurants?archived=include')).json()).data.find((r: { name: string }) => r.name === '79 号渔船（测试分店）');
  const dish = (await (await page.request.get(`/api/dishes?restaurantId=${referenceRestaurant.id}`)).json()).data[0];
  await page.evaluate(({ userId, personId, restaurantId, name }) => {
    localStorage.setItem(`wefood:draft:${userId}`, JSON.stringify({
      key: 'legacy-same-name-key', restaurantId, newRestaurant: false, restaurantName: '', restaurantTags: [],
      date: '2026-10-29T12:00', mode: 'dine-in', people: [personId], dishes: [], newDishes: [name],
      ratings: { [`${personId}|new:${name}`]: { feeling: 'dislike', again: false, note: '旧的新菜评价' } }, amount: '', note: '', photos: []
    }));
  }, { userId: user.id, personId: person.id, restaurantId: referenceRestaurant.id, name: dish.name });
  await page.goto('/record');
  const row = page.getByRole('region', { name: `菜品 ${dish.name}`, exact: true });
  const rating = row.getByRole('group', { name: `我对${dish.name}的感受`, exact: true });
  await expect(rating.getByRole('button', { name: '不好吃', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rating.getByLabel(`我对${dish.name}的一句话`)).toHaveValue('旧的新菜评价');
  await expect(page.getByRole('group', { name: `我对${dish.name}的感受`, exact: true })).toHaveCount(1);
  await row.getByRole('button', { name: `选择参考菜品 ${dish.name}`, exact: true }).click();
  await expect(rating.getByRole('button', { name: '不好吃', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const response = page.waitForResponse(r => r.url().endsWith('/api/meals') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '保存这一顿', exact: true }).click();
  const meal = (await (await response).json()).data;
  expect(meal.dishes).toEqual([]); expect(meal.opinions).toEqual([]);
  await expect(page.getByRole('heading', { name: '79 号渔船（测试分店）', level: 1 })).toBeVisible();
  expect((await (await page.request.get(`/api/dishes?restaurantId=${referenceRestaurant.id}`)).json()).data).toHaveLength(1);
});
