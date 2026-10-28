import type { Feeling } from '../api.js';

export type DishRating = { feeling: Feeling | null; again: boolean | null; note: string };
export type DishRater = { id: string; name: string; rating: DishRating };
const FEELINGS: [Feeling, string][] = [['like', '好吃'], ['neutral', '一般'], ['dislike', '不好吃']];

export function DishRatingRow({ name, selected, disabled = false, raters, selectLabel = name, onToggle, onRate }: {
  name: string; selected: boolean; disabled?: boolean; raters: DishRater[]; selectLabel?: string;
  onToggle: () => void; onRate: (personId: string, patch: Partial<DishRating>) => void;
}) {
  const evaluated = raters.some(p => p.rating.feeling !== null);
  return <section className={`dish-rating${selected ? ' is-selected' : ''}`} aria-label={`菜品 ${name}`}>
    <div className="dish-rating-head">
      <h3>{name}</h3>
      <button type="button" className="dish-eaten" aria-label={selectLabel} aria-pressed={selected} disabled={disabled} onClick={onToggle}>
        {selected ? '取消吃过' : '吃过，暂不评价'}
      </button>
    </div>
    <p className="dish-rating-status">{evaluated ? '已评价' : selected ? '已选 · 未评价' : '未选 · 未评价'}</p>
    {raters.length === 0 && <p className="muted small">选择同行人物后即可评价。</p>}
    {raters.map(p => {
      const who = `${p.name}对${name}`, r = p.rating;
      return <div className="dish-person-rating" key={p.id} role="group" aria-label={`${who}的感受`}>
        <span className="rate-who">{p.name}</span>
        <div className="dish-three-ratings">
          {FEELINGS.map(([value, label]) => <button key={value} type="button" className={`feel feel-${value}${r.feeling === value ? ' is-on' : ''}`}
            aria-pressed={r.feeling === value} disabled={disabled} onClick={() => onRate(p.id, { feeling: r.feeling === value ? null : value })}>{label}</button>)}
        </div>
        {selected && <div className="dish-rating-extra">
          <div className="feeling">
            <button type="button" className={`feel feel-again${r.again === true ? ' is-on' : ''}`} aria-pressed={r.again === true} disabled={disabled} onClick={() => onRate(p.id, { again: r.again === true ? null : true })}>想再吃</button>
            <button type="button" className={`feel feel-never${r.again === false ? ' is-on' : ''}`} aria-pressed={r.again === false} disabled={disabled} onClick={() => onRate(p.id, { again: r.again === false ? null : false })}>不再点</button>
          </div>
          <input className="rate-note" aria-label={`${who}的一句话`} placeholder="一句话，可不填" maxLength={2000} disabled={disabled} value={r.note} onChange={e => onRate(p.id, { note: e.target.value })} />
        </div>}
      </div>;
    })}
  </section>;
}
