import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { ApiError, api, message, newKey, type Dish, type Meal, type Person, type Restaurant, type TagGroup, type UserInfo, type FoodLocation } from '../api.js';
import { PlacePicker } from '../components/PlacePicker.js';
import { DishReferences } from '../components/DishReferences.js';
import { aggregateDishCandidates, normalizeDishName, type DishOrigin, type DishCandidateResult, type DishReference, type SourcePlace } from '../../../shared/dishReferences.js';
import { MenuOcr } from '../components/MenuOcr.js';
import { DishRatingRow, type DishRating } from '../components/DishRatingRow.js';
import { navigate } from '../router.js';
import { Button, Chip, FeelingPicker, Field, Group, Notice, PageHead, PhotoInput, PhotoStrip, TagInput, useLoad } from '../components/Ui.js';

type Rating = DishRating;
type Draft = {
  key: string; restaurantId: string; newRestaurant: boolean; restaurantName: string; restaurantTags: string[];
  restaurantAddress: string; restaurantLocation: FoodLocation | null; addressEdited: boolean;
  date: string; mode: 'dine-in' | 'takeaway'; people: string[]; dishes: string[]; newDishes: string[];
  dishOrigins: Record<string, DishOrigin>;
  ratings: Record<string, Rating>; amount: string; note: string; photos: string[];
  mealVersion?: number;
  source?: { target: string; url: string; confirm?: SourcePlace; confirmations?: SourcePlace[] };
  menu?: { target: string; groups: DishReference[] };
};
const SHOP = 'shop';
const storageKey = (uid: string, mealId = '') => mealId ? `wefood:edit-draft:${uid}:${mealId}` : `wefood:draft:${uid}`;
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const blank = (restaurantId = ''): Draft => ({ key: newKey(), restaurantId, newRestaurant: false, restaurantName: '', restaurantTags: [], restaurantAddress: '', restaurantLocation: null, addressEdited: false, date: localNow(), mode: 'dine-in', people: [], dishes: [], newDishes: [], dishOrigins: {}, ratings: {}, amount: '', note: '', photos: [] });
const shortHash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.codePointAt(0)!) >>> 0; return h.toString(36); };
function readDraft(uid: string, mealId: string): Draft | null {
  try { const raw = localStorage.getItem(storageKey(uid, mealId)); return raw ? { ...blank(), ...(JSON.parse(raw) as Partial<Draft>) } : null; } catch { return null; }
}
function mealDraft(meal: Meal): Draft {
  const date = new Date(meal.date);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return {
    ...blank(meal.restaurantId), mealVersion: meal.version, date: date.toISOString().slice(0, -1), mode: meal.mode,
    people: meal.people, dishes: meal.dishes, photos: meal.photos, note: meal.note,
    amount: meal.amount === null ? '' : String(meal.amount / 100),
    ratings: Object.fromEntries(meal.opinions.map(o => [`${o.personId}|${o.dishId ?? SHOP}`, { feeling: o.feeling, again: o.again, note: o.note }]))
  };
}

export function Record({ user, loc }: { user: UserInfo; loc: string }) {
  const params = new URLSearchParams(loc.split('?')[1] ?? '');
  const mealId = params.get('meal') ?? '';
  const preset = mealId ? '' : params.get('restaurant') ?? '';
  const [restored, setRestored] = useState(() => readDraft(user.id, mealId));
  const [d, setD] = useState<Draft>(() => restored ?? blank(preset));
  const [dirty, setDirty] = useState(!!restored);
  const [originalMeal, setOriginalMeal] = useState<Meal | null>(null);
  const meal = useLoad(() => mealId ? api<Meal>(`/meals/${encodeURIComponent(mealId)}`) : Promise.resolve(null), [mealId]);
  useEffect(() => {
    if (!mealId || !meal.data || originalMeal) return;
    setOriginalMeal(meal.data);
    setD(restored ? { ...restored, restaurantId: meal.data.restaurantId, newRestaurant: false, addressEdited: false, mealVersion: restored.mealVersion ?? meal.data.version } : mealDraft(meal.data));
  }, [mealId, meal.data, originalMeal, restored]);
  const [presetPending, setPresetPending] = useState(!!restored && !!preset && restored.restaurantId !== preset);
  const [search, setSearch] = useState('');
  const [dishText, setDishText] = useState('');
  const [personText, setPersonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const people = useLoad(() => api<Person[]>(mealId ? '/people?archived=include' : '/people'), [mealId]);
  const restaurants = useLoad(() => api<Restaurant[]>('/restaurants?archived=include'), []);
  const groups = useLoad(() => api<TagGroup[]>('/tag-options'), []);
  const dishes = useLoad(async () => {
    const restaurantId = d.restaurantId;
    const rows: Dish[] = [];
    if (restaurantId) {
      for (let offset = 0; ; offset += 1000) {
        const page = await api<Dish[]>(`/dishes?restaurantId=${encodeURIComponent(restaurantId)}${mealId ? '&archived=include' : ''}&limit=1000&offset=${offset}`);
        rows.push(...page);
        if (page.length < 1000) break;
      }
    }
    return { restaurantId, rows };
  }, [d.restaurantId, mealId]);

  const update = (patch: Partial<Draft> | ((x: Draft) => Partial<Draft>)) => { setD(x => ({ ...x, ...(typeof patch === 'function' ? patch(x) : patch) })); setDirty(true); };
  useEffect(() => { if (dirty && (!mealId || originalMeal)) localStorage.setItem(storageKey(user.id, mealId), JSON.stringify(d)); }, [d, dirty, user.id, mealId, originalMeal]);
  useEffect(() => {
    if (mealId || !people.data || d.people.length) return;
    const me = people.data.find(p => p.name === '我') ?? people.data[0];
    if (me) setD(x => (x.people.length ? x : { ...x, people: [me.id] }));
  }, [people.data, d.people.length, mealId]);

  const [savedRestaurant, setSavedRestaurant] = useState<Restaurant | null>(null);
  const active = (restaurants.data ?? []).filter(r => !r.archived);
  const selected = savedRestaurant?.id === d.restaurantId ? savedRestaurant : restaurants.data?.find(r => r.id === d.restaurantId);
  const address = d.addressEdited || !selected ? d.restaurantAddress : selected.address;
  const foodLocation = d.addressEdited || !selected ? d.restaurantLocation : selected.location;
  const term = search.trim().toLowerCase();
  const matches = term ? active.filter(r => r.name.toLowerCase().includes(term) || r.address.toLowerCase().includes(term)) : active.slice(0, 6);
  const pname = (pid: string) => people.data?.find(p => p.id === pid)?.name ?? '某人';
  const loadedDishes = !dishes.loading && !dishes.error && dishes.data?.restaurantId === d.restaurantId
    ? dishes.data.rows.filter(x => x.restaurantId === d.restaurantId) : [];
  const dishList = loadedDishes.filter(x => !x.archived);
  const historicalDishes = loadedDishes.filter(x => x.archived && d.dishes.includes(x.id));
  useEffect(() => {
    if (busy || dishes.loading || dishes.error || dishes.data?.restaurantId !== d.restaurantId) return;
    const available = dishes.data.rows;
    setD(s => {
      if (s.restaurantId !== dishes.data!.restaurantId) return s;
      const matched = s.newDishes.flatMap(name => {
        const existing = available.find(x => !x.archived && x.restaurantId === s.restaurantId && normalizeDishName(x.name) === normalizeDishName(name) && !x.variant);
        return existing ? [{ name, id: existing.id }] : [];
      });
      if (!matched.length) return s;
      const ratings = { ...s.ratings }, origins = { ...s.dishOrigins };
      for (const item of matched) {
        for (const [key, old] of Object.entries(ratings)) {
          if (key.slice(key.indexOf('|') + 1) !== `new:${item.name}`) continue;
          const target = `${key.slice(0, key.indexOf('|'))}|${item.id}`, current = ratings[target];
          ratings[target] = current ? { feeling: current.feeling ?? old.feeling, again: current.again ?? old.again, note: [...new Set([current.note, old.note].filter(Boolean))].join('；') } : old;
          delete ratings[key];
        }
        delete origins[item.name];
      }
      return { ...s, newDishes: s.newDishes.filter(name => !matched.some(x => x.name === name)), dishes: [...new Set([...s.dishes, ...matched.map(x => x.id)])], ratings, dishOrigins: origins };
    });
  }, [busy, dishes.loading, dishes.error, dishes.data, d.restaurantId, d.newDishes]);
  const items = [{ key: SHOP, name: '这家店' }];
  const referenceName = d.newRestaurant ? d.restaurantName.trim() : selected?.name.trim() ?? '';
  const referenceTarget = JSON.stringify([d.restaurantId, referenceName, address]);
  const source = d.source?.target === referenceTarget ? d.source : undefined;
  const referenceInput = { restaurantId: d.addressEdited ? '' : d.restaurantId, name: referenceName, address, ...(foodLocation ? { location: { lat: foodLocation.lat, lng: foodLocation.lng } } : {}), sourceUrl: source?.url ?? '', ...(source?.confirmations?.length ? { confirmations: source.confirmations } : {}), ...(source?.confirm ? { confirm: source.confirm } : {}) };
  const referenceKey = JSON.stringify(referenceInput);
  const currentReference = useRef(referenceKey); currentReference.current = referenceKey;
  const [fetchedReferences, setFetchedReferences] = useState<{ key: string; data?: DishCandidateResult; error?: string } | null>(null);
  const [fetchingReference, setFetchingReference] = useState('');
  const references = useLoad(async () => ({ key: referenceKey, data: await api<DishCandidateResult>('/dish-candidates', { method: 'POST', json: referenceInput }) }), [referenceKey]);
  const referenceData = fetchedReferences?.key === referenceKey && fetchedReferences.data ? fetchedReferences.data
    : references.data?.key === referenceKey ? references.data.data : undefined;
  const menuGroups = d.menu?.target === referenceTarget ? d.menu.groups : [];
  const referenceCandidates = useMemo(() => aggregateDishCandidates([
    ...(referenceData?.candidates ?? []).flatMap(c => c.origins.map(origin => ({ id: origin.url ?? origin.photoId!, brand: referenceName, origin, names: [c.name] }))),
    ...(d.menu?.target === referenceTarget ? d.menu.groups : [])
  ]), [referenceData, d.menu, referenceTarget, referenceName]);
  const displayedReferences = referenceData ? { ...referenceData, candidates: referenceCandidates } : { name: referenceName, restaurantId: d.restaurantId, sourceUrl: '', sources: [], candidates: referenceCandidates };
  const referenceNames = new Set(referenceCandidates.map(candidate => normalizeDishName(candidate.name)));
  const referenceBusy = fetchingReference === referenceTarget;
  const referenceError = fetchedReferences?.key === referenceKey ? fetchedReferences.error : references.error;
  useEffect(() => {
    if (busy || !referenceCandidates.length) return;
    setD(s => {
      const origins = { ...s.dishOrigins }; let changed = false;
      for (const name of s.newDishes) {
        const candidate = referenceCandidates.find(c => normalizeDishName(c.name) === normalizeDishName(name));
        if (!candidate) continue;
        const old = origins[name], evidence = [...(old?.evidence ?? (old ? [old] : []))];
        for (const origin of candidate.origins) if (!evidence.some(o => o.url === origin.url && o.photoId === origin.photoId)) evidence.push(origin);
        const next = { ...(old ?? candidate.origins[0]), evidence: evidence.slice(0, 12) };
        if (JSON.stringify(old) !== JSON.stringify(next)) { origins[name] = next; changed = true; }
      }
      return changed ? { ...s, dishOrigins: origins } : s;
    });
  }, [referenceCandidates, busy]);
  async function fetchReferences(url: string, confirm?: SourcePlace, discover = false) {
    if (referenceBusy || busy) return;
    const externalSource = confirm && !confirm.url.startsWith('https://you.ctrip.com/');
    const confirmations = [...(source?.confirmations ?? []), ...(confirm && discover && !source?.confirmations?.some(p => p.url === confirm.url) ? [confirm] : [])].slice(0, 12);
    const nextInput = { restaurantId: d.addressEdited ? '' : d.restaurantId, name: referenceName, address, ...(foodLocation ? { location: { lat: foodLocation.lat, lng: foodLocation.lng } } : {}), sourceUrl: externalSource ? '' : url, ...(confirmations.length ? { confirmations } : {}), ...(confirm ? { confirm } : {}) };
    const nextKey = JSON.stringify(nextInput);
    update({ source: { target: referenceTarget, url: nextInput.sourceUrl, confirm, confirmations } });
    currentReference.current = nextKey; setFetchingReference(referenceTarget);
    setFetchedReferences({ key: nextKey, data: referenceData });
    try {
      const data = await api<DishCandidateResult>('/dish-candidates', { method: 'POST', json: { ...nextInput, load: !discover, discover } });
      if (currentReference.current === nextKey) setFetchedReferences({ key: nextKey, data });
    } catch (error) {
      if (currentReference.current === nextKey) setFetchedReferences({ key: nextKey, data: referenceData, error: message(error) });
    } finally { setFetchingReference(current => current === referenceTarget ? '' : current); }
  }
  const dropItemRatings = (ratings: Record<string, Rating>, itemKey: string) => Object.fromEntries(Object.entries(ratings).filter(([k]) => k.slice(k.indexOf('|') + 1) !== itemKey));

  const dishesPending = !!d.restaurantId && (dishes.loading || !!dishes.error || dishes.data?.restaurantId !== d.restaurantId);
  function addDish() {
    if (dishesPending) return;
    const n = dishText.trim();
    if (!n) return;
    const existing = dishList.find(x => normalizeDishName(x.name) === normalizeDishName(n) && !x.variant);
    if (existing) update(x => ({ dishes: x.dishes.includes(existing.id) ? x.dishes : [...x.dishes, existing.id] }));
    else update(x => ({ newDishes: x.newDishes.some(name => normalizeDishName(name) === normalizeDishName(n)) ? x.newDishes : [...x.newDishes, n] }));
    setDishText('');
  }
  function renderDish(name: string, itemKey: string, origin?: DishOrigin, selectLabel = name) {
    const isNew = itemKey.startsWith('new:');
    const picked = isNew ? d.newDishes.includes(name) : d.dishes.includes(itemKey);
    const select = (s: Draft): Partial<Draft> => isNew
      ? { newDishes: s.newDishes.includes(name) ? s.newDishes : [...s.newDishes, name], dishOrigins: origin && !s.dishOrigins[name] ? { ...s.dishOrigins, [name]: origin } : s.dishOrigins }
      : { dishes: s.dishes.includes(itemKey) ? s.dishes : [...s.dishes, itemKey] };
    return <DishRatingRow key={itemKey} name={name} selected={picked} disabled={busy || dishesPending} selectLabel={selectLabel}
      raters={d.people.map(id => ({ id, name: pname(id), rating: d.ratings[`${id}|${itemKey}`] ?? { feeling: null, again: null, note: '' } }))}
      onToggle={() => {
        if (dishesPending || busy) return;
        update(s => {
          const selected = isNew ? s.newDishes.includes(name) : s.dishes.includes(itemKey);
          if (!selected) return select(s);
          return { ...(isNew ? { newDishes: s.newDishes.filter(n => n !== name), dishOrigins: Object.fromEntries(Object.entries(s.dishOrigins).filter(([n]) => n !== name)) } : { dishes: s.dishes.filter(id => id !== itemKey) }), ratings: dropItemRatings(s.ratings, itemKey) };
        });
      }}
      onRate={(id, patch) => {
        if (dishesPending || busy) return;
        update(s => {
          if (!(isNew ? s.newDishes.includes(name) : s.dishes.includes(itemKey))) return {};
          const key = `${id}|${itemKey}`, rating = s.ratings[key] ?? { feeling: null, again: null, note: '' };
          return { ratings: { ...s.ratings, [key]: { ...rating, ...patch } } };
        });
      }} />;
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
    localStorage.removeItem(storageKey(user.id, mealId));
    setD(originalMeal ? mealDraft(originalMeal) : blank(preset)); setRestored(null); setDirty(false); setError('');
  }

  async function save() {
    if (busy || (mealId && (!originalMeal || dishesPending))) return;
    if (!d.restaurantId && !d.newRestaurant) { setError('请先选择或新建一家店'); return; }
    if (d.mode === 'dine-in' && !address.trim() && originalMeal?.mode !== 'dine-in') { setError('堂食请先填写店铺地址，或从地图选择正确分店'); return; }
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
      const matchedSource = referenceData?.sources.find(s => s.channel === 'ctrip' && (s.status === 'ready' || s.status === 'stale'))?.origin;
      if (cur.source?.target === referenceTarget && matchedSource?.restaurantName && matchedSource.address) {
        await api('/dish-candidates', { method: 'POST', json: { restaurantId: rid, sourceUrl: matchedSource.url, bind: true, confirm: { name: matchedSource.restaurantName, address: matchedSource.address, url: matchedSource.url } } });
      }
      if (cur.source?.target === referenceTarget && cur.source.confirmations?.length) {
        await api('/dish-candidates', { method: 'POST', json: { restaurantId: rid, confirmations: cur.source.confirmations, bind: true } });
      }
      for (const n of [...cur.newDishes]) {
        const x = await api<Dish>('/dishes', { method: 'POST', key: `${cur.key}-d-${shortHash(n)}`, json: { name: n, restaurantId: rid, origin: cur.dishOrigins[n] ?? null } });
        const ratings = { ...cur.ratings };
        for (const [key, old] of Object.entries(cur.ratings)) {
          if (key.slice(key.indexOf('|') + 1) !== `new:${n}`) continue;
          const target = `${key.slice(0, key.indexOf('|'))}|${x.id}`, current = ratings[target];
          ratings[target] = current ? { feeling: current.feeling ?? old.feeling, again: current.again ?? old.again, note: [...new Set([current.note, old.note].filter(Boolean))].join('；') } : old;
          delete ratings[key];
        }
        cur = { ...cur, dishes: [...new Set([...cur.dishes, x.id])], newDishes: cur.newDishes.filter(m => m !== n), ratings }; setD(cur);
      }
      const opinions = Object.entries(cur.ratings).flatMap(([k, r]) => {
        const separator = k.indexOf('|'), personId = k.slice(0, separator), item = k.slice(separator + 1);
        if (r.feeling === null && r.again === null && !r.note.trim()) return [];
        if (!cur.people.includes(personId) || (item !== SHOP && !cur.dishes.includes(item))) return [];
        return [{ personId, ...(item === SHOP ? {} : { dishId: item }), feeling: r.feeling, again: r.again, note: r.note.trim() }];
      });
      await api<Meal>(mealId ? `/meals/${encodeURIComponent(mealId)}` : '/meals', { method: mealId ? 'PUT' : 'POST', ...(mealId ? {} : { key: cur.key }), json: { restaurantId: rid, date: new Date(cur.date).toISOString(), mode: cur.mode, amount: amount === null ? null : Math.round(amount * 100), note: cur.note.trim(), people: cur.people, dishes: cur.dishes, opinions, photos: cur.photos, ...(mealId ? { version: cur.mealVersion } : {}) } });
      localStorage.removeItem(storageKey(user.id, mealId));
      setDirty(false);
      navigate(`/restaurants/${rid}`);
    } catch (x) {
      if (mealId && x instanceof ApiError && x.code === 'VERSION_CONFLICT') {
        const latest = await api<Meal>(`/meals/${encodeURIComponent(mealId)}`).catch(() => null);
        if (latest) { setOriginalMeal(latest); update({ mealVersion: latest.version }); }
        setError(`其他设备刚修改过这次就餐记录${latest ? `（最新备注：${latest.note || '无'}）` : ''}。你的输入仍保留，${latest ? '再次保存将以你的内容为准。' : '请稍后重试。'}`);
      } else setError(message(x));
    } finally { setBusy(false); }
  }

  if (mealId && !originalMeal) return <>
    <PageHead title="编辑这一顿" back="/library" />
    {meal.error ? <Notice tone="error" action={<Button variant="soft" onClick={meal.reload}>重试加载记录</Button>}>{meal.error}</Notice> : <p className="muted loading" role="status">正在加载这次就餐记录…</p>}
  </>;

  return (
    <>
      <PageHead title={mealId ? '编辑这一顿' : '记一顿'} back={mealId ? `/restaurants/${d.restaurantId}` : undefined} sub={mealId ? '补记菜品或调整评价，保存后更新原记录' : '堂食请填店铺地址，其他信息可后补'} />
      <fieldset className="record-fields" disabled={busy}>
      {presetPending && <Notice tone="warn">当前恢复了另一家店的草稿，没有覆盖原输入。
        <div className="row"><Button variant="soft" onClick={() => { update({ restaurantId: preset, newRestaurant: false, restaurantName: '', restaurantAddress: '', restaurantLocation: null, addressEdited: false, dishes: [], newDishes: [], dishOrigins: {}, ratings: {} }); setPresetPending(false); }}>改用地图选中的店</Button>
          <Button variant="ghost" onClick={() => setPresetPending(false)}>继续原草稿</Button></div>
      </Notice>}
      {restored && dirty && <Notice tone="warn" action={<Button variant="ghost" onClick={() => { discard(); setPresetPending(false); }}>丢弃草稿</Button>}>已恢复这台设备上未保存的草稿。草稿只在本机，保存后其他设备才能看到。</Notice>}

      <section className="card" aria-labelledby="where">
        <h2 className="card-title" id="where">在哪吃</h2>
        {d.restaurantId || d.newRestaurant ? (
          <div className="picked">
            <div><strong>{d.newRestaurant ? d.restaurantName : selected?.name ?? '已选店铺'}</strong>{d.newRestaurant && <span className="badge">新店</span>}</div>
            {!mealId && <Button variant="ghost" onClick={() => update({ restaurantId: '', newRestaurant: false, restaurantName: '', restaurantTags: [], restaurantAddress: '', restaurantLocation: null, addressEdited: false, dishes: [], newDishes: [], dishOrigins: {}, ratings: {} })}>更换</Button>}
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
        {!mealId && <PlacePicker key={d.restaurantId || 'new'} address={address} location={foodLocation} required={d.mode === 'dine-in'} keyword={d.newRestaurant ? d.restaurantName : selected?.name || search}
          onChange={p => {
            const existing = p.location?.source === 'tencent' ? restaurants.data?.find(r => r.location?.source === 'tencent' && r.location.providerId === p.location!.providerId) : undefined;
            if (existing && existing.id !== d.restaurantId) {
              if (existing.archived) { setError('这家店已归档，请先到记忆库恢复，不要覆盖当前店铺'); return; }
              if (d.restaurantId && (d.dishes.length || d.newDishes.length || Object.keys(d.ratings).length) && !confirm('改用地图选中的另一家店？当前已选菜品和评价会清空，备注和照片保留。')) return;
              update({ restaurantId: existing.id, newRestaurant: false, restaurantName: '', restaurantAddress: existing.address, restaurantLocation: existing.location ?? null, addressEdited: false, dishes: [], newDishes: [], dishOrigins: {}, ratings: {} });
              return;
            }
            if (!d.restaurantId && p.name && d.restaurantName && p.name !== d.restaurantName) {
              if ((d.newDishes.length || Object.keys(d.ratings).length) && !confirm('改用地图中的另一家店？已选菜品和评价会清空，备注和照片保留。')) return;
              update({ restaurantName: p.name, newRestaurant: true, restaurantAddress: p.address, restaurantLocation: p.location, addressEdited: true, dishes: [], newDishes: [], dishOrigins: {}, ratings: {} });
              return;
            }
            update({ restaurantAddress: p.address, restaurantLocation: p.location, addressEdited: true,
              ...(!d.restaurantId && p.name ? { newRestaurant: true, restaurantName: p.name } : {}) });
          }} />}
        {mealId && <p className="muted small">这次记录属于这家店；店铺地址可在店铺详情中单独修改。</p>}
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
          <h2 className="card-title" id="what">菜品评价</h2>
          <p className="muted small">先选吃过的菜，再在菜名旁评价好吃、一般或不好吃。也可以只记吃过，不评价。</p>
          <p className="muted small">已记录菜品不是店铺完整菜单。</p>
          {d.restaurantId && dishes.error ? <Notice tone="error" action={<Button variant="soft" onClick={dishes.reload}>重试加载菜品</Button>}>{dishes.error}</Notice>
            : d.restaurantId && (dishes.loading || dishes.data?.restaurantId !== d.restaurantId) ? <p className="muted small" role="status">正在加载这家店已记录的菜品…</p>
            : dishList.length ? <p className="small">已记录菜品（{dishList.length} 道）</p>
            : <Notice tone="info">尚未记录这家店的菜品</Notice>}
          <div className="dish-rating-list">
            {dishList.filter(x => x.variant || !referenceNames.has(normalizeDishName(x.name))).map(x => renderDish(x.variant ? `${x.name}（${x.variant}）` : x.name, x.id))}
            {historicalDishes.filter(x => x.variant || !referenceNames.has(normalizeDishName(x.name))).map(x => renderDish(`${x.name}${x.variant ? `（${x.variant}）` : ''}（已归档）`, x.id))}
            {d.newDishes.filter(name => !referenceNames.has(normalizeDishName(name))).map(name => renderDish(name, `new:${name}`, d.dishOrigins[name], `移除新菜 ${name}`))}
            {d.dishes.filter(id => !loadedDishes.some(x => x.id === id)).map(id => renderDish('已选菜品（资料暂不可用）', id, undefined, `移除暂不可用菜品 ${id}`))}
          </div>
          <div className="inline-add">
            <input aria-label="新菜名" placeholder="没有的菜直接输入" value={dishText} maxLength={120} onChange={e => setDishText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDish(); } }} />
            <Button variant="soft" onClick={addDish} disabled={!dishText.trim() || dishesPending}>添加菜品</Button>
          </div>
          <MenuOcr key={`ocr:${referenceTarget}`} name={referenceName} disabled={busy || dishesPending || referenceBusy} onAdopt={group => update({ menu: { target: referenceTarget, groups: [...menuGroups, group] } })} />
          <DishReferences key={referenceTarget} data={displayedReferences} error={referenceError} loading={referenceBusy || references.loading}
            disabled={busy || dishesPending} onRetry={() => { if (source?.url) void fetchReferences(source.url, source.confirm); else { setFetchedReferences(null); references.reload(); } }} onLoad={(url, confirm, discover) => void fetchReferences(url, confirm, discover)}
            renderDish={candidate => {
              const name = candidate.name;
              const existing = dishList.find(x => normalizeDishName(x.name) === normalizeDishName(name) && !x.variant) ?? historicalDishes.find(x => normalizeDishName(x.name) === normalizeDishName(name) && !x.variant);
              const draftName = d.newDishes.find(n => normalizeDishName(n) === normalizeDishName(name)) ?? name;
              const origin = { ...candidate.origins[0], evidence: candidate.origins };
              return renderDish(existing?.name ?? draftName, existing?.id ?? `new:${draftName}`, origin, `选择参考菜品 ${name}`);
            }} />
        </section>
      )}

      {(d.restaurantId || d.newRestaurant) && d.people.length > 0 && (
        <section className="card" aria-labelledby="how">
          <h2 className="card-title" id="how">店铺整体感受</h2>
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
        <Button className="btn-block" onClick={() => void save()} disabled={busy || referenceBusy || (mealId ? dishesPending : false)}>{busy ? '保存中…' : mealId ? '保存修改' : '保存这一顿'}</Button>
      </div>
    </>
  );
}
