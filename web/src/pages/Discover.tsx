import { useState } from 'react';
import { api, type Person, type Restaurant, type TagGroup } from '../api.js';
import { Button, Chip, Empty, Field, Link, LoadState, PageHead, fmtDay, useLoad } from '../components/Ui.js';

type Result = { restaurant: Restaurant; score: number; reasons: string[]; warnings: string[]; mustOrder: string[]; avoid: string[]; lastVisit: string | null; rated: boolean };

const MODES: [string, string][] = [['', '不限'], ['dine-in', '堂食'], ['takeaway', '外卖']];

export function Discover() {
  const people = useLoad(() => api<Person[]>('/people'), []);
  const groups = useLoad(() => api<TagGroup[]>('/tag-options'), []);
  const [mode, setMode] = useState('');
  const [who, setWho] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [budget, setBudget] = useState('');
  const qs = new URLSearchParams();
  if (mode) qs.set('mode', mode);
  if (who.length) qs.set('people', who.join(','));
  if (tags.length) qs.set('tags', tags.join(','));
  if (budget.trim()) qs.set('budget', budget.trim());
  const q = qs.toString();
  const res = useLoad(() => api<{ results: Result[]; libraryEmpty: boolean }>(`/discover${q ? `?${q}` : ''}`), [q]);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const hasFilter = !!(mode || who.length || tags.length || budget.trim());
  const clear = () => { setMode(''); setWho([]); setTags([]); setBudget(''); };

  return (
    <>
      <PageHead title="今天吃什么" sub="只从你们自己的记忆里找，推荐都有依据" />
      <section className="card filters" aria-label="筛选条件">
        <div className="filter-row" role="group" aria-label="就餐方式">
          <span className="filter-label">方式</span>
          <div className="chips">{MODES.map(([v, l]) => <Chip key={l} on={mode === v} onClick={() => setMode(v)}>{l}</Chip>)}</div>
        </div>
        {(people.data ?? []).length > 0 && (
          <div className="filter-row" role="group" aria-label="这次和谁">
            <span className="filter-label">这次和谁（按他们的口味排）</span>
            <div className="chips">{people.data!.map(p => <Chip key={p.id} on={who.includes(p.id)} onClick={() => toggle(who, setWho, p.id)}>{p.name}</Chip>)}</div>
          </div>
        )}
        {(groups.data ?? []).map(g => g.names.length ? (
          <div className="filter-row" role="group" aria-label={g.category} key={g.category}>
            <span className="filter-label">{g.category}</span>
            <div className="chips">{g.names.map(n => <Chip key={n} on={tags.includes(n)} onClick={() => toggle(tags, setTags, n)}>{n}</Chip>)}</div>
          </div>
        ) : null)}
        <Field label="人均不超过（元）"><input inputMode="numeric" value={budget} onChange={e => setBudget(e.target.value.replace(/[^\d]/g, ''))} placeholder="不限" /></Field>
        {hasFilter && <Button variant="ghost" onClick={clear}>清空条件</Button>}
      </section>

      {!res.data ? <LoadState error={res.error} onRetry={res.reload} />
        : res.data.libraryEmpty ? (
          <Empty title="记忆库还是空的">把记得的好店先记下来，下次就能在这里找到。<br /><Link to="/record" className="btn btn-primary">记第一顿</Link></Empty>
        ) : !res.data.results.length ? (
          <Empty title="没有符合这些条件的店">条件不会被偷偷放宽，可以减少几个条件再看看。<br /><Button variant="soft" onClick={clear}>清空条件</Button></Empty>
        ) : (
          <ol className="results" aria-label="推荐结果">
            {res.data.results.map(r => (
              <li key={r.restaurant.id}>
                <Link to={`/restaurants/${r.restaurant.id}`} className="card result">
                  <div className="result-top"><h2>{r.restaurant.name}</h2>{!r.rated && <span className="badge">尚未评价</span>}</div>
                  {r.restaurant.tags.length > 0 && <p className="tags-line">{r.restaurant.tags.join(' · ')}</p>}
                  {r.reasons.length > 0 && <ul className="reasons">{r.reasons.map(x => <li key={x}>{x}</li>)}</ul>}
                  {r.mustOrder.length > 0 && <p className="must"><strong>必点</strong>{r.mustOrder.join('、')}</p>}
                  {r.avoid.length > 0 && <p className="avoid"><strong>注意</strong>{r.avoid.join('；')}</p>}
                  {r.warnings.length > 0 && <p className="warn-line">{r.warnings.join('；')}</p>}
                  {r.lastVisit && <p className="muted small">上次：{fmtDay(r.lastVisit)}</p>}
                </Link>
              </li>
            ))}
          </ol>
        )}
    </>
  );
}
