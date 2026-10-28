export type Period = { unit: 'day' | 'month' | 'forever'; count: number };

const BEIJING_OFFSET = 8 * 3600_000;

/** 按北京时间计算分享到期时间；月份按日历月增加，月末溢出取目标月最后一天。 */
export function expiryFrom(period: Period, now = new Date()): string | null {
  if (period.unit === 'forever') return null;
  if (period.unit === 'day') return new Date(now.getTime() + period.count * 86400_000).toISOString();
  const local = new Date(now.getTime() + BEIJING_OFFSET);
  const months = local.getUTCMonth() + period.count;
  const year = local.getUTCFullYear() + Math.floor(months / 12);
  const month = months % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(local.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()) - BEIJING_OFFSET).toISOString();
}
