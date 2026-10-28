import type { DishOrigin, DishReference } from '../../../shared/dishReferences.js';
import { api } from '../api.js';
import { Button, Notice, useLoad } from './Ui.js';

export function DishReferences({ restaurantName, disabled, isPicked, onToggle }: { restaurantName: string; disabled: boolean; isPicked: (name: string) => boolean; onToggle: (name: string, origin: DishOrigin) => void }) {
  const name = restaurantName.trim();
  const load = useLoad(() => api<{ name: string; groups: DishReference[] }>(`/dish-references?name=${encodeURIComponent(name)}`), [name]);
  if (!name) return null;
  if (load.error) return <Notice tone="error" action={<Button variant="soft" onClick={load.reload}>重试参考菜品</Button>}>参考菜品暂不可用；已记录菜品和手动填写仍可使用。</Notice>;
  if (load.loading || load.data?.name !== name || !load.data.groups.length) return null;
  return <section aria-label="公开菜品参考" className="card inset">
    <h3 className="sub-title">公开菜品参考</h3>
    <p className="small">不是完整菜单；只有你勾选并保存的菜才进入本次记录。</p>
    {load.data.groups.map(group => <div key={group.id}>
      <p className="small"><strong>{group.brand}</strong> · {group.names.length} 道品牌发布菜品</p>
      <p className="field-hint">品牌级参考，具体分店与当日供应未核实。资料发布于 {group.origin.publishedAt}，核查于 {group.origin.checkedAt}，可能已经调整。</p>
      <p className="small"><a href={group.origin.url} target="_blank" rel="noopener noreferrer">查看来源：{group.origin.publisher}</a></p>
      <div className="chips" role="group" aria-label="从公开参考选择吃过的菜">
        {group.names.map(dish => <button key={dish} type="button" className={`chip${isPicked(dish) ? ' is-on' : ''}`} aria-pressed={isPicked(dish)} aria-label={`选择参考菜品 ${dish}`} disabled={disabled} onClick={() => onToggle(dish, group.origin)}>{dish}</button>)}
      </div>
      {disabled && <p className="muted small">等已记录菜品加载成功后可选择参考，避免重复添加。</p>}
    </div>)}
  </section>;
}
