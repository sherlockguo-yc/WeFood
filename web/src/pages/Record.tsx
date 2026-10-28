import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, message, newKey, type Dish, type Feeling, type Meal, type Person, type Restaurant, type TagGroup, type UserInfo } from '../api.js';
import { navigate } from '../router.js';
import { Button, Chip, FeelingPicker, Field, Group, Notice, PageHead, PhotoInput, PhotoStrip, TagInput, useLoad } from '../components/Ui.js';

type Rating = { feeling: Feeling | null; again: boolean | null; note: string };
type Draft = {
  key: string; restaurantId: string; newRestaurant: boolean; restaurantName: string; restaurantTags: string[];
  date: string; mode: 'dine-in' | 'takeaway'; people: string[]; dishes: string[]; newDishes: string[];
  ratings: Record<string, Rating>; amount: string; note: string; photos: string[];
};
const SHOP = 'shop';
const storageKey = (uid: string) => `wefood:draft:${uid}`;
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const blank = (restaurantId = ''): Draft => ({ key: newKey(), restaurantId, newRestaurant: false, restaurantName: '', restaurantTags: [], date: localNow(), mode: 'dine-in', people: [], dishes: [], newDishes: [], ratings: {}, amount: '', note: '', photos: [] });
const shortHash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.codePointAt(0)!) >>> 0; return h.toString(36); };
function readDraft(uid: string): Draft | null {
  try { const raw = localStorage.getItem(storageKey(uid)); return raw ? { ...blank(), ...(JSON.parse(raw) as Partial<Draft>) } : null; } catch { return null; }
}

export function Record({ user, loc }: { user: UserInfo; loc: string }) {
  const preset = new URLSearchParams(loc.split('?')[1] ?? '').get('restaurant') ?? '';
  const [restored] = useState(() => readDraft(user.id));
  const [d, setD] = useState<Draft>(() => restored ?? blank(preset));
  const [dirty, setDirty] = useState(!!restored);
  const [search, setSearch] = useState('');
  const [dishText, setDishText] = useState('');
  const [personText, setPersonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const people = useLoad(() => api<Person[]>('/people'), []);
  const restaurants = useLoad(() => api<Restaurant[]>('/restaurants?archived=include'), []);
  const groups = useLoad(() => api<TagGroup[]>('/tag-options'), []);
  const dishes = useLoad(() => (d.restaurantId ? api<Dish[]>(`/dishes?restaurantId=${encodeURIComponent(d.restaurantId)}`) : Promise.resolve([] as Dish[])), [d.restaurantId]);

  const update = (patch: Partial<Draft> | ((x: Draft) => Partial<Draft>)) => { setD(x => ({ ...x, ...(typeof patch === 'function' ? patch(x) : patch) })); setDirty(true); };
  useEffect(() => { if (dirty) localStorage.setItem(storageKey(user.id), JSON.stringify(d)); }, [d, dirty, user.id]);
  useEffect(() => {
    if (!people.data || d.people.length) return;
    const me = people.data.find(p => p.name === '我') ?? people.data[0];
    if (me) setD(x => (x.people.length ? x : { ...x, people: [me.id] }));
  }, [people.data, d.people.length]);

  const active = (restaurants.data ?? []).filter(r => !r.archived);
  const selected = restaurants.data?.find(r => r.id === d.restaurantId);
  const term = search.trim().toLowerCase();
  const matches = term ? active.filter(r => r.name.toLowerCase().includes(term) || r.address.toLowerCase().includes(term)) : active.slice(0, 6);
  const exact = active.some(r => r.name.trim().toLowerCase() === term);
  const pname = (pid: string) => people.data?.find(p => p.id === pid)?.name ?? '某人';
  const dishList = (dishes.data ?? []).filter(x => !x.archived);
  const items = [
    { key: SHOP, name: '这家店' },
    ...d.dishes.map(id => ({ key: id, name: dishes.data?.find(x => x.id === id)?.name ?? '菜品' })),
    ...d.newDishes.map(n => ({ key: `new:${n}`, name: n }))
  ];
  const dropItemRatings = (ratings: Record<string, Rating>, itemKey: string) => Object.fromEntries(Object.entries(ratings).filter(([k]) => !k.endsWith(`|${itemKey}`)));

  function addDish() {
    const n = dishText.trim();
    if (!n) return;
    const existing = dishList.find(x => x.name === n);
    if (existing) update(x => ({ dishes: x.dishes.includes(existing.id) ? x.dishes : [...x.dishes, existing.id] }));
    else update(x => ({ newDishes: x.newDishes.includes(n) ? x.newDishes : [...x.newDishes, n] }));
    setDishText('');
  }
  async function addPerson() {
    const name = personText.trim();
    if (!name) return;
    try {
      const p = await api<Person>('/people', { method: 'POST', json: { name } });
      people.reload(); update(x => ({ people: [...x.people, p.id] })); setPersonText('');
    } catch (x) { setError(message(x)); }
  }
  function discard() {
    localStorage.removeItem(storageKey(user.id));
    setD(blank(preset)); setDirty(false); setError('');
  }

  async function save() {
    if (!d.restaurantId && !d.newRestaurant) { setError('请先选择或新建一家店'); return; }
    if (!d.people.length) { setError('至少选择一位同行的人'); return; }
    if (!d.date || Number.isNaN(Date.parse(d.date))) { setError('请填写有效的时间'); return; }
    const amount = d.amount.trim() ? Number(d.amount) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) { setError('花费需要是非负数字'); return; }
    setBusy(true); setError('');
    let cur = d;
    try {
      let rid = cur.restaurantId;
      if (!rid) {
        const r = await api<Restaurant>('/restaurants', { method: 'POST', key: `${cur.key}-r`, json: { name: cur.restaurantName, tags: cur.restaurantTags } });
        rid = r.id; cur = { ...cur, restaurantId: rid, newRestaurant: false }; setD(cur);
      }
      for (const n of [...cur.newDishes]) {
        const x = await api<Dish>('/dishes', { method: 'POST', key: `${cur.key}-d-${shortHash(n)}`, json: { name: n, restaurantId: rid } });
        const ratings = Object.fromEntries(Object.entries(cur.ratings).map(([k, v]) => [k.endsWith(`|new:${n}`) ? k.replace(`|new:${n}`, `|${x.id}`) : k, v]));
        cur = { ...cur, dishes: [...cur.dishes, x.id], newDishes: cur.newDishes.filter(m => m !== n), ratings }; setD(cur);
      }
      const opinions = Object.entries(cur.ratings).flatMap(([k, r]) => {
        const [personId, item] = k.split('|');
        if (r.feeling === null && r.again === null && !r.note.trim()) return [];
        if (!cur.people.includes(personId) || (item !== SHOP && !cur.dishes.includes(item))) return [];
        return [{ personId, ...(item === SHOP ? {} : { dishId: item }), feeling: r.feeling, again: r.again, note: r.note.trim() }];
      });
      await api<Meal>('/meals', { method: 'POST', key: cur.key, json: { restaurantId: rid, date: new Date(cur.date).toISOString(), mode: cur.mode, amount: amount === null ? null : Math.round(amount * 100), note: cur.note.trim(), people: cur.people, dishes: cur.dishes, opinions, photos: cur.photos } });
      localStorage.removeItem(storageKey(user.id));
      setDirty(false);
      navigate(`/restaurants/${rid}`);
    } catch (x) { setError(message(x)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHead title="记一顿" sub="只填记得的就好，其他可以以后补" />
      {restored && dirty && <Notice tone="warn" action={<Button variant="ghost" onClick={discard}>丢弃草稿</Button>}>已恢复这台设备上未保存的草稿。草稿只在本机，保存后其他设备才能看到。</Notice>}

      <section className="card" aria-labelledby="where">
        <h2 className="card-title" id="where">在哪吃</h2>
        {d.restaurantId || d.newRestaurant ? (
          <div className="picked">
            <div><strong>{d.newRestaurant ? d.restaurantName : selected?.name ?? '已选店铺'}</strong>{d.newRestaurant && <span className="badge">新店</span>}</div>
            <Button variant="ghost" onClick={() => update({ restaurantId: '', newRestaurant: false, restaurantName: '', restaurantTags: [], dishes: [], newDishes: [], ratings: {} })}>更换</Button>
          </div>
        ) : (
          <>
            <Field label="店铺"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索已有店铺，或输入新店名" maxLength={120} /></Field>
            <div className="pick-list">
              {matches.slice(0, 6).map(r => (
                <button key={r.id} type="button" className="pick" onClick={() => { update({ restaurantId: r.id, newRestaurant: false, restaurantName: '' }); setSearch(''); }}>
                  <span>{r.name}</span>{r.address && <span className="muted small">{r.address}</span>}
                </button>
              ))}
              {term && !exact && (
                <button type="button" className="pick pick-new" onClick={() => { update({ newRestaurant: true, restaurantName: search.trim(), restaurantId: '' }); setSearch(''); }}>
                  <Plus size={18} aria-hidden />新建「{search.trim()}」
                </button>
              )}
            </div>
          </>
        )}
        {d.newRestaurant && <TagInput label="店铺标签" value={d.restaurantTags} onChange={restaurantTags => update({ restaurantTags })} groups={groups.data ?? []} />}
      </section>

      <section className="card" aria-labelledby="when">
        <h2 className="card-title" id="when">什么时候、和谁</h2>
        <Field label="时间"><input type="datetime-local" value={d.date} onChange={e => update({ date: e.target.value })} /></Field>
        <Group label="方式">
          <div className="chips">
            <Chip on={d.mode === 'dine-in'} onClick={() => update({ mode: 'dine-in' })}>堂食</Chip>
            <Chip on={d.mode === 'takeaway'} onClick={() => update({ mode: 'takeaway' })}>外卖</Chip>
          </div>
        </Group>
        <Group label="同行的人">
          <div className="chips">
            {(people.data ?? []).map(p => <Chip key={p.id} on={d.people.includes(p.id)} onClick={() => update(x => ({ people: x.people.includes(p.id) ? x.people.filter(i => i !== p.id) : [...x.people, p.id] }))}>{p.name}</Chip>)}
          </div>
          <div className="inline-add">
            <input aria-label="新同行人" placeholder="添加新的人，如：女朋友" value={personText} maxLength={60} onChange={e => setPersonText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addPerson(); } }} />
            <Button variant="soft" onClick={() => void addPerson()} disabled={!personText.trim()}>添加</Button>
          </div>
        </Group>
      </section>

      {(d.restaurantId || d.newRestaurant) && (
        <section className="card" aria-labelledby="what">
          <h2 className="card-title" id="what">吃了什么</h2>
          <p className="muted small">只选实际吃到的菜，套餐里没吃的不用选。</p>
          <div className="chips">
            {dishList.map(x => <Chip key={x.id} on={d.dishes.includes(x.id)} onClick={() => update(s => s.dishes.includes(x.id) ? { dishes: s.dishes.filter(i => i !== x.id), ratings: dropItemRatings(s.ratings, x.id) } : { dishes: [...s.dishes, x.id] })}>{x.name}{x.variant && `（${x.variant}）`}</Chip>)}
            {d.newDishes.map(n => <Chip key={`new:${n}`} on label={`移除新菜 ${n}`} onClick={() => update(s => ({ newDishes: s.newDishes.filter(m => m !== n), ratings: dropItemRatings(s.ratings, `new:${n}`) }))}>{n}（新）</Chip>)}
          </div>
          <div className="inline-add">
            <input aria-label="新菜名" placeholder="没有的菜直接输入" value={dishText} maxLength={120} onChange={e => setDishText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDish(); } }} />
            <Button variant="soft" onClick={addDish} disabled={!dishText.trim()}>添加菜品</Button>
          </div>
        </section>
      )}

      {(d.restaurantId || d.newRestaurant) && d.people.length > 0 && (
        <section className="card" aria-labelledby="how">
          <h2 className="card-title" id="how">感受</h2>
          <p className="muted small">每个人分开记，不会被合成一个平均分。不评价也可以保存。</p>
          {items.map(it => (
            <div className="rate-block" key={it.key}>
              <h3>{it.key === SHOP ? '整体感受' : it.name}</h3>
              {d.people.map(pid => {
                const k = `${pid}|${it.key}`;
                const r = d.ratings[k] ?? { feeling: null, again: null, note: '' };
                const who = `${pname(pid)}对${it.name}`;
                return (
                  <div className="rate-row" key={k}>
                    <span className="rate-who">{pname(pid)}</span>
                    <FeelingPicker name={who} feeling={r.feeling} again={r.again} onChange={v => update(s => ({ ratings: { ...s.ratings, [k]: { ...r, ...v } } }))} />
                    <input className="rate-note" aria-label={`${who}的一句话`} placeholder="一句话，可不填" maxLength={2000} value={r.note} onChange={e => update(s => ({ ratings: { ...s.ratings, [k]: { ...r, note: e.target.value } } }))} />
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      )}

      <section className="card" aria-labelledby="more">
        <h2 className="card-title" id="more">补充（可选）</h2>
        <Field label="花费（元）" hint="不填不会算作零消费"><input inputMode="decimal" value={d.amount} onChange={e => update({ amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="备注"><textarea maxLength={4000} value={d.note} onChange={e => update({ note: e.target.value })} placeholder="排队多久、和谁庆祝、下次想试什么……" /></Field>
        <PhotoStrip ids={d.photos} onRemove={id => update(s => ({ photos: s.photos.filter(p => p !== id) }))} />
        <PhotoInput onAdd={ids => update(s => ({ photos: [...s.photos, ...ids] }))} />
      </section>

      <div className="save-bar">
        {error && <Notice tone="error">{error}</Notice>}
        <Button className="btn-block" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存这一顿'}</Button>
      </div>
    </>
  );
}
