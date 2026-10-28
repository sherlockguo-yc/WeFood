import { test, expect, type Page } from '@playwright/test';

const USER = 'e2e_owner';
const PASS = 'e2e-password-123';

function watch(page: Page, allowed: RegExp[] = []) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !allowed.some(r => r.test(m.text()))) errors.push(`console: ${m.text()}`); });
  page.on('response', r => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return errors;
}
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name });
async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('私人食记：初始化、记录、选店、多设备、分享与撤销', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const errA = watch(a);

  await a.goto('/');
  await expect(a.getByRole('heading', { name: '初始化 WeFood' })).toBeVisible();
  await a.getByLabel('用户名').fill(USER);
  await a.getByLabel('密码').fill(PASS);
  await a.getByLabel('初始化令牌').fill('e2e-setup-token-0001');
  await a.getByRole('button', { name: '创建账号' }).click();
  await expect(a.getByRole('heading', { name: '今天吃什么' })).toBeVisible();
  await expect(a.getByText('记忆库还是空的')).toBeVisible();

  await nav(a, '记录').click();
  await expect(a.getByRole('heading', { name: '记一顿' })).toBeVisible();
  await a.getByLabel('新同行人').fill('女朋友');
  await a.getByRole('button', { name: '添加', exact: true }).click();
  await expect(a.getByRole('button', { name: '女朋友' })).toHaveAttribute('aria-pressed', 'true');
  await a.getByLabel('店铺', { exact: true }).fill('测试小馆');
  await a.getByRole('button', { name: '新建「测试小馆」' }).click();
  await a.getByRole('group', { name: '店铺标签' }).getByRole('button', { name: '清淡' }).click();
  await a.getByLabel('新菜名').fill('清蒸鱼');
  await a.getByRole('button', { name: '添加菜品' }).click();
  await a.getByLabel('新菜名').fill('凉拌木耳');
  await a.getByRole('button', { name: '添加菜品' }).click();
  await a.getByRole('group', { name: '我对清蒸鱼的感受' }).getByRole('button', { name: '喜欢' }).click();
  await a.getByRole('group', { name: '女朋友对清蒸鱼的感受' }).getByRole('button', { name: '想再吃' }).click();
  await a.getByRole('group', { name: '女朋友对凉拌木耳的感受' }).getByRole('button', { name: '不合口味' }).click();
  await a.getByLabel('我对清蒸鱼的一句话').fill('鲜嫩，不腥');
  await a.getByLabel('花费（元）').fill('128.5');
  await noHorizontalOverflow(a);
  await a.getByRole('button', { name: '保存这一顿' }).click();

  await expect(a.getByRole('heading', { name: '测试小馆', level: 1 })).toBeVisible();
  const good = a.getByRole('region', { name: '值得点' });
  await expect(good.getByText('清蒸鱼')).toBeVisible();
  await expect(good.getByText('需要避开')).toBeVisible();
  await expect(good.getByText('女朋友：不合口味')).toBeVisible();
  await expect(good.getByText('凉拌木耳')).toBeVisible();
  await expect(a.getByText('¥128.50')).toBeVisible();

  await nav(a, '吃什么').click();
  await a.getByRole('group', { name: '口味' }).getByRole('button', { name: '清淡' }).click();
  const result = a.getByRole('list', { name: '推荐结果' }).getByRole('link').first();
  await expect(result).toContainText('测试小馆');
  await expect(result).toContainText('必点清蒸鱼');
  await expect(result).toContainText('女朋友不喜欢 凉拌木耳');
  await a.getByRole('group', { name: '口味' }).getByRole('button', { name: '辣', exact: true }).click();
  await expect(a.getByText('没有符合这些条件的店')).toBeVisible();

  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  const errB = watch(b);
  await b.goto('/');
  await expect(b.getByRole('heading', { name: '登录 WeFood' })).toBeVisible();
  await b.getByLabel('用户名').fill(USER);
  await b.getByLabel('密码').fill(PASS);
  await b.getByRole('button', { name: '登录' }).click();
  await nav(b, '记忆库').click();
  await expect(b.getByRole('link', { name: /测试小馆/ })).toBeVisible();

  await nav(a, '我的').click();
  await expect(a.getByText('这台设备', { exact: true })).toBeVisible();
  await expect(a.getByRole('region', { name: '账号与设备' }).getByText('最近使用')).toHaveCount(2);
  await a.getByRole('button', { name: '退出这台设备' }).click();
  await expect(a.getByRole('heading', { name: '登录 WeFood' })).toBeVisible();

  await b.reload();
  await expect(b.getByRole('link', { name: /测试小馆/ })).toBeVisible();
  await b.setViewportSize({ width: 360, height: 740 });
  await noHorizontalOverflow(b);

  await nav(b, '我的').click();
  await b.getByRole('link', { name: '分享管理' }).click();
  await b.getByLabel('分享标题').fill('E2E 推荐');
  await b.getByRole('group', { name: '选择店铺' }).getByRole('button', { name: '测试小馆' }).click();
  await b.getByRole('button', { name: '预览' }).click();
  const preview = b.getByRole('region', { name: /访客将看到/ });
  await expect(preview.getByText('清蒸鱼')).toBeVisible();
  await expect(preview.getByText('凉拌木耳')).toHaveCount(0);
  await b.getByRole('button', { name: '生成分享' }).click();
  const link = await b.getByLabel('新分享链接').inputValue();
  expect(link).toMatch(/\/s\/[\w-]{20,}$/);

  const ctxC = await browser.newContext();
  const c = await ctxC.newPage();
  const errC = watch(c, [/status of 410/]);
  await c.goto(link);
  await expect(c.getByRole('heading', { name: 'E2E 推荐' })).toBeVisible();
  await expect(c.getByText('测试小馆')).toBeVisible();
  await expect(c.getByText('清蒸鱼')).toBeVisible();
  await expect(c.getByText('鲜嫩，不腥')).toBeVisible();
  await expect(c.getByText('凉拌木耳')).toHaveCount(0);
  await expect(c.getByText('¥128.50')).toHaveCount(0);
  await expect(c.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  await noHorizontalOverflow(c);

  b.once('dialog', d => d.accept());
  await b.getByRole('button', { name: '撤销' }).click();
  await expect(b.getByText('已撤销分享')).toBeVisible();
  await c.reload();
  await expect(c.getByText('这个分享已被撤销')).toBeVisible();
  await expect(c.getByText('清蒸鱼')).toHaveCount(0);

  expect(errA, errA.join('\n')).toEqual([]);
  expect(errB, errB.join('\n')).toEqual([]);
  expect(errC, errC.join('\n')).toEqual([]);
  await ctxA.close(); await ctxB.close(); await ctxC.close();
});

test('弱网保存失败后输入保留，重试不会重复创建', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = watch(page, [/Failed to load resource|ERR_FAILED|net::/]);
  await page.goto('/');
  await page.getByLabel('用户名').fill(USER);
  await page.getByLabel('密码').fill(PASS);
  await page.getByRole('button', { name: '登录' }).click();
  await nav(page, '记录').click();
  await page.getByLabel('店铺', { exact: true }).fill('测试小馆');
  await page.getByRole('button', { name: /^测试小馆/ }).click();
  await page.getByLabel('备注').fill('弱网时写的备注');

  let dropped = false;
  await page.route('**/api/meals', async route => {
    if (!dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: '保存这一顿' }).click();
  await expect(page.getByText('网络连接失败，已填写的内容仍保留')).toBeVisible();
  await expect(page.getByLabel('备注')).toHaveValue('弱网时写的备注');
  await page.getByRole('button', { name: '保存这一顿' }).click();
  await expect(page.getByRole('heading', { name: '测试小馆', level: 1 })).toBeVisible();
  await expect(page.getByText('弱网时写的备注')).toHaveCount(1);
  expect(errors, errors.join('\n')).toEqual([]);
  await ctx.close();
});
