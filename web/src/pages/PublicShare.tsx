import { useEffect, useState } from 'react';
import { ExternalLink, MapPin } from 'lucide-react';
import { api, ApiError, message, type PublicOpinion, type PublicSnapshot } from '../api.js';
import { Empty, PhotoStrip, feelingText, fmtTime } from '../components/Ui.js';

const opinionLine = (o: PublicOpinion) => `${o.person ? `${o.person}：` : ''}${feelingText(o.feeling, o.again)}${o.note ? ` — ${o.note}` : ''}`;

export function SnapshotView({ data, photoSrc }: { data: PublicSnapshot; photoSrc: (id: string) => string }) {
  return (
    <>
      {data.restaurants.map((r, i) => (
        <article className="card share-card" key={i}>
          <h2>{r.name}</h2>
          {r.tags.length > 0 && <p className="tags-line">{r.tags.join(' · ')}</p>}
          {r.address && <p className="meta"><MapPin size={16} aria-hidden />{r.address}</p>}
          {r.link && <p className="meta"><ExternalLink size={16} aria-hidden /><a href={r.link} target="_blank" rel="noopener noreferrer nofollow">店铺链接</a></p>}
          <PhotoStrip ids={r.photos} src={photoSrc} />
          {r.opinions.length > 0 && <ul className="op-list">{r.opinions.map((o, j) => <li key={j}>{opinionLine(o)}</li>)}</ul>}
          <h3 className="sub-title">推荐菜</h3>
          {r.dishes.length ? (
            <ul className="share-dishes">
              {r.dishes.map((d, j) => (
                <li key={j}>
                  <strong>{d.name}</strong>{d.variant && <span className="muted small">（{d.variant}）</span>}
                  {d.tags.length > 0 && <span className="tags-line"> {d.tags.join(' · ')}</span>}
                  {d.opinions.map((o, k) => <p className="small" key={k}>{opinionLine(o)}</p>)}
                  <PhotoStrip ids={d.photos} src={photoSrc} />
                </li>
              ))}
            </ul>
          ) : <p className="muted small">这家店没有选入推荐菜。</p>}
        </article>
      ))}
    </>
  );
}

export function PublicShare({ token }: { token: string }) {
  const [state, setState] = useState<{ data?: PublicSnapshot; error?: string }>({});
  useEffect(() => {
    document.title = 'WeFood 分享';
    api<PublicSnapshot>(`/public/shares/${encodeURIComponent(token)}`)
      .then(data => setState({ data }))
      .catch(e => setState({ error: e instanceof ApiError && e.status === 404 ? '这个分享不存在，可能链接不完整' : message(e) }));
  }, [token]);
  const src = (id: string) => `/api/public/shares/${encodeURIComponent(token)}/photos/${encodeURIComponent(id)}`;
  return (
    <div className="public">
      <p className="brand">WEFOOD · 朋友的私人食记</p>
      {state.error ? <Empty title={state.error}>需要的话，请联系分享者重新发一个链接。</Empty>
        : !state.data ? <p className="muted">正在打开分享…</p>
        : (<>
          <header className="public-head">
            <h1>{state.data.title}</h1>
            <p className="muted small">{state.data.expiresAt ? `有效期至 ${fmtTime(state.data.expiresAt)}（北京时间）` : '长期有效，分享者可以随时撤销'}</p>
          </header>
          <SnapshotView data={state.data} photoSrc={src} />
          <p className="muted small center">内容是分享时保存的快照，由分享者维护；链接可能被转发。</p>
        </>)}
    </div>
  );
}
