import { useState, type ReactNode } from 'react';
import type { DishCandidateResult, DishCandidate, SourcePlace } from '../../../shared/dishReferences.js';
import { Button, Field, Notice } from './Ui.js';

export function DishReferences({ data, error, loading, disabled, onRetry, onLoad, renderDish }: {
  data?: DishCandidateResult; error?: string; loading: boolean; disabled: boolean; onRetry: () => void;
  onLoad: (url: string, confirm?: SourcePlace) => void; renderDish: (candidate: DishCandidate) => ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const sourceUrl = url ?? data?.sourceUrl ?? '';
  return <>
    <section aria-label="菜品来源" className="card inset">
      <h3 className="sub-title">获取更多菜品</h3>
      <p className="small">融合品牌文章与分店特色菜，同名去重、保留来源。没有公众号也可添加公开餐厅页。</p>
      <Field label="携程公开餐厅链接" hint="目前支持 you.ctrip.com 的餐厅详情页。只读取公开菜名，不访问私人账号。">
        <input type="url" maxLength={2000} value={sourceUrl} placeholder="https://you.ctrip.com/food/…/….html" onChange={e => setUrl(e.target.value)} />
      </Field>
      <Button variant="soft" disabled={disabled || loading || !sourceUrl.trim()} onClick={() => onLoad(sourceUrl.trim())}>{loading ? '获取中…' : '获取更多菜品'}</Button>
      {error && <Notice tone="error" action={<Button variant="soft" onClick={onRetry}>重试参考菜品</Button>}>{error}；已有菜品和输入仍保留。</Notice>}
      <ul className="plain-list small" aria-label="来源状态">
        {data?.sources.map(source => <li key={source.channel}>
          <strong>{source.channel === 'ctrip' ? '携程分店页' : '品牌公众号'}</strong>
          <span>{source.message}{source.count > 0 ? ` · ${source.count} 项` : ''}</span>
          {source.origin && <>
            <span className="field-hint">{source.origin.scope === 'branch' ? '分店级参考' : '品牌级参考，具体分店与当日供应未核实'}。{source.origin.publishedAt ? `资料发布于 ${source.origin.publishedAt}，` : '发布日期未知，'}核查于 {source.origin.checkedAt}，可能已经调整。</span>
            <a href={source.origin.url} target="_blank" rel="noopener noreferrer">查看来源：{source.origin.publisher}</a>
          </>}
        </li>)}
      </ul>
      {data?.pending && <Notice tone="warn">
        <strong>请确认是不是这家分店</strong>
        <p>{data.pending.name}</p><p>{data.pending.address}</p>
        <p className="small">尚未加入候选；不要把其他分店的菜混入本店。</p>
        <Button variant="soft" disabled={loading || disabled} onClick={() => onLoad(data.pending!.url, data.pending)}>确认是这家分店</Button>
      </Notice>}
    </section>
    {!!data?.candidates.length && <section aria-label="公开菜品参考" className="card inset">
      <h3 className="sub-title">公开菜品参考</h3>
      <p className="small">不是完整菜单；先选吃过的菜，再按人评价，也可以不评价。保存后才进入本次记录。</p>
      <p className="small">去重后 {data.candidates.length} 项候选 · 做法、规格不同不合并</p>
      <div className="dish-rating-list">{data.candidates.map(candidate => <div key={candidate.id}>
        {renderDish(candidate)}
        <details className="small">
          <summary>{candidate.origins.length} 个菜名来源{candidate.origins.some(o => o.scope === 'brand') ? ' · 含品牌参考' : ' · 分店参考'}</summary>
          {candidate.origins.map(origin => <p key={origin.url}>
            <a href={origin.url} target="_blank" rel="noopener noreferrer">{origin.publisher}</a> · {origin.scope === 'branch' ? origin.restaurantName : '品牌级参考'} · 原名：{origin.rawName ?? candidate.name}
          </p>)}
        </details>
      </div>)}</div>
      {disabled && <p className="muted small">等已记录菜品加载成功后可选择参考，避免重复添加。</p>}
    </section>}
  </>;
}
