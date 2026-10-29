import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('用户名').fill('e2e_owner');
  await page.getByLabel('密码').fill('e2e-password-123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天吃什么' })).toBeVisible();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '记录' }).click();
}

test('79号渔船参考可选择点评，仅保存选中菜和来源，回访复用已有菜', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page);
  await page.getByLabel('店铺', { exact: true }).fill('79 号渔船（测试分店）');
  await page.getByRole('button', { name: '新建「79 号渔船（测试分店）」' }).click();
  await page.getByLabel('店铺地址（堂食必填）').fill('测试路 79 号');
  const reference = page.getByRole('region', { name: '公开菜品参考' });
  await expect(reference.getByRole('region', { name: /^菜品 / })).toHaveCount(13);
  await expect(reference.getByRole('group', { name: /的感受$/ })).toHaveCount(0);
  await expect(reference.getByRole('button', { name: /^(好吃|一般|不好吃)$/ })).toHaveCount(0);
  await expect(reference.getByText(/资料发布于 2025-07-14/)).toBeVisible();
  await expect(reference.getByText('不是完整菜单；先选吃过的菜，再按人评价，也可以不评价。保存后才进入本次记录。')).toBeVisible();
  const fish = reference.getByRole('button', { name: '选择参考菜品 海贝煲汁青石斑' });
  await expect(fish).toHaveAttribute('aria-pressed', 'false');
  const fishRating = reference.getByRole('group', { name: '我对海贝煲汁青石斑的感受' });
  await expect(fishRating).toHaveCount(0);
  await fish.click();
  await expect(reference.getByRole('group', { name: /的感受$/ })).toHaveCount(1);
  await fishRating.getByRole('button', { name: '好吃', exact: true }).click();
  await expect(fish).toHaveAttribute('aria-pressed', 'true');
  await expect(fishRating.getByRole('button', { name: '好吃', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: '我对海贝煲汁青石斑的感受' })).toHaveCount(1);
  const shrimp = reference.getByRole('button', { name: '选择参考菜品 豉油皇焗台山大九节虾' });
  const shrimpRating = reference.getByRole('group', { name: '我对豉油皇焗台山大九节虾的感受' });
  await expect(shrimpRating).toHaveCount(0);
  await shrimp.click();
  await shrimpRating.getByRole('button', { name: '不好吃', exact: true }).click();
  await shrimp.click();
  await expect(shrimpRating).toHaveCount(0);
  await expect(shrimp).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByLabel('我对豉油皇焗台山大九节虾的一句话')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/79-dish-references.png', fullPage: true });
  const created = page.waitForResponse(r => r.url().endsWith('/api/restaurants') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '保存这一顿' }).click();
  const restaurant = (await (await created).json()).data;
  await expect(page.getByRole('heading', { level: 1, name: '79 号渔船（测试分店）' })).toBeVisible();
  const dishes = (await (await page.request.get(`/api/dishes?restaurantId=${restaurant.id}`)).json()).data;
  expect(dishes).toHaveLength(1);
  expect(dishes[0].name).toBe('海贝煲汁青石斑');
  expect(dishes[0].origin).toMatchObject({ scope: 'brand', coverage: 'partial', publishedAt: '2025-07-14' });
  const overview = (await (await page.request.get(`/api/restaurants/${restaurant.id}/overview`)).json()).data;
  expect(overview.opinions).toHaveLength(1);
  expect(overview.opinions[0].feeling).toBe('like');
  await page.getByRole('button', { name: '再记一顿' }).click();
  await page.getByRole('region', { name: '公开菜品参考' }).getByRole('button', { name: '选择参考菜品 海贝煲汁青石斑' }).click();
  await expect(page.getByRole('button', { name: '移除新菜 海贝煲汁青石斑' })).toHaveCount(0);
  await page.getByRole('button', { name: '保存这一顿' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '79 号渔船（测试分店）' })).toBeVisible();
  const after = (await (await page.request.get(`/api/dishes?restaurantId=${restaurant.id}`)).json()).data;
  expect(after).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('79号渔船参考随旧草稿恢复，换品牌不展示旧清单', async ({ page }) => {
  await login(page);
  await page.getByLabel('店铺', { exact: true }).fill('79号渔船');
  await page.getByRole('button', { name: '新建「79号渔船」' }).click();
  await page.getByRole('region', { name: '公开菜品参考' }).getByRole('button', { name: '选择参考菜品 海胆生煎包' }).click();
  await page.getByLabel('我对海胆生煎包的一句话').fill('下次还想吃');
  await page.reload();
  await expect(page.getByLabel('我对海胆生煎包的一句话')).toHaveValue('下次还想吃');
  await expect(page.getByRole('region', { name: '公开菜品参考' }).getByRole('button', { name: '选择参考菜品 海胆生煎包' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '更换', exact: true }).click();
  await page.getByLabel('店铺', { exact: true }).fill('其他店');
  await page.getByRole('button', { name: '新建「其他店」' }).click();
  await expect(page.getByRole('region', { name: '公开菜品参考' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '我对海胆生煎包的感受' })).toHaveCount(0);
});

async function seedEditableMeal(page: Page, suffix: string) {
  const auth = (await (await page.request.get('/api/auth/me')).json()).data;
  const headers = { 'X-CSRF-Token': auth.csrf, Origin: new URL(page.url()).origin };
  const post = async (resource: string, data: unknown) => {
    const response = await page.request.post(`/api/${resource}`, { headers, data });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  };
  const people = (await (await page.request.get('/api/people')).json()).data as { id: string; name: string }[];
  const me = people.find(p => p.name === '我')!;
  const gf = await post('people', { name: `女朋友（编辑${suffix}）` });
  const restaurant = await post('restaurants', { name: `79号渔船（编辑${suffix}）`, address: '编辑测试路79号' });
  const fish = await post('dishes', { name: '海贝煲汁青石斑', restaurantId: restaurant.id });
  const archived = await post('dishes', { name: '历史限定菜', restaurantId: restaurant.id });
  const other = await post('dishes', { name: '店铺其他菜', restaurantId: restaurant.id });
  const meal = await post('meals', {
    restaurantId: restaurant.id, date: '2026-10-28T04:32:45.123Z', mode: 'dine-in', amount: 12345,
    note: '原始记录备注', people: [me.id, gf.id], dishes: [fish.id, archived.id],
    opinions: [
      { personId: me.id, dishId: fish.id, feeling: 'like', again: true, note: '原来鲜嫩' },
      { personId: gf.id, dishId: fish.id, feeling: 'dislike', again: false, note: '她的评价' },
      { personId: me.id, dishId: archived.id, feeling: 'neutral', note: '历史评价' },
      { personId: me.id, feeling: 'like', again: true, note: '原店铺评价' }
    ]
  });
  expect((await page.request.delete(`/api/dishes/${archived.id}`, { headers })).ok()).toBe(true);
  expect((await page.request.delete(`/api/people/${gf.id}`, { headers })).ok()).toBe(true);
  return { auth, headers, restaurant, fish, archived, other, meal, me, gf };
}

test('编辑已有就餐可加载店铺菜与公开参考，保留历史评价并隔离新增草稿', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await login(page);
  const { auth, restaurant, fish, archived, other, meal, gf } = await seedEditableMeal(page, '回填');
  await page.getByLabel('店铺', { exact: true }).fill('另一个新增草稿店');
  await page.getByRole('button', { name: '新建「另一个新增草稿店」' }).click();
  await page.getByLabel('备注', { exact: true }).fill('新增草稿不能覆盖');
  const originalDraft = await page.evaluate(id => localStorage.getItem(`wefood:draft:${id}`), auth.user.id);
  await page.goto(`/restaurants/${restaurant.id}`);
  await page.getByRole('button', { name: '编辑这次记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '编辑这一顿', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '更换', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('花费（元）')).toHaveValue('123.45');
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue(meal.note);
  await expect(page.getByLabel('我对海贝煲汁青石斑的一句话')).toHaveValue('原来鲜嫩');
  await expect(page.getByLabel('女朋友（编辑回填）对海贝煲汁青石斑的一句话')).toHaveValue('她的评价');
  await expect(page.getByLabel('我对历史限定菜（已归档）的一句话')).toHaveValue('历史评价');
  await expect(page.getByLabel('我对这家店的一句话')).toHaveValue('原店铺评价');
  const reference = page.getByRole('region', { name: '公开菜品参考' });
  await expect(reference.getByRole('button', { name: '选择参考菜品 海贝煲汁青石斑' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: '我对海贝煲汁青石斑的感受', exact: true })).toHaveCount(1);
  const otherRow = page.getByRole('region', { name: '菜品 店铺其他菜', exact: true });
  await expect(otherRow.getByRole('group', { name: /的感受$/ })).toHaveCount(0);
  await otherRow.getByRole('button', { name: '店铺其他菜', exact: true }).click();
  await otherRow.getByRole('group', { name: '我对店铺其他菜的感受', exact: true }).getByRole('button', { name: '好吃', exact: true }).click();
  await reference.getByRole('button', { name: '选择参考菜品 海胆生煎包' }).click();
  await page.getByLabel('我对海胆生煎包的一句话').fill('补记的参考菜');
  await page.reload();
  await expect(page.getByLabel('我对海胆生煎包的一句话')).toHaveValue('补记的参考菜');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/meal-edit-${width}.png`, fullPage: true });
  }
  const response = page.waitForResponse(r => r.url().endsWith(`/api/meals/${meal.id}`) && r.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  const updated = (await (await response).json()).data;
  expect(updated.id).toBe(meal.id);
  expect(updated).toMatchObject({ date: meal.date, amount: meal.amount, note: meal.note, photos: meal.photos, people: meal.people });
  expect(updated.dishes).toEqual(expect.arrayContaining([fish.id, archived.id, other.id]));
  expect(updated.dishes).toHaveLength(4);
  expect(updated.opinions).toHaveLength(6);
  expect(updated.opinions).toEqual(expect.arrayContaining(meal.opinions.map(({ personId, dishId, feeling, again, note }: { personId: string; dishId?: string; feeling: string; again: boolean | null; note: string }) => expect.objectContaining({ personId, ...(dishId ? { dishId } : {}), feeling, again, note }))));
  expect(updated.opinions.find((o: { personId: string; dishId: string }) => o.personId === gf.id && o.dishId === fish.id).note).toBe('她的评价');
  await expect(page.getByRole('heading', { name: restaurant.name, exact: true })).toBeVisible();
  const overview = (await (await page.request.get(`/api/restaurants/${restaurant.id}/overview`)).json()).data;
  expect(overview.meals).toHaveLength(1);
  expect(overview.dishes).toHaveLength(4);
  expect(overview.dishes.find((d: { name: string }) => d.name === '海胆生煎包').origin).toMatchObject({ scope: 'brand', coverage: 'partial' });
  expect(await page.evaluate(id => localStorage.getItem(`wefood:draft:${id}`), auth.user.id)).toBe(originalDraft);
  expect(await page.evaluate(({ uid, mid }) => localStorage.getItem(`wefood:edit-draft:${uid}:${mid}`), { uid: auth.user.id, mid: meal.id })).toBeNull();
  expect(errors).toEqual([]);
});

test('编辑菜品失败可重试，旧无地址记录可维护，版本冲突不覆盖输入', async ({ page }) => {
  await login(page);
  const { auth, headers, restaurant, fish, archived, meal } = await seedEditableMeal(page, '冲突');
  expect((await page.request.put(`/api/restaurants/${restaurant.id}`, { headers, data: { address: '', version: restaurant.version } })).ok()).toBe(true);
  let failDishes = true;
  await page.route('**/api/dishes?**', route => failDishes ? route.fulfill({ status: 503, json: { error: { code: 'TEMPORARY', message: '编辑菜品暂时不可用' } } }) : route.continue());
  await page.goto(`/record?meal=${meal.id}`);
  await expect(page.getByText('编辑菜品暂时不可用')).toBeVisible();
  await page.getByLabel('备注', { exact: true }).fill('冲突也保留输入');
  await page.getByLabel('新菜名').fill('网络未恢复时的新菜');
  await expect(page.getByRole('button', { name: '添加菜品', exact: true })).toBeDisabled();
  failDishes = false;
  await page.getByRole('button', { name: '重试加载菜品' }).click();
  await expect(page.getByLabel('我对海贝煲汁青石斑的一句话')).toHaveValue('原来鲜嫩');
  await page.getByRole('button', { name: '历史限定菜（已归档）', exact: true }).click();
  const concurrent = await page.request.put(`/api/meals/${meal.id}`, { headers, data: { note: '另一设备改过', version: meal.version } });
  expect(concurrent.ok()).toBe(true);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText(/其他设备刚修改过这次就餐记录/)).toBeVisible();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('冲突也保留输入');
  await expect(page.getByText(/另一设备改过/)).toBeVisible();
  expect((await (await page.request.get(`/api/meals/${meal.id}`)).json()).data.note).toBe('另一设备改过');
  await page.reload();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('冲突也保留输入');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  const updated = (await (await page.request.get(`/api/meals/${meal.id}`)).json()).data;
  expect(updated.note).toBe('冲突也保留输入');
  expect(updated.dishes).toEqual([fish.id]);
  expect(updated.opinions.some((o: { dishId: string }) => o.dishId === archived.id)).toBe(false);
  expect(updated.opinions).toHaveLength(3);
  await expect(page.getByRole('heading', { name: restaurant.name, exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/restaurants/${restaurant.id}/overview`)).json()).data.meals).toHaveLength(1);
  expect(await page.evaluate(({ uid, mid }) => localStorage.getItem(`wefood:edit-draft:${uid}:${mid}`), { uid: auth.user.id, mid: meal.id })).toBeNull();
});

test('已有就餐记录加载失败可重试，未加载前不展示空白编辑表单', async ({ page }) => {
  await login(page);
  const { meal } = await seedEditableMeal(page, '加载');
  let failOnce = true;
  await page.route(`**/api/meals/${meal.id}`, route => {
    if (failOnce) { failOnce = false; return route.fulfill({ status: 503, json: { error: { code: 'TEMPORARY', message: '就餐记录暂时不可用' } } }); }
    return route.continue();
  });
  await page.goto(`/record?meal=${meal.id}`);
  await expect(page.getByText('就餐记录暂时不可用')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存修改' })).toHaveCount(0);
  await page.getByRole('button', { name: '重试加载记录' }).click();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue(meal.note);
});
