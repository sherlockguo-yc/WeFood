import { test, expect } from '@playwright/test';

// 视觉自查：仅在设置 WEFOOD_SCREENSHOTS=1 时运行，截图输出到 test-results/screens。
test.skip(!process.env.WEFOOD_SCREENSHOTS, '仅用于人工视觉检查');

test('生成手机界面截图', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('用户名').fill('e2e_owner');
  await page.getByLabel('密码').fill('e2e-password-123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '今天吃什么' })).toBeVisible();
  await page.getByRole('group', { name: '口味' }).getByRole('button', { name: '清淡' }).click();
  await expect(page.getByRole('list', { name: '推荐结果' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/1-discover.png', fullPage: true });
  await page.getByRole('list', { name: '推荐结果' }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { level: 1, name: '测试小馆' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/2-restaurant.png', fullPage: true });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '记录' }).click();
  await page.getByLabel('店铺', { exact: true }).fill('测试');
  await page.getByRole('button', { name: /^测试小馆/ }).click();
  await page.getByRole('button', { name: '清蒸鱼' }).click();
  await page.screenshot({ path: 'test-results/screens/3-record.png', fullPage: true });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '我的' }).click();
  await expect(page.getByRole('heading', { name: '回顾' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/4-me.png', fullPage: true });
});
