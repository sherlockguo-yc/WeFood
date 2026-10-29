import { useRef, useState, type FormEvent } from 'react';
import { MapPin, ExternalLink, Plus, Archive, Pencil, Trash2 } from 'lucide-react';
import { ApiError, api, message, newKey, type Dish, type Meal, type Opinion, type Person, type Restaurant, type TagGroup, type Feeling } from '../api.js';
import { navigate } from '../router.js';
import { Button, Field, FeelingPicker, Link, LoadState, Notice, PageHead, PhotoInput, PhotoStrip, TagInput, feelingText, fmtTime, isNegative, isPositive, useLoad, yuan } from '../components/Ui.js';

import { PlacePicker } from '../components/PlacePicker.js';
import type { FoodLocation } from '../api.js';

export type RestaurantInput = { name: string; address: string; location?: FoodLocation | null; link: string; note: string; tags: string[]; budget: number | null; photos: string[] };
type Overview = { restaurant: Restaurant; dishes: Dish[]; meals: Meal[]; opinions: Opinion[]; people: Person[] };

export function RestaurantForm({ initial, groups, submitLabel, onSubmit, onCancel }: { initial?: RestaurantInput; groups: TagGroup[]; submitLabel: string; onSubmit: (v: RestaurantInput) => Promise<void>; onCancel?: () => void }) {
  const [v, setV] = useState<RestaurantInput>(initial ?? { name: '', address: '', link: '', note: '', tags: [], budget: null, photos: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<RestaurantInput>) => setV(x => ({ ...x, ...patch }));
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await onSubmit(v); } catch (x) { setError(message(x)); } finally { setBusy(false); }
  }
  return (
    <form className="card" onSubmit={submit}>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="店名"><input required maxLength={120} value={v.name} onChange={e => set({ name: e.target.value })} placeholder="例如：巷口小馆（体育西店）" /></Field>
      <PlacePicker address={v.address} location={v.location} keyword={v.name} onChange={p => set({ address: p.address, location: p.location, ...(p.name ? { name: p.name } : {}) })} />
      <Field label="店铺链接（可选）" hint="只保存用于跳转，不会读取链接内容"><input type="url" inputMode="url" maxLength={1500} value={v.link} onChange={e => set({ link: e.target.value })} placeholder="https://" /></Field>
      <Field label="人均（元，可选）"><input inputMode="numeric" value={v.budget ?? ''} onChange={e => { const t = e.target.value.replace(/[^\d]/g, ''); set({ budget: t ? Number(t) : null }); }} /></Field>
      <TagInput label="店铺标签" value={v.tags} onChange={tags => set({ tags })} groups={groups} />
      <Field label="备注"><textarea maxLength={4000} value={v.note} onChange={e => set({ note: e.target.value })} placeholder="排队情况、停车、适合几个人……" /></Field>
      <PhotoStrip ids={v.photos} onRemove={id => set({ photos: v.photos.filter(p => p !== id) })} />
      <PhotoInput onAdd={ids => setV(x => ({ ...x, photos: [...x.photos, ...ids] }))} />
      <div className="row form-actions">
        <Button type="submit" disabled={busy}>{busy ? '保存中…' : submitLabel}</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>取消</Button>}
      </div>
    </form>
  );
}

function DishForm({ restaurantId, dish, groups, onDone, onCancel }: { restaurantId: string; dish?: Dish; groups: TagGroup[]; onDone: () => void; onCancel: () => void }) {
  const [v, setV] = useState({ name: dish?.name ?? '', variant: dish?.variant ?? '', note: dish?.note ?? '', tags: dish?.tags ?? [], photos: dish?.photos ?? [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(dish?.version ?? 0);
  const [key] = useState(newKey);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (dish) await api(`/dishes/${dish.id}`, { method: 'PUT', json: { ...v, version: version.current } });
      else await api('/dishes', { method: 'POST', key, json: { ...v, restaurantId } });
      onDone();
    } catch (x) {
      if (dish && x instanceof ApiError && x.code === 'VERSION_CONFLICT') {
        const latest = await api<Dish>(`/dishes/${dish.id}`).catch(() => null);
        if (latest) version.current = latest.version;
        setError(`其他设备刚修改过这道菜${latest ? `（最新名称：${latest.name}）` : ''}。你的输入仍保留，再次保存将以你的内容为准。`);
      } else setError(message(x));
    } finally { setBusy(false); }
  }
  return (
    <form className="card inset" onSubmit={submit}>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="菜名"><input required maxLength={120} value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="规格/做法（可选）"><input maxLength={100} value={v.variant} onChange={e => setV({ ...v, variant: e.target.value })} placeholder="例如：微辣、大份" /></Field>
      <TagInput label="菜品标签" value={v.tags} onChange={tags => setV({ ...v, tags })} groups={groups} />
      <Field label="备注"><textarea maxLength={4000} value={v.note} onChange={e => setV({ ...v, note: e.target.value })} /></Field>
      <PhotoStrip ids={v.photos} onRemove={id => setV({ ...v, photos: v.photos.filter(p => p !== id) })} />
      <PhotoInput onAdd={ids => setV(x => ({ ...x, photos: [...x.photos, ...ids] }))} />
      <div className="row form-actions"><Button type="submit" disabled={busy}>{busy ? '保存中…' : dish ? '保存菜品' : '添加这道菜'}</Button><Button variant="ghost" onClick={onCancel}>取消</Button></div>
    </form>
  );
}

function OpinionForm({ restaurantId, people, dishes, onDone, onCancel }: { restaurantId: string; people: Person[]; dishes: Dish[]; onDone: () => void; onCancel: () => void }) {
  const active = people.filter(p => !p.archived);
  const [personId, setPersonId] = useState(active[0]?.id ?? '');
  const [dishId, setDishId] = useState('');
  const [rating, setRating] = useState<{ feeling: Feeling | null; again: boolean | null }>({ feeling: null, again: null });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(newKey);
  const pname = active.find(p => p.id === personId)?.name ?? '';
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rating.feeling === null && rating.again === null && !note.trim()) { setError('请至少选择一种感受或写一句评价'); return; }
    setBusy(true); setError('');
    try {
      await api('/opinions', { method: 'POST', key, json: { restaurantId, personId, ...(dishId ? { dishId } : {}), ...rating, note: note.trim() } });
      onDone();
    } catch (x) { setError(message(x)); } finally { setBusy(false); }
  }
  return (
    <form className="card inset" onSubmit={submit}>
      <p className="muted small">记不清哪天吃的也没关系，口味记忆会直接记在这家店。</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="谁的感受"><select value={personId} onChange={e => setPersonId(e.target.value)}>{active.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="评价对象"><select value={dishId} onChange={e => setDishId(e.target.value)}><option value="">整家店</option>{dishes.filter(d => !d.archived).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      <FeelingPicker name={pname} feeling={rating.feeling} again={rating.again} onChange={setRating} />
      <Field label="一句话（可选）"><input maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></Field>
      <div className="row form-actions"><Button type="submit" disabled={busy || !personId}>{busy ? '保存中…' : '保存评价'}</Button><Button variant="ghost" onClick={onCancel}>取消</Button></div>
    </form>
  );
}

export function RestaurantPage({ id }: { id: string }) {
  const ov = useLoad(() => api<Overview>(`/restaurants/${encodeURIComponent(id)}/overview`), [id]);
  const groups = useLoad(() => api<TagGroup[]>('/tag-options'), []);
  const [panel, setPanel] = useState<'' | 'edit' | 'dish' | 'opinion' | `dish:${string}`>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const version = useRef(0);

  if (!ov.data) return <><PageHead title="店铺" back="/library" /><LoadState error={ov.error} onRetry={ov.reload} /></>;
  const { restaurant: r, dishes, meals, opinions, people } = ov.data;
  if (!version.current || version.current < r.version) version.current = r.version;
  const tagGroups = groups.data ?? [];
  const pname = (pid: string) => people.find(p => p.id === pid)?.name ?? '某人';
  const dname = (did?: string) => dishes.find(d => d.id === did)?.name ?? '已删除的菜';
  const latestByPerson = (list: Opinion[]) => { const seen = new Map<string, Opinion>(); for (const o of list) if (!seen.has(o.personId)) seen.set(o.personId, o); return [...seen.values()]; };
  const dishOps = (did: string) => opinions.filter(o => o.dishId === did);
  const good = dishes.filter(d => !d.archived && latestByPerson(dishOps(d.id)).some(isPositive) && !latestByPerson(dishOps(d.id)).some(isNegative));
  const bad = dishes.filter(d => latestByPerson(dishOps(d.id)).some(isNegative));
  const shopOps = latestByPerson(opinions.filter(o => !o.dishId));
  const done = (text: string) => { setPanel(''); setNotice(text); setError(''); ov.reload(); groups.reload(); };

  async function saveRestaurant(v: RestaurantInput) {
    try {
      await api(`/restaurants/${r.id}`, { method: 'PUT', json: { ...v, version: version.current } });
      done('已保存店铺信息');
    } catch (x) {
      if (x instanceof ApiError && x.code === 'VERSION_CONFLICT') {
        const latest = await api<Restaurant>(`/restaurants/${r.id}`).catch(() => null);
        if (latest) version.current = latest.version;
        throw new Error(`其他设备刚修改过这家店${latest ? `（最新店名：${latest.name}）` : ''}。你的输入仍保留，再次保存将以你的内容为准。`);
      }
      throw x;
    }
  }
  async function act(fn: () => Promise<unknown>, ok: string) {
    setError('');
    try { await fn(); done(ok); } catch (x) { setError(message(x)); }
  }

  return (
    <>
      <PageHead title={r.name} back="/library" sub={<>{r.archived && <span className="badge">已归档</span>} {r.tags.join(' · ')}</>} />
      {notice && <Notice tone="ok">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {panel === 'edit' ? (
        <RestaurantForm initial={{ name: r.name, address: r.address, location: r.location ?? null, link: r.link, note: r.note, tags: r.tags, budget: r.budget, photos: r.photos }} groups={tagGroups} submitLabel="保存店铺" onSubmit={saveRestaurant} onCancel={() => setPanel('')} />
      ) : (
        <section className="card">
          {r.address && <p className="meta"><MapPin size={16} aria-hidden />{r.address}</p>}
          {r.location ? <p><Link to={`/?view=map&restaurant=${r.id}`}>在地图上查看这家店</Link></p> : <p className="muted small">还未标记地图位置，可通过编辑补充。</p>}
          {r.budget !== null && <p className="meta">人均约 {r.budget} 元</p>}
          {r.link && <p className="meta"><ExternalLink size={16} aria-hidden /><a href={r.link} target="_blank" rel="noopener noreferrer">打开店铺链接</a></p>}
          {r.note && <p className="note">{r.note}</p>}
          <PhotoStrip ids={r.photos} />
          <div className="row">
            <Button onClick={() => navigate(`/record?restaurant=${r.id}`)}><Plus size={18} aria-hidden />再记一顿</Button>
            <Button variant="ghost" onClick={() => setPanel('edit')}><Pencil size={16} aria-hidden />编辑</Button>
            {r.archived
              ? <Button variant="ghost" onClick={() => act(() => api(`/restaurants/${r.id}`, { method: 'PUT', json: { archived: false, version: version.current } }), '已恢复这家店')}>恢复</Button>
              : <Button variant="ghost" onClick={() => { if (confirm('归档后不会出现在推荐和新记录里，历史仍保留。确定归档？')) void act(() => api(`/restaurants/${r.id}`, { method: 'DELETE' }), '已归档'); }}><Archive size={16} aria-hidden />归档</Button>}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="good-title">
        <h2 className="section-title" id="good-title">值得点</h2>
        {good.length ? <ul className="plain-list">{good.map(d => <li key={d.id}><strong>{d.name}</strong><span className="muted small">{latestByPerson(dishOps(d.id)).filter(isPositive).map(o => pname(o.personId)).join('、')} 推荐</span></li>)}</ul>
          : <p className="muted small">还没有被评为喜欢或想再吃的菜。</p>}
        {bad.length > 0 && (<>
          <h3 className="sub-title">需要避开</h3>
          <ul className="plain-list avoid-list">{bad.map(d => <li key={d.id}><strong>{d.name}</strong><span className="small">{latestByPerson(dishOps(d.id)).filter(isNegative).map(o => `${pname(o.personId)}：${feelingText(o.feeling, o.again)}`).join('；')}</span></li>)}</ul>
        </>)}
      </section>

      <section className="section" aria-labelledby="feel-title">
        <div className="section-title"><h2 id="feel-title">大家的感受</h2><Button variant="soft" onClick={() => setPanel(panel === 'opinion' ? '' : 'opinion')}>补一条评价</Button></div>
        {panel === 'opinion' && <OpinionForm restaurantId={r.id} people={people} dishes={dishes} onDone={() => done('已保存评价')} onCancel={() => setPanel('')} />}
        {shopOps.length ? <ul className="op-list">{shopOps.map(o => <li key={o.id}><strong>{pname(o.personId)}</strong>：{feelingText(o.feeling, o.again)}{o.note && ` — ${o.note}`}</li>)}</ul>
          : <p className="muted small">还没有整体评价。每个人的感受分开记录，不会合并成一个平均分。</p>}
      </section>

      <section className="section" aria-labelledby="dish-title">
        <div className="section-title"><h2 id="dish-title">菜品</h2><Button variant="soft" onClick={() => setPanel(panel === 'dish' ? '' : 'dish')}>添加菜品</Button></div>
        {panel === 'dish' && <DishForm restaurantId={r.id} groups={tagGroups} onDone={() => done('已添加菜品')} onCancel={() => setPanel('')} />}
        {dishes.length ? (
          <div className="card">
            {dishes.map(d => panel === `dish:${d.id}` ? (
              <DishForm key={d.id} restaurantId={r.id} dish={d} groups={tagGroups} onDone={() => done('已保存菜品')} onCancel={() => setPanel('')} />
            ) : (
              <div className="dish-row" key={d.id}>
                <div className="list-main">
                  <h3>{d.name}{d.variant && <span className="muted small">（{d.variant}）</span>}{d.archived && <span className="badge">已归档</span>}</h3>
                  {d.tags.length > 0 && <p className="tags-line">{d.tags.join(' · ')}</p>}
                  {d.origin && <details className="small">
                    <summary>菜名来源 · {(d.origin.evidence ?? [d.origin]).length} 个来源 · 非完整菜单</summary>
                    {(d.origin.evidence ?? [d.origin]).map(origin => <p key={origin.url}><a href={origin.url} target="_blank" rel="noopener noreferrer">{origin.publisher}</a> · {origin.scope === 'branch' ? origin.restaurantName ?? '分店参考' : '品牌参考'} · {origin.publishedAt ?? '发布日期未知'} · 核查于 {origin.checkedAt}{origin.rawName && ` · 原名：${origin.rawName}`}</p>)}
                  </details>}
                  {latestByPerson(dishOps(d.id)).map(o => <p className="small" key={o.id}>{pname(o.personId)}：{feelingText(o.feeling, o.again)}{o.note && ` — ${o.note}`}</p>)}
                  <PhotoStrip ids={d.photos} />
                </div>
                <div className="row">
                  <Button variant="ghost" aria-label={`编辑 ${d.name}`} onClick={() => setPanel(`dish:${d.id}`)}><Pencil size={16} aria-hidden /></Button>
                  {!d.archived && <Button variant="ghost" aria-label={`归档 ${d.name}`} onClick={() => { if (confirm(`归档「${d.name}」？历史评价会保留。`)) void act(() => api(`/dishes/${d.id}`, { method: 'DELETE' }), '已归档菜品'); }}><Archive size={16} aria-hidden /></Button>}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="muted small">还没有菜品，记一顿或手动添加。</p>}
      </section>

      <section className="section" aria-labelledby="meal-title">
        <h2 className="section-title" id="meal-title">就餐记录</h2>
        {meals.length ? (
          <ol className="timeline">
            {meals.map(m => (
              <li className="card" key={m.id}>
                <div className="split">
                  <div><strong>{fmtTime(m.date)}</strong> <span className="badge">{m.mode === 'takeaway' ? '外卖' : '堂食'}</span>{m.amount !== null && <span className="muted small"> {yuan(m.amount)}</span>}</div>
                  <div className="row">
                    <Button variant="ghost" aria-label="编辑这次记录" onClick={() => navigate(`/record?meal=${encodeURIComponent(m.id)}`)}><Pencil size={16} aria-hidden /></Button>
                    <Button variant="ghost" aria-label="删除这次记录" onClick={() => { if (confirm('删除这次就餐记录和其中的评价？')) void act(() => api(`/meals/${m.id}`, { method: 'DELETE' }), '已删除这次记录'); }}><Trash2 size={16} aria-hidden /></Button>
                  </div>
                </div>
                <p className="small muted">和 {m.people.map(pname).join('、') || '—'}{m.dishes.length > 0 && ` · 吃了 ${m.dishes.map(dname).join('、')}`}</p>
                {m.opinions.length > 0 && <ul className="op-list">{m.opinions.map(o => <li key={o.id}>{pname(o.personId)} · {o.dishId ? dname(o.dishId) : '整体'}：{feelingText(o.feeling, o.again)}{o.note && ` — ${o.note}`}</li>)}</ul>}
                {m.note && <p className="note">{m.note}</p>}
                <PhotoStrip ids={m.photos} />
              </li>
            ))}
          </ol>
        ) : <p className="muted small">还没有就餐记录。</p>}
      </section>
      <p className="center"><Link to="/library" className="muted small">返回记忆库</Link></p>
    </>
  );
}
