import React, { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Avatar, Empty, Skeleton, SlaChip, useToast } from '../components/ui.jsx'
import { Bars, Gauge, HBars, Line, Spark } from '../components/charts.jsx'
import { get } from '../api.js'
import { fmtDT, fmtSec, go, stageLabel, STAGES, useCountUp, useInterval } from '../util.js'
import { useApp } from '../App.jsx'

const KPI_DEFS = [
  { k: 'received', label: 'Documents received', icon: 'download', fmt: v => Math.round(v), good: 'neutral' },
  { k: 'processed', label: 'Documents processed', icon: 'checkCircle', fmt: v => Math.round(v), good: 'up' },
  { k: 'backlog', label: 'Open backlog', icon: 'layers', fmt: v => Math.round(v), good: 'down', link: { stage: 'to_review' }, live: true },
  { k: 'unassigned', label: 'Unassigned', icon: 'user', fmt: v => Math.round(v), good: 'down', link: { stage: 'to_review', assignee: 'unassigned' }, live: true },
  { k: 'stpRate', label: 'STP rate', icon: 'zap', fmt: v => v.toFixed(1) + '%', good: 'up', hint: 'Documents approved with no human edits' },
  { k: 'accuracy', label: 'Field accuracy', icon: 'target', fmt: v => v.toFixed(1) + '%', good: 'up', hint: 'Fields accepted without correction' },
  { k: 'turnaround', label: 'Avg turnaround', icon: 'clock', fmt: v => v.toFixed(1) + ' h', good: 'down', hint: 'Ingestion to approval' },
  { k: 'slaCompliance', label: 'SLA compliance', icon: 'award', fmt: v => v.toFixed(1) + '%', good: 'up' },
]

export default function Dashboard({ pid }) {
  const { project, meta } = useApp()
  const toast = useToast()
  const [days, setDays] = useState(30)
  const [docType, setDocType] = useState('')
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => {
    setBusy(true)
    return get(`/api/projects/${pid}/dashboard`, { days, docType }).then(setData).catch(e => toast({ kind: 'error', text: e.message })).finally(() => setBusy(false))
  }
  useEffect(() => { load() }, [days, docType])
  useInterval(load, 30000, [days, docType])

  const docLink = q => go(`/p/${pid}/documents`, q)
  if (!data) return <div className="page"><div className="page-head"><h1>Dashboard</h1></div><div className="kpi-grid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skel" style={{ height: 112 }} />)}</div><Skeleton rows={2} h={240} /></div>

  const empty = data.kpis.received === 0 && data.backlog === 0
  const k = data.kpis, prev = data.previous
  const values = { ...k, backlog: data.backlog, unassigned: data.unassigned }
  const sparkOf = key => key === 'stpRate' ? data.stpTrend.map(w => w.stpRate)
    : key === 'received' || key === 'processed' ? data.throughput.map(d => d[key]) : null

  return (
    <div className="page dash">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="muted small">KPIs, SLAs and business insights for {project.name}</div>
        </div>
        <div className="toolbar">
          <div className="seg" role="group" aria-label="Period">
            {[7, 30, 90].map(d => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>Last {d} days</button>)}
          </div>
          <select className="select" value={docType} onChange={e => setDocType(e.target.value)} aria-label="Document type">
            <option value="">All document types</option>
            {meta.catalogue.filter(c => project.docTypes.includes(c.name)).map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
          <span className="muted small">Updated {fmtDT(data.lastRefreshed).slice(11, 16)}</span>
          <button className={'icon-btn bordered' + (busy ? ' spin' : '')} onClick={load} title="Refresh" aria-label="Refresh"><Icon name="refresh" size={17} /></button>
        </div>
      </div>

      {empty ? (
        <Empty icon="dashboard" title="No documents yet" text="Upload documents to start seeing KPIs, SLA status and insights."
          action={<button className="btn primary" onClick={() => docLink({ stage: 'in_progress', upload: 1 })}><Icon name="upload" size={16} />Upload documents</button>} />
      ) : <>
        <div className="kpi-grid">
          {KPI_DEFS.map((d, i) => <Kpi key={d.k} def={d} value={values[d.k]} prev={d.live ? null : prev[d.k]} spark={sparkOf(d.k)} idx={i}
            onClick={d.link ? () => docLink(d.link) : null} />)}
        </div>

        <div className="dash-row r-2-1">
          <section className="card">
            <div className="card-head"><h2>SLA monitor</h2><span className="muted small">Target turnaround {data.sla.targetHours} h</span></div>
            <div className="sla-wrap">
              <div className="sla-left">
                <Gauge value={k.slaCompliance} target={95} />
                <div className="sla-split">
                  {[['on_track', 'On track'], ['at_risk', 'At risk'], ['breached', 'Breached']].map(([s, l]) => (
                    <button key={s} className={`sla-stat s-${s}`} onClick={() => docLink({ stage: 'to_review', sla: s })}>
                      <b>{data.sla[s]}</b><span>{l}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="sla-list">
                <div className="mini-head">Closest to breach</div>
                {data.sla.nearest.length === 0 && <div className="muted small pad-s">Nothing open – great job.</div>}
                {data.sla.nearest.map(d => (
                  <button key={d.id} className="sla-row" onClick={() => go(`/p/${pid}/review/${d.id}`)}>
                    <span className="ellipsis"><b>{d.name}</b><span className="muted small"> · {stageLabel(d.stage)} · {d.assignedTo || 'Unassigned'}</span></span>
                    <SlaChip sla={d.sla} />
                  </button>
                ))}
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-head"><h2>Pipeline</h2><span className="muted small">Documents by stage</span></div>
            <HBars items={STAGES.map(s => ({ label: s.label, value: data.pipeline[s.key], key: s.key, color: `var(--st-${s.key})` }))}
              onClick={it => docLink({ stage: it.key })} />
          </section>
        </div>

        <div className="dash-row r-1-1">
          <section className="card">
            <div className="card-head"><h2>Throughput</h2><span className="muted small">Daily, last {Math.min(days, 30)} days</span></div>
            <Bars data={data.throughput} series={[{ key: 'received', label: 'Received', color: 'var(--c-blue)' }, { key: 'processed', label: 'Processed', color: 'var(--teal)' }]} />
          </section>
          <section className="card">
            <div className="card-head"><h2>Automation trend</h2><span className="muted small">Weekly STP rate</span></div>
            <Line data={data.stpTrend} k="stpRate" target={60} />
          </section>
        </div>

        <div className="dash-row r-1-1-1">
          <section className="card">
            <div className="card-head"><h2>Top corrected fields</h2><span className="muted small">Where reviewers fix the AI most</span></div>
            {data.topCorrected.length ? <HBars items={data.topCorrected.map(c => ({ label: c.label, value: c.count }))} color="var(--c-coral)" />
              : <div className="muted small">No corrections in this period.</div>}
            <p className="insight"><Icon name="sparkle" size={15} />Tune thresholds or add validation rules for these fields in Config to lift STP.</p>
          </section>
          <section className="card">
            <div className="card-head"><h2>Business insights</h2><span className="muted small">Document mix</span></div>
            <HBars items={data.docTypeMix.map(m => ({ label: m.name, value: m.count }))} color="var(--c-purple)" />
            <div className="insight-grid">
              <div><span className="muted small">Rejection rate</span><b>{k.rejectionRate}%</b></div>
              <div><span className="muted small">Docs / day</span><b>{(k.received / days).toFixed(1)}</b></div>
            </div>
            <p className="muted small">Value-based insights (spend, top vendors, duplicates) arrive in version 2.</p>
          </section>
          <Leaderboard rows={data.reviewers} me={meta.user.id} />
        </div>
      </>}
    </div>
  )
}

function Kpi({ def, value, prev, spark, onClick, idx }) {
  const v = useCountUp(value)
  let delta = null
  if (prev !== null && prev !== undefined && prev !== 0) delta = ((value - prev) / Math.abs(prev)) * 100
  const goodDir = def.good
  const cls = delta === null || Math.abs(delta) < 0.5 || goodDir === 'neutral' ? 'flat' : (delta > 0) === (goodDir === 'up') ? 'good' : 'bad'
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={'kpi' + (onClick ? ' link' : '')} onClick={onClick || undefined} style={{ animationDelay: `${idx * 40}ms` }} title={def.hint}>
      <div className="kpi-top"><span className="kpi-ic"><Icon name={def.icon} size={16} /></span><span className="kpi-l">{def.label}</span></div>
      <div className="kpi-v">{def.fmt(v)}</div>
      <div className="kpi-bot">
        {delta !== null ? <span className={'delta ' + cls}>{delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta).toFixed(1)}%</span>
          : <span className="muted small">{def.live ? 'right now' : '—'}</span>}
        {delta !== null && <span className="muted small"> vs prev.</span>}
        {spark && <Spark values={spark} />}
      </div>
    </Tag>
  )
}

function Leaderboard({ rows, me }) {
  return (
    <section className="card">
      <div className="card-head"><h2><Icon name="trophy" size={17} /> Leaderboard</h2><span className="muted small">Points this period</span></div>
      <ol className="leader">
        {rows.map((r, i) => (
          <li key={r.id} className={r.id === me ? 'me' : ''}>
            <span className={'rank r' + (i + 1)}>{i + 1}</span>
            <Avatar id={r.id} size={28} />
            <div className="leader-main">
              <div className="leader-name">{r.name}{r.id === me && <span className="muted small"> (you)</span>}</div>
              <div className="badges">{r.badges.map(b => <span key={b.key} className={'bdg b-' + b.key} title={b.hint}><Icon name="award" size={11} />{b.label}</span>)}</div>
              <div className="muted tiny">{r.completed} done · {r.open} open · SLA {r.slaMet}% · avg {fmtSec(r.avgHandlingSec)}</div>
            </div>
            <span className="pts">{r.points}<small>pts</small></span>
          </li>
        ))}
      </ol>
      <p className="muted tiny">Points reward accurate, on-time reviews (10 per approval, +5 within SLA). Leaderboards are for motivation, not performance evaluation.</p>
    </section>
  )
}
