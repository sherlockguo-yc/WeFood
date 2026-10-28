import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api, newKey, type Dish, type Meal, type Restaurant, type TagGroup } from '../api.js';
import { navigate } from '../router.js';
import { Button, Chip, Empty, Link, LoadState, PageHead, fmtTime, photoSrc, useLoad } from '../components/Ui.js';
import { RestaurantForm } from './Restaurant.js';

type Tab = 'restaurants' | 'dishes' | 'meals';
const TABS: [Tab, string][] = [['restaurants', '店铺'], ['dishes', '菜品'], ['meals', '记录']];

export function Library({ loc }: { loc: string }) {
  const params = new URLSearchParams(loc.split('?')[1] ?? '');
  const raw = params.get('tab');
  const tab: Tab = raw === 'dishes' || raw === 'meals' ? raw : 'restaurants';
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [adding, setAdding] = useState(false);
  const [key] = useState(newKey);
  const groups = useLoad(() => api<TagGroup[]>('/tag-options'), []);
  const all = useLoad(() => api<Restaurant[]>('/restaurants?archived=include'), []);
  const dishNames = useLoad(() => (tab === 'meals' ? api<Dish[]>('/dishes?archived=include') : Promise.resolve([] as Dish[])), [tab]);
  const qs = new URLSearchParams();
  if (q.trim()) qs.set('q', q.trim());
  if (tag && tab !== 'meals') qs.set('tag', tag);
  const query = qs.toString();
  const list = useLoad(() => api<(Restaurant | Dish | Meal)[]>(`/${tab}${query ? `?${query}` : ''}`), [tab, query]);
  const rname = (id: string) => all.data?.find(r => r.id === id)?.name ?? '已删除的店铺';
  const allTags = [...new Set((groups.data ?? []).flatMap(g => g.names))];

  return (
    <>
      <PageHead title="记忆库" sub="吃过的店、菜和每一次感受" action={<Button variant="soft" onClick={() => setAdding(!adding)} aria-expanded={adding}><Plus size={18} aria-hidden />新店</Button>} />
      {adding && (
        <RestaurantForm groups={groups.data ?? []} submitLabel="保存这家店" onCancel={() => setAdding(false)}
          onSubmit={async v => { const r = await api<Restaurant>('/restaurants', { method: 'POST', key, json: v }); navigate(`/restaurants/${r.id}`); }} />
      )}
      <nav className="tabs" aria-label="记忆库分类">
        {TABS.map(([t, label]) => <Link key={t} to={t === 'restaurants' ? '/library' : `/library?tab=${t}`} className={tab === t ? 'is-on' : ''} current={tab === t}>{label}</Link>)}
      </nav>
      <div className="search">
        <Search size={18} aria-hidden />
        <input type="search" aria-label="搜索记忆库" placeholder={tab === 'meals' ? '搜索备注' : '搜索名称、标签、备注'} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {tab !== 'meals' && allTags.length > 0 && (
        <div className="chips scroll-chips" role="group" aria-label="按标签筛选">
          {allTags.map(t => <Chip key={t} on={tag === t} onClick={() => setTag(tag === t ? '' : t)}>{t}</Chip>)}
        </div>
      )}
      {!list.data ? <LoadState error={list.error} onRetry={list.reload} />
        : !list.data.length ? (
          <Empty title={q || tag ? '没有找到匹配的内容' : '这里还是空的'}>{q || tag ? '换个关键词或标签试试。' : <Link to="/record" className="btn btn-primary">记一顿</Link>}</Empty>
        ) : tab === 'restaurants' ? (
          <ul className="list">
            {(list.data as Restaurant[]).map(r => (
              <li key={r.id}><Link to={`/restaurants/${r.id}`} className="card list-item">
                {r.photos[0] ? <img className="thumb" src={photoSrc(r.photos[0])} alt="" loading="lazy" /> : <span className="thumb thumb-empty" aria-hidden>{r.name.slice(0, 1)}</span>}
                <div className="list-main"><h2>{r.name}</h2><p>{[r.address, r.tags.join(' · ')].filter(Boolean).join(' ｜ ') || '还没有补充信息'}</p></div>
              </Link></li>
            ))}
          </ul>
        ) : tab === 'dishes' ? (
          <ul className="list">
            {(list.data as Dish[]).map(d => (
              <li key={d.id}><Link to={`/restaurants/${d.restaurantId}`} className="card list-item">
                {d.photos[0] ? <img className="thumb" src={photoSrc(d.photos[0])} alt="" loading="lazy" /> : <span className="thumb thumb-empty" aria-hidden>{d.name.slice(0, 1)}</span>}
                <div className="list-main"><h2>{d.name}{d.variant && <span className="muted small">（{d.variant}）</span>}</h2><p>{rname(d.restaurantId)}{d.tags.length > 0 && ` ｜ ${d.tags.join(' · ')}`}</p></div>
              </Link></li>
            ))}
          </ul>
        ) : (
          <ol className="list">
            {(list.data as Meal[]).map(m => (
              <li key={m.id}><Link to={`/restaurants/${m.restaurantId}`} className="card list-item">
                <div className="list-main">
                  <h2>{rname(m.restaurantId)}</h2>
                  <p>{fmtTime(m.date)} · {m.mode === 'takeaway' ? '外卖' : '堂食'}{m.dishes.length > 0 && ` · ${m.dishes.map(id => dishNames.data?.find(d => d.id === id)?.name ?? '').filter(Boolean).join('、')}`}</p>
                  {m.opinions.length === 0 && <p className="warn-line">还没评价</p>}
                </div>
              </Link></li>
            ))}
          </ol>
        )}
    </>
  );
}
