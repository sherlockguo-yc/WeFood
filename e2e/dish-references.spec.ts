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
  await expect(reference.getByRole('group', { name: /的感受$/ })).toHaveCount(13);
  await expect(reference.getByText(/资料发布于 2025-07-14/)).toBeVisible();
  await expect(reference.getByText('不是完整菜单；点好吃、一般或不好吃会同时选中这道菜，保存后才进入本次记录。')).toBeVisible();
  const fish = reference.getByRole('button', { name: '选择参考菜品 海贝煲汁青石斑' });
  await expect(fish).toHaveAttribute('aria-pressed', 'false');
  const fishRating = reference.getByRole('group', { name: '我对海贝煲汁青石斑的感受' });
  await fishRating.getByRole('button', { name: '好吃', exact: true }).click();
  await expect(fish).toHaveAttribute('aria-pressed', 'true');
  await expect(fishRating.getByRole('button', { name: '好吃', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: '我对海贝煲汁青石斑的感受' })).toHaveCount(1);
  const shrimp = reference.getByRole('button', { name: '选择参考菜品 豉油皇焗台山大九节虾' });
  const shrimpRating = reference.getByRole('group', { name: '我对豉油皇焗台山大九节虾的感受' });
  await shrimpRating.getByRole('button', { name: '不好吃', exact: true }).click();
  await shrimp.click();
  await expect(shrimpRating.getByRole('button', { name: '不好吃', exact: true })).toHaveAttribute('aria-pressed', 'false');
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
