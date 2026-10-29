import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { aggregateDishCandidates, type DishReference } from '../shared/dishReferences.js';

test('只选店即可自动找链接和地图候选，真实菜单OCR校对后融合保存', async ({ page, browser }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.getByLabel('用户名').fill('e2e_owner'); await page.getByLabel('密码').fill('e2e-password-123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天吃什么' })).toBeVisible();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '记录' }).click();
  await page.getByLabel('店铺', { exact: true }).fill('自动搜索小馆');
  await page.getByRole('button', { name: '新建「自动搜索小馆」' }).click();
  await page.getByLabel('店铺地址（堂食必填）').fill('小馆路100号');
  const groups: DishReference[] = [
    { id: 'ctrip', brand: '自动搜索小馆', names: ['清蒸鱼'], origin: { publisher: '携程旅行', title: '小馆特色菜', url: 'https://you.ctrip.com/food/test1/100.html', publishedAt: null, checkedAt: '2026-10-29', scope: 'branch', coverage: 'partial', restaurantName: '自动搜索小馆', address: '小馆路100号' } },
    { id: 'amap', brand: '自动搜索小馆', names: ['清蒸鱼', '蒜蓉生蚝'], origin: { publisher: '高德地图', title: '地图特色菜', url: 'https://www.amap.com/place/B01234', publishedAt: null, checkedAt: '2026-10-29', scope: 'branch', coverage: 'partial', restaurantName: '自动搜索小馆', address: '小馆路100号' } }
  ];
  let searches = 0;
  await page.route('**/api/dish-candidates', async route => {
    const input = route.request().postDataJSON();
    if (input.discover) searches++;
    if (!searches) { await route.continue(); return; }
    await route.fulfill({ json: { data: { name: input.name, restaurantId: input.restaurantId, sourceUrl: groups[0].origin.url, candidates: aggregateDishCandidates(groups), sources: [{ channel: 'search', status: 'ready', message: '自动找到携程餐厅详情', count: 1 }, { channel: 'amap', status: 'ready', message: '高德地图特色菜已匹配', count: 2 }] } } });
  });
  await expect(page.getByLabel('携程公开餐厅链接')).toHaveValue('');
  await page.getByRole('button', { name: '自动搜索菜品' }).click();
  await expect(page.getByRole('button', { name: '选择参考菜品 清蒸鱼' })).toBeVisible();
  await expect(page.getByLabel('携程公开餐厅链接')).toHaveValue(groups[0].origin.url!);
  await page.getByRole('button', { name: '选择参考菜品 清蒸鱼' }).click();
  await page.getByLabel('我对清蒸鱼的一句话').fill('识别前的评价保留');
  const image = readFileSync(new URL('../tests/fixtures/menu-ocr.png', import.meta.url));
  const result = page.waitForResponse(r => r.url().endsWith('/api/menu-ocr') && r.request().method() === 'POST');
  await page.getByLabel('菜单图片', { exact: true }).setInputFiles({ name: '菜单.png', mimeType: 'image/png', buffer: image });
  const ocr = (await (await result).json()).data;
  expect(ocr.text.replace(/\s/g, '')).toContain('清蒸鱼');
  await expect(page.getByLabel('校对菜名（每行一道）')).toBeVisible();
  await expect(page.getByRole('button', { name: '选择参考菜品 海胆生煎包' })).toHaveCount(0);
  await page.getByLabel('校对菜名（每行一道）').fill('清蒸鱼\n海胆生煎包');
  await page.getByRole('button', { name: '确认校对并加入候选' }).click();
  await expect(page.getByRole('region', { name: '菜品 清蒸鱼', exact: true })).toHaveCount(1);
  await expect(page.getByLabel('我对清蒸鱼的一句话')).toHaveValue('识别前的评价保留');
  await expect(page.getByRole('button', { name: '选择参考菜品 海胆生煎包' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('group', { name: '我对海胆生煎包的感受' })).toHaveCount(0);
  await page.getByRole('button', { name: '选择参考菜品 海胆生煎包' }).click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/automatic-menu-${width}.png`, fullPage: true });
  }
  const context = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, isMobile: false });
  const desktop = await context.newPage();
  desktop.on('pageerror', e => errors.push(e.message));
  await desktop.route('**/api/dish-candidates', route => { const input = route.request().postDataJSON(); return route.fulfill({ json: { data: { name: input.name, restaurantId: input.restaurantId, sourceUrl: groups[0].origin.url, candidates: aggregateDishCandidates(groups), sources: [] } } }); });
  await desktop.goto('/record');
  await expect(desktop.getByRole('heading', { name: '识别菜单照片' })).toBeVisible();
  await desktop.screenshot({ path: 'test-results/automatic-menu-desktop.png', fullPage: true });
  expect(await desktop.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await context.close();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/meals') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '保存这一顿', exact: true }).click();
  const meal = (await (await saved).json()).data;
  await expect(page.getByRole('heading', { name: '自动搜索小馆', exact: true })).toBeVisible();
  const dishes = (await (await page.request.get(`/api/dishes?restaurantId=${meal.restaurantId}`)).json()).data;
  expect(dishes).toHaveLength(2);
  const fish = dishes.find((d: { name: string }) => d.name === '清蒸鱼');
  expect(fish.origin.evidence).toHaveLength(3);
  expect(fish.origin.evidence.some((o: { photoId: string }) => o.photoId === ocr.photoId)).toBe(true);
  expect(searches).toBe(1); expect(errors).toEqual([]);
});
