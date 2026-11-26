import React, { useState } from 'react'
import { fmtDate } from '../util.js'

/* Lightweight SVG charts (no chart library needed for v1). */

export function Bars({ data, series, height = 190 }) {
  const [hover, setHover] = useState(null)
  const W = 640, H = height, padL = 34, padB = 22, padT = 10
  const max = Math.max(1, ...data.flatMap(d => series.map(s => d[s.key])))
  const nice = Math.ceil(max / 5) * 5
  const bw = (W - padL - 8) / data.length
  const inner = Math.min(14, (bw - 4) / series.length)
  const y = v => padT + (H - padT - padB) * (1 - v / nice)
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Daily throughput chart">
        {[0, 0.5, 1].map(k => (
          <g key={k}>
            <line x1={padL} x2={W} y1={y(nice * k)} y2={y(nice * k)} className="grid" />
            <text x={padL - 6} y={y(nice * k) + 4} className="axis" textAnchor="end">{Math.round(nice * k)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = padL + i * bw + (bw - inner * series.length) / 2
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {series.map((s, j) => (
                <rect key={s.key} className="bar" x={x0 + j * inner} y={y(d[s.key])} width={inner - 1.5}
                  height={Math.max(0, H - padB - y(d[s.key]))} rx="1.5" fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45}
                  style={{ animationDelay: `${i * 12}ms` }} />
              ))}
              {(i % Math.ceil(data.length / 7) === 0) && <text x={padL + i * bw + bw / 2} y={H - 6} className="axis" textAnchor="middle">{fmtDate(d.day).slice(0, 5)}</text>}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${((padL + hover * bw + bw / 2) / W) * 100}%` }}>
          <b>{fmtDate(data[hover].day)}</b>
          {series.map(s => <div key={s.key}><i style={{ background: s.color }} />{s.label}: {data[hover][s.key]}</div>)}
        </div>
      )}
      <div className="legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
    </div>
  )
}

export function Line({ data, k, height = 190, target, unit = '%' }) {
  const [hover, setHover] = useState(null)
  const W = 640, H = height, padL = 34, padB = 22, padT = 12
  const pts = data.map((d, i) => ({ i, v: d[k], t: d.week }))
  const max = 100
  const x = i => padL + (W - padL - 14) * (i / Math.max(1, data.length - 1))
  const y = v => padT + (H - padT - padB) * (1 - v / max)
  const valid = pts.filter(p => p.v !== null)
  const path = valid.map((p, j) => `${j ? 'L' : 'M'}${x(p.i)},${y(p.v)}`).join(' ')
  const area = valid.length ? `${path} L${x(valid[valid.length - 1].i)},${y(0)} L${x(valid[0].i)},${y(0)} Z` : ''
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="STP rate trend">
        {[0, 50, 100].map(v => (
          <g key={v}><line x1={padL} x2={W} y1={y(v)} y2={y(v)} className="grid" /><text x={padL - 6} y={y(v) + 4} className="axis" textAnchor="end">{v}</text></g>
        ))}
        {target != null && <><line x1={padL} x2={W} y1={y(target)} y2={y(target)} className="target" /><text x={W - 4} y={y(target) - 5} className="axis" textAnchor="end">Target {target}{unit}</text></>}
        <path d={area} className="area" />
        <path d={path} className="line draw" />
        {valid.map(p => (
          <g key={p.i} onMouseEnter={() => setHover(p.i)} onMouseLeave={() => setHover(null)}>
            <circle cx={x(p.i)} cy={y(p.v)} r={hover === p.i ? 5 : 3.2} className="pt" />
            <rect x={x(p.i) - 20} y={padT} width="40" height={H - padT - padB} fill="transparent" />
          </g>
        ))}
        {pts.filter((_, i) => i % 3 === 0).map(p => <text key={p.i} x={x(p.i)} y={H - 6} className="axis" textAnchor="middle">{fmtDate(p.t).slice(0, 5)}</text>)}
      </svg>
      {hover !== null && <div className="tip" style={{ left: `${(x(hover) / W) * 100}%` }}><b>Week to {fmtDate(pts[hover].t)}</b><div>STP rate: {pts[hover].v}{unit}</div></div>}
    </div>
  )
}

export function HBars({ items, color = 'var(--teal)', onClick, unit = '' }) {
  const max = Math.max(1, ...items.map(i => i.value))
  return (
    <div className="hbars">
      {items.map((it, i) => (
        <button key={it.label} className="hbar" onClick={() => onClick?.(it)} disabled={!onClick}>
          <span className="hbar-l">{it.label}</span>
          <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(it.value / max) * 100}%`, background: it.color || color, animationDelay: `${i * 40}ms` }} /></span>
          <span className="hbar-v">{it.value}{unit}</span>
        </button>
      ))}
    </div>
  )
}

export function Spark({ values, color = 'var(--teal)' }) {
  const v = values.filter(x => x !== null && x !== undefined)
  if (v.length < 2) return null
  const max = Math.max(...v), min = Math.min(...v)
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * 80},${22 - ((y - min) / (max - min || 1)) * 18}`).join(' ')
  return <svg className="spark" viewBox="0 0 80 24" aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>
}

export function Gauge({ value, target }) {
  const r = 52, c = Math.PI * r
  const ok = value >= target
  return (
    <svg viewBox="0 0 130 78" className="gauge" role="img" aria-label={`SLA compliance ${value}%`}>
      <path d="M13 70 A52 52 0 0 1 117 70" className="g-track" />
      <path d="M13 70 A52 52 0 0 1 117 70" className={'g-fill ' + (ok ? 'ok' : 'bad')} style={{ strokeDasharray: c, strokeDashoffset: c * (1 - value / 100) }} />
      <text x="65" y="62" textAnchor="middle" className="g-val">{value}%</text>
      <text x="65" y="76" textAnchor="middle" className="g-sub">target {target}%</text>
    </svg>
  )
}
