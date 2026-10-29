import type { ReactNode } from 'react';
import type { DishReference, DishOrigin } from '../../../shared/dishReferences.js';
import { Button, Notice } from './Ui.js';

export function DishReferences({ groups, error, loading, disabled, onRetry, renderDish }: {
  groups: DishReference[]; error?: string; loading: boolean; disabled: boolean; onRetry: () => void;
  renderDish: (name: string, origin: DishOrigin) => ReactNode;
}) {
  if (error) return <Notice tone="error" action={<Button variant="soft" onClick={onRetry}>重试参考菜品</Button>}>参考菜品暂不可用；已记录菜品和手动填写仍可使用。</Notice>;
  if (loading || !groups.length) return null;
  return <section aria-label="公开菜品参考" className="card inset">
    <h3 className="sub-title">公开菜品参考</h3>
    <p className="small">不是完整菜单；先选吃过的菜，再按人评价，也可以不评价。保存后才进入本次记录。</p>
    {groups.map(group => <div key={group.id}>
      <p className="small"><strong>{group.brand}</strong> · {group.names.length} 道品牌发布菜品</p>
      <p className="field-hint">品牌级参考，具体分店与当日供应未核实。资料发布于 {group.origin.publishedAt}，核查于 {group.origin.checkedAt}，可能已经调整。</p>
      <p className="small"><a href={group.origin.url} target="_blank" rel="noopener noreferrer">查看来源：{group.origin.publisher}</a></p>
      <div className="dish-rating-list">{group.names.map(name => renderDish(name, group.origin))}</div>
      {disabled && <p className="muted small">等已记录菜品加载成功后可评价参考，避免重复添加。</p>}
    </div>)}
  </section>;
}
