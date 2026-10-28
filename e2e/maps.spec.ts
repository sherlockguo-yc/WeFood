import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('用户名').fill('e2e_owner');
  await page.getByLabel('密码').fill('e2e-password-123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天吃什么' })).toBeVisible();
}
const nav = (p: Page, name: string) => p.getByRole('navigation', { name: '主导航' }).getByRole('link', { name });

async function mockSDK(page: Page) {
  await page.addInitScript(() => {
    type Callback = (e: { latLng?: { lat: number; lng: number }; geometry?: { id: string }; poi?: { name: string; latLng: { lat: number; lng: number } } }) => void;
    class LatLng { constructor(public lat: number, public lng: number) {} }
    class MapMock {
      handlers: Record<string, Callback> = {};
      zoom = 15;
      constructor(public element: HTMLElement) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '测试地图落点';
        button.onclick = () => this.handlers.click?.({ latLng: { lat: 23.132, lng: 113.322 } }); element.append(button);
        const poi = document.createElement('button'); poi.type = 'button'; poi.textContent = '测试底图店名';
        poi.onclick = () => this.handlers.click?.({ latLng: { lat: 23.15, lng: 113.35 }, poi: { name: '底图好店', latLng: { lat: 23.13, lng: 113.32 } } }); element.append(poi);
      }
      on(e: string, fn: Callback) { this.handlers[e] = fn; }
      setCenter() {}
      setZoom(z: number) { this.zoom = z; this.handlers.zoom?.({}); }
      getZoom() { return this.zoom; }
      getCenter() { return new LatLng(23.13, 113.32); }
      fitBounds() {}
      destroy() { this.element.replaceChildren(); }
    }
    class MultiMarker {
      handlers: Record<string, Callback> = {};
      map: MapMock;
      constructor(o: { map: MapMock }) { this.map = o.map; }
      on(e: string, fn: Callback) { this.handlers[e] = fn; }
      setStyles() {}
      setStopPropagation() {}
      setGeometries(g: { id: string }[]) {
        this.map.element.querySelectorAll('[data-test-marker]').forEach(e => e.remove());
        g.forEach(p => {
          const b = document.createElement('button'); b.type = 'button'; b.dataset.testMarker = 'true'; b.textContent = '测试地图标记';
          b.onclick = () => this.handlers.click?.({ geometry: { id: p.id } }); this.map.element.append(b);
        });
      }
      setMap() { this.map.element.querySelectorAll('[data-test-marker]').forEach(e => e.remove()); }
    }
    class Bounds { extend() {} }
    class MarkerStyle {}
    Object.assign(window, { TMap: { Map: MapMock, LatLng, MultiMarker, LatLngBounds: Bounds, MarkerStyle } });
  });
  await page.route('**/api/maps/config', route => route.fulfill({ json: { data: { jsKey: 'sdk-test-only', searchEnabled: true, provider: 'tencent' } } }));
}

test('无 Key 时选址降级、取消保留输入，同名分店可新建', async ({ page }) => {
  await login(page); await nav(page, '记录').click();
  await page.getByLabel('店铺', { exact: true }).fill('测试小馆');
  await expect(page.getByRole('button', { name: '新建「测试小馆」' })).toBeVisible();
  await page.getByRole('button', { name: '新建「测试小馆」' }).click();
  await page.getByLabel('店铺地址（堂食必填）').fill('另一分店的地址');
  await page.getByLabel('备注', { exact: true }).fill('选址取消也保留这句话');
  await page.getByRole('button', { name: '从真实地图选店 / 标记位置' }).click();
  await expect(page.getByText('尚未配置腾讯地图 JS Key', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '取消选址' }).click();
  await expect(page.getByLabel('店铺地址（堂食必填）')).toHaveValue('另一分店的地址');
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('选址取消也保留这句话');
  await nav(page, '吃什么').click();
  await page.getByRole('group', { name: '查看方式' }).getByRole('button', { name: '地图', exact: true }).click();
  await expect(page.getByRole('heading', { name: '待标记的店铺' })).toBeVisible();
});

test('模拟腾讯契约：POI回填、保存位置、地图标记联动；不冒充真实供应商验证', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await mockSDK(page);
  await page.route('**/api/maps/search', route => route.fulfill({ json: { data: { places: [{ name: '地图选中的店', address: '天河路 10 号', category: '餐饮', location: { lat: 23.13, lng: 113.32, crs: 'GCJ-02', source: 'tencent', providerId: 'test-poi-1' } }], hasMore: false } } }));
  await page.route('**/api/maps/reverse', route => route.fulfill({ json: { data: { address: '天河路 11 号' } } }));
  await login(page); await nav(page, '记录').click();
  const discard = page.getByRole('button', { name: '丢弃草稿' }); if (await discard.isVisible()) await discard.click();
  await page.getByRole('button', { name: '从真实地图选店 / 标记位置' }).click();
  await page.getByLabel('城市或区域').fill('广州');
  await page.getByLabel('地图搜索店名').fill('粥铺');
  await page.getByRole('button', { name: '搜索店铺' }).click();
  await page.getByRole('button', { name: '选这家' }).click();
  await expect(page.getByLabel('候选店铺地址')).toHaveValue('天河路 10 号');
  await page.getByRole('button', { name: '使用这个位置' }).click();
  await expect(page.getByLabel('店铺地址（堂食必填）')).toHaveValue('天河路 10 号');
  await expect(page.getByText('地图选中的店', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存这一顿' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '地图选中的店' })).toBeVisible();
  await nav(page, '吃什么').click();
  await page.getByRole('group', { name: '查看方式' }).getByRole('button', { name: '地图', exact: true }).click();
  await page.getByRole('button', { name: '测试地图标记' }).click();
  await expect(page.getByRole('region', { name: '选中的店铺' }).getByRole('heading', { name: '地图选中的店' })).toBeVisible();
  await page.getByRole('link', { name: '查看店铺和点评' }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '从真实地图选店 / 标记位置' }).click();
  await page.getByRole('button', { name: '测试地图落点' }).click();
  await expect(page.getByLabel('候选店铺地址')).toHaveValue('天河路 11 号');
  await page.getByRole('button', { name: '使用这个位置' }).click();
  await page.getByRole('button', { name: '保存店铺', exact: true }).click();
  await expect(page.getByText('天河路 11 号', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '从真实地图选店 / 标记位置' }).click();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/maps/reverse', async route => { await pending; await route.fulfill({ json: { data: { address: '迟到的旧地址' } } }); });
  const started = page.waitForRequest('**/api/maps/reverse');
  await page.getByRole('button', { name: '测试地图落点' }).click();
  await started;
  await page.getByLabel('候选店铺地址').fill('我手填的新地址');
  const ended = page.waitForResponse('**/api/maps/reverse'); release(); await ended;
  await expect(page.getByLabel('候选店铺地址')).toHaveValue('我手填的新地址');
  await page.getByRole('button', { name: '使用这个位置' }).click();
  await expect(page.getByLabel('店铺地址')).toHaveValue('我手填的新地址');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/maps-mobile.png', fullPage: true });
});

test('底图店名可选，首页可搜名称，重复加入复用，记录保留旧草稿', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await mockSDK(page);
  let queries = 0, reverses = 0;
  const place = { name: '底图好店', address: '体育西路 200 号', category: '餐饮', location: { lat: 23.13, lng: 113.32, crs: 'GCJ-02', source: 'tencent', providerId: 'base-poi' } };
  await page.route('**/api/maps/search', async route => {
    const body = route.request().postDataJSON(); queries++;
    if (body.center) { expect(body.keyword).toBe('底图好店'); expect(body.center).toEqual({ lat: 23.13, lng: 113.32, crs: 'GCJ-02' }); }
    else { expect(body.keyword).toBe('底图'); expect(body.region).toBe('广州'); }
    await route.fulfill({ json: { data: { places: [place], hasMore: false } } });
  });
  await page.route('**/api/maps/reverse', async route => { reverses++; await route.fulfill({ json: { data: { address: '空白点地址' } } }); });
  await login(page);
  await nav(page, '记录').click();
  await page.getByLabel('店铺', { exact: true }).fill('草稿店');
  await page.getByRole('button', { name: '新建「草稿店」' }).click();
  await page.getByLabel('备注', { exact: true }).fill('保留旧草稿备注');
  await nav(page, '吃什么').click();
  await page.getByRole('group', { name: '查看方式' }).getByRole('button', { name: '地图', exact: true }).click();
  await page.getByRole('button', { name: '测试底图店名' }).click();
  const card = page.getByRole('region', { name: '地图店铺卡片' });
  await expect(card.getByRole('heading', { name: '底图好店' })).toBeVisible();
  expect(reverses).toBe(0);
  await card.getByRole('button', { name: '加入记忆库' }).click();
  await expect(card.getByRole('link', { name: '查看已有食记' })).toBeVisible();
  await page.getByRole('button', { name: '回到自己的店铺' }).click();
  await page.getByLabel('城市或区域').fill('广州');
  await page.getByLabel('地图搜索店名').fill('底图');
  expect(queries).toBe(1);
  await page.getByRole('button', { name: '搜索店铺' }).click();
  await page.getByRole('button', { name: '选这家' }).click();
  await expect(card.getByText('已在你的记忆库里，不会重复添加')).toBeVisible();
  await card.getByRole('button', { name: '用这家店记录' }).click();
  await expect(page.getByText('当前恢复了另一家店的草稿，没有覆盖原输入。')).toBeVisible();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('保留旧草稿备注');
  await page.getByRole('button', { name: '改用地图选中的店' }).click();
  await expect(page.getByLabel('店铺地址（堂食必填）')).toHaveValue('体育西路 200 号');
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('保留旧草稿备注');
  await page.getByRole('button', { name: '保存这一顿' }).click();
  await expect(page.getByRole('heading', { name: '底图好店', level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
  await nav(page, '吃什么').click();
  await page.getByRole('group', { name: '查看方式' }).getByRole('button', { name: '地图', exact: true }).click();
  await page.getByRole('button', { name: '测试底图店名' }).click();
  await expect(card.getByRole('heading', { name: '底图好店' })).toBeVisible();
  await page.screenshot({ path: 'test-results/poi-selected-mobile.png', fullPage: true });
});

test('私人库为空也能地图搜索；底图附近多分店需确认，不自动编造ID', async ({ page }) => {
  await mockSDK(page);
  await page.route('**/api/discover*', route => route.fulfill({ json: { data: { results: [], libraryEmpty: true } } }));
  await page.route('**/api/maps/search', route => route.fulfill({ json: { data: { places: [
    { name: '底图好店', address: '路1', category: '餐饮', location: { lat: 23.13, lng: 113.32, crs: 'GCJ-02', source: 'tencent', providerId: 'ambiguity1' } },
    { name: '底图好店', address: '路2', category: '餐饮', location: { lat: 23.1301, lng: 113.3201, crs: 'GCJ-02', source: 'tencent', providerId: 'ambiguity2' } }
  ], hasMore: false } } }));
  await login(page);
  await page.getByRole('group', { name: '查看方式' }).getByRole('button', { name: '地图', exact: true }).click();
  await expect(page.getByRole('button', { name: '搜索店铺' })).toBeVisible();
  await page.getByRole('button', { name: '测试底图店名' }).click();
  await expect(page.getByText('「底图好店」可能有多家分店，请从候选中选正确的一家')).toBeVisible();
  await expect(page.getByRole('region', { name: '地图店铺卡片' })).toHaveCount(0);
  const rows = page.getByRole('list', { name: '地图候选店铺' }).getByRole('listitem');
  await rows.nth(1).getByRole('button', { name: '选这家' }).click();
  await expect(page.getByRole('region', { name: '地图店铺卡片' }).getByText('路2', { exact: true })).toBeVisible();
});

test('搜索第一页有更多时不自动确认，改关键词失败后不残留旧分页', async ({ page }) => {
  await mockSDK(page);
  await page.route('**/api/maps/search', async route => {
    const body = route.request().postDataJSON();
    if (body.keyword === '新搜索') { await route.fulfill({ status: 400, json: { error: { code: 'SEARCH_ERROR', message: '测试查询失败' } } }); return; }
    await route.fulfill({ json: { data: { places: [{ name: '底图好店', address: '路1', category: '餐饮', location: { lat: 23.13, lng: 113.32, crs: 'GCJ-02', source: 'tencent', providerId: 'page-poi' } }], hasMore: true } } });
  });
  await login(page);
  await page.getByRole('group', { name: '查看方式' }).getByRole('button', { name: '地图', exact: true }).click();
  await page.getByRole('button', { name: '测试底图店名' }).click();
  await expect(page.getByRole('region', { name: '地图店铺卡片' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '更多地点' })).toBeVisible();
  await page.getByRole('button', { name: '更多地点' }).click();
  await page.getByLabel('城市或区域').fill('广州');
  await page.getByLabel('地图搜索店名').fill('新搜索');
  await page.getByRole('button', { name: '搜索店铺' }).click();
  await expect(page.getByText('测试查询失败')).toBeVisible();
  await expect(page.getByRole('button', { name: '更多地点' })).toHaveCount(0);
});

test('记录菜品失败可重试、换店不显示旧菜；未收录不冒充完整菜单', async ({ page }) => {
  const base = { version: 1, createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z', tags: [], photos: [], note: '' };
  const restaurants = [
    { ...base, id: 'menu-a', name: '已有菜品的店', address: '路1', link: '', budget: null },
    { ...base, id: 'menu-b', name: '尚未录菜的店', address: '路2', link: '', budget: null }
  ];
  const dish = { ...base, id: 'dish-a', name: '测试清蒸鱼', restaurantId: 'menu-a', variant: '' };
  await page.route('**/api/restaurants?archived=include', route => route.fulfill({ json: { data: restaurants } }));
  let calls = 0, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dishes?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('restaurantId') === 'menu-a') {
      calls++;
      if (calls === 1) { await route.fulfill({ status: 400, json: { error: { code: 'TEST_ERROR', message: '测试菜品查询失败' } } }); return; }
      await route.fulfill({ json: { data: [dish] } });
    } else { await pending; await route.fulfill({ json: { data: [] } }); }
  });
  await login(page); await nav(page, '记录').click();
  const discard = page.getByRole('button', { name: '丢弃草稿' }); if (await discard.isVisible()) await discard.click();
  await page.getByLabel('店铺', { exact: true }).fill('已有菜品的店');
  await page.getByRole('button', { name: '已有菜品的店 路1', exact: true }).click();
  await page.getByLabel('备注', { exact: true }).fill('菜品重试也保留的备注');
  await expect(page.getByText('测试菜品查询失败')).toBeVisible();
  await page.getByRole('button', { name: '重试加载菜品' }).click();
  await expect(page.getByRole('button', { name: '测试清蒸鱼', exact: true })).toBeVisible();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('菜品重试也保留的备注');
  await page.getByRole('button', { name: '测试清蒸鱼', exact: true }).click();
  await expect(page.getByRole('group', { name: '我对测试清蒸鱼的感受' })).toBeVisible();
  await page.getByRole('button', { name: '更换', exact: true }).click();
  await page.getByLabel('店铺', { exact: true }).fill('尚未录菜的店');
  await page.getByRole('button', { name: '尚未录菜的店 路2', exact: true }).click();
  await expect(page.getByText('正在加载这家店已记录的菜品…')).toBeVisible();
  await expect(page.getByRole('button', { name: '测试清蒸鱼', exact: true })).toHaveCount(0);
  await page.getByLabel('新菜名').fill('测试清蒸鱼');
  await expect(page.getByRole('button', { name: '添加菜品', exact: true })).toBeDisabled();
  await page.getByLabel('新菜名').press('Enter');
  await expect(page.getByRole('button', { name: '移除新菜 测试清蒸鱼' })).toHaveCount(0);
  release();
  await expect(page.getByText('尚未记录这家店的菜品')).toBeVisible();
  await expect(page.getByText('已记录菜品不是店铺完整菜单。')).toBeVisible();
  await page.screenshot({ path: 'test-results/record-dishes-empty.png', fullPage: true });
});

test('新店地图改品牌清除原参考菜和来源，不覆盖保留备注', async ({ page }) => {
  await mockSDK(page);
  await page.route('**/api/maps/search', route => route.fulfill({ json: { data: { places: [{ name: '另一个品牌测试店', address: '另一个地址', category: '餐饮', location: { lat: 23.13, lng: 113.32, crs: 'GCJ-02', source: 'tencent', providerId: 'another-brand' } }], hasMore: false } } }));
  await login(page); await nav(page, '记录').click();
  const discard = page.getByRole('button', { name: '丢弃草稿' }); if (await discard.isVisible()) await discard.click();
  await page.getByLabel('店铺', { exact: true }).fill('79号渔船');
  await page.getByRole('button', { name: '新建「79号渔船」' }).click();
  await page.getByRole('region', { name: '公开菜品参考' }).getByRole('button', { name: '选择参考菜品 海胆生煎包' }).click();
  await page.getByLabel('备注', { exact: true }).fill('换品牌保留的备注');
  await page.getByRole('button', { name: '从真实地图选店 / 标记位置' }).click();
  await page.getByLabel('城市或区域').fill('广州');
  await page.getByLabel('地图搜索店名').fill('另一个品牌测试店');
  await page.getByRole('button', { name: '搜索店铺', exact: true }).click();
  await page.getByRole('button', { name: '选这家', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '使用这个位置', exact: true }).click();
  await expect(page.getByRole('region', { name: '公开菜品参考' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '我对海胆生煎包的感受' })).toHaveCount(0);
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('换品牌保留的备注');
  await page.getByRole('button', { name: '保存这一顿' }).click();
  await expect(page.getByRole('heading', { name: '另一个品牌测试店', level: 1 })).toBeVisible();
});
