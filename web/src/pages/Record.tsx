import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, message, newKey, type Dish, type Feeling, type Meal, type Person, type Restaurant, type TagGroup, type UserInfo, type FoodLocation } from '../api.js';
import { PlacePicker } from '../components/PlacePicker.js';
import { navigate } from '../router.js';
import { Button, Chip, FeelingPicker, Field, Group, Notice, PageHead, PhotoInput, PhotoStrip, TagInput, useLoad } from '../components/Ui.js';

type Rating = { feeling: Feeling | null; again: boolean | null; note: string };
type Draft = {
  key: string; restaurantId: string; newRestaurant: boolean; restaurantName: string; restaurantTags: string[];
  restaurantAddress: string; restaurantLocation: FoodLocation | null; addressEdited: boolean;
  date: string; mode: 'dine-in' | 'takeaway'; people: string[]; dishes: string[]; newDishes: string[];
  ratings: Record<string, Rating>; amount: string; note: string; photos: string[];
};
const SHOP = 'shop';
const storageKey = (uid: string) => `wefood:draft:${uid}`;
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const blank = (restaurantId = ''): Draft => ({ key: newKey(), restaurantId, newRestaurant: false, restaurantName: '', restaurantTags: [], restaurantAddress: '', restaurantLocation: null, addressEdited: false, date: localNow(), mode: 'dine-in', people: [], dishes: [], newDishes: [], ratings: {}, amount: '', note: '', photos: [] });
const shortHash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.codePointAt(0)!) >>> 0; return h.toString(36); };
function readDraft(uid: string): Draft | null {
  try { const raw = localStorage.getItem(storageKey(uid)); return raw ? { ...blank(), ...(JSON.parse(raw) as Partial<Draft>) } : null; } catch { return null; }
}

export function Record({ user, loc }: { user: UserInfo; loc: string }) {
  const preset = new URLSearchParams(loc.split('?')[1] ?? '').get('restaurant') ?? '';
  const [restored] = useState(() => readDraft(user.id));
  const [d, setD] = useState<Draft>(() => restored ?? blank(preset));
  const [dirty, setDirty] = useState(!!restored);
  const [presetPending, setPresetPending] = useState(!!restored && !!preset && restored.restaurantId !== preset);
  const [search, setSearch] = useState('');
  const [dishText, setDishText] = useState('');
  const [personText, setPersonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const people = useLoad(() => api<Person[]>('/people'), []);
  const restaurants = useLoad(() => api<Restaurant[]>('/restaurants?archived=include'), []);
  const groups = useLoad(() => api<TagGroup[]>('/tag-options'), []);
  const dishes = useLoad(async () => {
    const restaurantId = d.restaurantId;
    const rows: Dish[] = [];
    if (restaurantId) {
      for (let offset = 0; ; offset += 1000) {
        const page = await api<Dish[]>(`/dishes?restaurantId=${encodeURIComponent(restaurantId)}&limit=1000&offset=${offset}`);
        rows.push(...page);
        if (page.length < 1000) break;
      }
    }
    return { restaurantId, rows };
  }, [d.restaurantId]);

  const update = (patch: Partial<Draft> | ((x: Draft) => Partial<Draft>)) => { setD(x => ({ ...x, ...(typeof patch === 'function' ? patch(x) : patch) })); setDirty(true); };
  useEffect(() => { if (dirty) localStorage.setItem(storageKey(user.id), JSON.stringify(d)); }, [d, dirty, user.id]);
  useEffect(() => {
    if (!people.data || d.people.length) return;
    const me = people.data.find(p => p.name === '我') ?? people.data[0];
    if (me) setD(x => (x.people.length ? x : { ...x, people: [me.id] }));
  }, [people.data, d.people.length]);

  const [savedRestaurant, setSavedRestaurant] = useState<Restaurant | null>(null);
  const active = (restaurants.data ?? []).filter(r => !r.archived);
  const selected = savedRestaurant?.id === d.restaurantId ? savedRestaurant : restaurants.data?.find(r => r.id === d.restaurantId);
  const address = d.addressEdited || !selected ? d.restaurantAddress : selected.address;
  const foodLocation = d.addressEdited || !selected ? d.restaurantLocation : selected.location;
  const term = search.trim().toLowerCase();
  const matches = term ? active.filter(r => r.name.toLowerCase().includes(term) || r.address.toLowerCase().includes(term)) : active.slice(0, 6);
  const pname = (pid: string) => people.data?.find(p => p.id === pid)?.name ?? '某人';
  const dishList = !dishes.loading && !dishes.error && dishes.data?.restaurantId === d.restaurantId
    ? dishes.data.rows.filter(x => !x.archived && x.restaurantId === d.restaurantId) : [];
  const items = [
    { key: SHOP, name: '这家店' },
    ...d.dishes.map(id => ({ key: id, name: dishList.find(x => x.id === id)?.name ?? '已选菜品（资料暂不可用）' })),
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
    if (d.mode === 'dine-in' && !address.trim()) { setError('堂食请先填写店铺地址，或从地图选择正确分店'); return; }
    if (!d.people.length) { setError('至少选择一位同行的人'); return; }
    if (!d.date || Number.isNaN(Date.parse(d.date))) { setError('请填写有效的时间'); return; }
    const amount = d.amount.trim() ? Number(d.amount) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) { setError('花费需要是非负数字'); return; }
    setBusy(true); setError('');
    let cur = d;
    try {
      let rid = cur.restaurantId;
      if (!rid) {
        const r = await api<Restaurant>('/restaurants', { method: 'POST', key: `${cur.key}-r`, json: { name: cur.restaurantName, tags: cur.restaurantTags, address: address.trim(), location: foodLocation ?? null } });
        rid = r.id; cur = { ...cur, restaurantId: rid, newRestaurant: false, addressEdited: false }; setD(cur); setSavedRestaurant(r);
      } else if (cur.addressEdited) {
        if (!selected) throw new Error('店铺资料尚未加载，请稍后再保存');
        try {
          const r = await api<Restaurant>(`/restaurants/${rid}`, { method: 'PUT', json: { address: address.trim(), location: foodLocation ?? null, version: selected.version } });
          cur = { ...cur, addressEdited: false }; setD(cur); setSavedRestaurant(r);
        } catch (e) {
          const latest = await api<Restaurant>(`/restaurants/${rid}`).catch(() => null);
          if (latest) setSavedRestaurant(latest);
          throw e;
        }
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
      <PageHead title="记一顿" sub="堂食请填店铺地址，其他信息可后补" />
      <fieldset className="record-fields" disabled={busy}>
      {presetPending && <Notice tone="warn">当前恢复了另一家店的草稿，没有覆盖原输入。
        <div className="row"><Button variant="soft" onClick={() => { update({ restaurantId: preset, newRestaurant: false, restaurantName: '', restaurantAddress: '', restaurantLocation: null, addressEdited: false, dishes: [], newDishes: [], ratings: {} }); setPresetPending(false); }}>改用地图选中的店</Button>
          <Button variant="ghost" onClick={() => setPresetPending(false)}>继续原草稿</Button></div>
      </Notice>}
      {restored && dirty && <Notice tone="warn" action={<Button variant="ghost" onClick={() => { discard(); setPresetPending(false); }}>丢弃草稿</Button>}>已恢复这台设备上未保存的草稿。草稿只在本机，保存后其他设备才能看到。</Notice>}

      <section className="card" aria-labelledby="where">
        <h2 className="card-title" id="where">在哪吃</h2>
        {d.restaurantId || d.newRestaurant ? (
          <div className="picked">
            <div><strong>{d.newRestaurant ? d.restaurantName : selected?.name ?? '已选店铺'}</strong>{d.newRestaurant && <span className="badge">新店</span>}</div>
            <Button variant="ghost" onClick={() => update({ restaurantId: '', newRestaurant: false, restaurantName: '', restaurantTags: [], restaurantAddress: '', restaurantLocation: null, addressEdited: false, dishes: [], newDishes: [], ratings: {} })}>更换</Button>
          </div>
        ) : (
          <>
            <Field label="店铺"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索已有店铺，或输入新店名" maxLength={120} /></Field>
            <div className="pick-list">
              {matches.slice(0, 6).map(r => (
                <button key={r.id} type="button" className="pick" onClick={() => { update({ restaurantId: r.id, newRestaurant: false, restaurantName: '', addressEdited: false, restaurantAddress: r.address, restaurantLocation: r.location ?? null }); setSearch(''); }}>
                  <span>{r.name}</span>{r.address && <span className="muted small">{r.address}</span>}
                </button>
              ))}
              {term && (
                <button type="button" className="pick pick-new" onClick={() => { update({ newRestaurant: true, restaurantName: search.trim(), restaurantId: '' }); setSearch(''); }}>
                  <Plus size={18} aria-hidden />新建「{search.trim()}」
                </button>
              )}
            </div>
          </>
        )}
        <PlacePicker key={d.restaurantId || 'new'} address={address} location={foodLocation} required={d.mode === 'dine-in'} keyword={d.newRestaurant ? d.restaurantName : selected?.name || search}
          onChange={p => {
            const existing = p.location?.source === 'tencent' ? restaurants.data?.find(r => r.location?.source === 'tencent' && r.location.providerId === p.location!.providerId) : undefined;
            if (existing && existing.id !== d.restaurantId) {
              if (existing.archived) { setError('这家店已归档，请先到记忆库恢复，不要覆盖当前店铺'); return; }
              if (d.restaurantId && (d.dishes.length || d.newDishes.length || Object.keys(d.ratings).length) && !confirm('改用地图选中的另一家店？当前已选菜品和评价会清空，备注和照片保留。')) return;
              update({ restaurantId: existing.id, newRestaurant: false, restaurantName: '', restaurantAddress: existing.address, restaurantLocation: existing.location ?? null, addressEdited: false, dishes: [], newDishes: [], ratings: {} });
              return;
            }
            update({ restaurantAddress: p.address, restaurantLocation: p.location, addressEdited: true,
              ...(!d.restaurantId && p.name ? { newRestaurant: true, restaurantName: p.name } : {}) });
          }} />
        {d.restaurantId && d.addressEdited && <p className="muted small">保存这一顿时同时更新店铺位置，已有历史记录保留。</p>}
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
          <p className="muted small">这里只显示你已录入的菜品，不是店铺完整菜单。</p>
          {d.restaurantId && dishes.error ? <Notice tone="error" action={<Button variant="soft" onClick={dishes.reload}>重试加载菜品</Button>}>{dishes.error}</Notice>
            : d.restaurantId && (dishes.loading || dishes.data?.restaurantId !== d.restaurantId) ? <p className="muted small" role="status">正在加载这家店已记录的菜品…</p>
            : dishList.length ? <p className="small">已记录菜品（{dishList.length} 道）</p>
            : <Notice tone="info">尚未记录这家店的菜品</Notice>}
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

      </fieldset>
      <div className="save-bar">
        {error && <Notice tone="error">{error}</Notice>}
        <Button className="btn-block" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存这一顿'}</Button>
      </div>
    </>
  );
}
