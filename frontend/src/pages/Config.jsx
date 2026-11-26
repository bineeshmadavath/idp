import React, { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Skeleton, Toggle, useToast } from '../components/ui.jsx'
import { get, post, put } from '../api.js'
import { fmtDT } from '../util.js'
import { useApp } from '../App.jsx'

const TYPES = [['text', 'Text'], ['date', 'Date'], ['currency', 'Currency'], ['number', 'Number'], ['address', 'Address']]

export default function Config({ pid }) {
  const { meta, refreshProjects } = useApp()
  const toast = useToast()
  const [saved, setSaved] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [tab, setTab] = useState('types')
  const [typeKey, setTypeKey] = useState(null)
  const [sim, setSim] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    get(`/api/projects/${pid}/config`).then(c => { setSaved(c); setCfg(structuredClone(c)); setTypeKey(c.docTypes[0]?.key) })
  }, [pid])
  const dirty = useMemo(() => saved && JSON.stringify(saved) !== JSON.stringify(cfg), [saved, cfg])
  useEffect(() => { setSim(null) }, [cfg?.thresholds, cfg?.docTypes])

  if (!cfg) return <div className="page"><Skeleton rows={6} /></div>
  const type = cfg.docTypes.find(t => t.key === typeKey)
  const upd = fn => setCfg(c => { const n = structuredClone(c); fn(n); return n })
  const updType = fn => upd(c => fn(c.docTypes.find(t => t.key === typeKey)))
  const missing = meta.catalogue.filter(c => !cfg.docTypes.some(t => t.key === c.key))

  const publish = async () => {
    setBusy(true)
    try {
      const c = await put(`/api/projects/${pid}/config`, { ...cfg, note: note || undefined })
      setSaved(c); setCfg(structuredClone(c)); setNote('')
      toast({ kind: 'success', text: `Configuration v${c.version} published`, sub: 'New thresholds apply immediately to documents awaiting review.' })
      refreshProjects()
    } catch (e) { toast({ kind: 'error', text: e.message }) } finally { setBusy(false) }
  }
  const runSim = async () => setSim(await post(`/api/projects/${pid}/config/simulate`, { thresholds: cfg.thresholds, docTypes: cfg.docTypes }))

  return (
    <div className="page cfg">
      <div className="page-head">
        <div>
          <h1>Project configuration <span className="ver">v{saved.version}</span></h1>
          <div className="muted small">Document types, fields of interest, accuracy thresholds and SLAs. Changes are versioned.</div>
        </div>
      </div>
      <div className="tabs">
        {[['types', 'Document types & fields', 'documents'], ['thresholds', 'Accuracy thresholds', 'target'], ['sla', 'SLA & engagement', 'clock'], ['history', 'Version history', 'layers']].map(([k, l, ic]) => (
          <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}><Icon name={ic} size={17} />{l}</button>
        ))}
      </div>

      {tab === 'types' && (
        <div className="cfg-types">
          <aside className="card type-list">
            <div className="card-head"><h2>Document types</h2></div>
            <p className="muted tiny">The system identifies the type of each document automatically and extracts only that type’s fields.</p>
            {cfg.docTypes.map(t => (
              <div key={t.key} className={'type-item' + (t.key === typeKey ? ' on' : '')} onClick={() => setTypeKey(t.key)}>
                <div><b>{t.name}</b><div className="muted tiny">{t.fields.length} fields · {t.fields.filter(f => f.mandatory).length} mandatory</div></div>
                <span onClick={e => e.stopPropagation()}><Toggle checked={t.active} onChange={v => upd(c => { c.docTypes.find(x => x.key === t.key).active = v })} title={t.active ? 'Active' : 'Inactive'} /></span>
              </div>
            ))}
            {missing.length > 0 && (
              <div className="add-type">
                <span className="muted tiny">Add from catalogue</span>
                {missing.map(m => (
                  <button key={m.key} className="btn sm" onClick={() => {
                    upd(c => c.docTypes.push({ key: m.key, name: m.name, active: true, table: m.table, fields: m.fields.map(f => ({ ...f, threshold: null })) }))
                    setTypeKey(m.key)
                  }}><Icon name="plus" size={14} />{m.name}</button>
                ))}
              </div>
            )}
            <div className="type-item other"><div><b>Other / Unclassified</b><div className="muted tiny">Fallback when no type matches or confidence is below {cfg.thresholds.classification}%</div></div></div>
          </aside>

          {type && (
            <section className="card fields-cfg">
              <div className="card-head">
                <h2>Fields of interest – {type.name}</h2>
                <button className="btn sm" onClick={() => updType(t => t.fields.push({ key: `custom_${t.fields.length + 1}`, label: 'New field', type: 'text', mandatory: false, threshold: null }))}><Icon name="plus" size={14} />Add field</button>
              </div>
              <table className="ftable">
                <thead><tr><th>Label</th><th>Key</th><th>Data type</th><th className="ta-c">Mandatory</th><th>Threshold</th><th /></tr></thead>
                <tbody>
                  {type.fields.map((f, i) => {
                    const def = f.mandatory ? Math.max(cfg.thresholds.extraction, cfg.thresholds.mandatory) : cfg.thresholds.extraction
                    return (
                      <tr key={i}>
                        <td><input value={f.label} onChange={e => updType(t => { t.fields[i].label = e.target.value })} aria-label="Field label" /></td>
                        <td><code>{f.key}</code></td>
                        <td><select className="select sm" value={f.type} onChange={e => updType(t => { t.fields[i].type = e.target.value })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                        <td className="ta-c"><Toggle checked={f.mandatory} onChange={v => updType(t => { t.fields[i].mandatory = v })} /></td>
                        <td>
                          <div className="thr-in">
                            <input type="number" min="0" max="100" placeholder={`${def}`} value={f.threshold ?? ''} aria-label="Field threshold override"
                              onChange={e => updType(t => { t.fields[i].threshold = e.target.value === '' ? null : Math.max(0, Math.min(100, +e.target.value)) })} />
                            <span className="muted tiny">{f.threshold == null ? 'default' : 'override'}</span>
                          </div>
                        </td>
                        <td><button className="icon-btn sm" onClick={() => updType(t => t.fields.splice(i, 1))} aria-label="Remove field" title="Remove field"><Icon name="trash" size={15} /></button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="muted tiny">Mandatory (must-have) fields must be present and valid before a document can be approved or sent. Leave the threshold empty to inherit the project default.</p>
              {type.table?.length > 0 && <div className="muted small">Table: <b>Line items</b> – columns {type.table.join(', ')}</div>}
            </section>
          )}
        </div>
      )}

      {tab === 'thresholds' && (
        <div className="cfg-thr">
          <section className="card">
            <div className="card-head"><h2>Accuracy thresholds</h2></div>
            <p className="muted small">Model confidence below these values sends a document to human review. Field-level overrides (Document types tab) win over these defaults.</p>
            {[['classification', 'Classification confidence', 'Minimum confidence to accept the automatically identified document type'],
              ['extraction', 'Field extraction confidence', 'Default for every field of interest and table row'],
              ['mandatory', 'Mandatory-field confidence', 'Stricter minimum applied to must-have fields']].map(([k, l, h]) => (
              <div key={k} className="slider-row">
                <div><b>{l}</b><div className="muted tiny">{h}</div></div>
                <input type="range" min="50" max="100" value={cfg.thresholds[k]} onChange={e => upd(c => { c.thresholds[k] = +e.target.value })} aria-label={l} />
                <span className="slider-v">{cfg.thresholds[k]}%</span>
              </div>
            ))}
            <div className="stp-rule"><Icon name="zap" size={16} /><span><b>STP rule:</b> a document is approved automatically when its type confidence ≥ {cfg.thresholds.classification}%, every field meets its threshold and format, and every mandatory field is present.</span></div>
          </section>
          <section className="card sim">
            <div className="card-head"><h2>Impact simulation</h2></div>
            <p className="muted small">Re-scores documents processed in the last 30 days against the proposed thresholds.</p>
            <button className="btn" onClick={runSim}><Icon name="zap" size={16} />Run simulation</button>
            {sim && (
              <div className="sim-out">
                <div><span className="muted small">Current STP</span><b>{sim.currentStp}%</b></div>
                <Icon name="chevRight" size={20} />
                <div><span className="muted small">Proposed STP</span><b className={sim.proposedStp >= sim.currentStp ? 'green' : 'red'}>{sim.proposedStp}%</b></div>
                <div><span className="muted small">Human reviews / day</span><b>{sim.reviewPerDay}</b></div>
                <div className="muted tiny full-row">Based on {sim.documents} documents. Lower thresholds raise automation but let more errors through – check field accuracy on the dashboard.</div>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'sla' && (
        <div className="cfg-thr">
          <section className="card">
            <div className="card-head"><h2>Service levels</h2></div>
            <div className="slider-row"><div><b>End-to-end turnaround</b><div className="muted tiny">Ingestion → approved</div></div>
              <input type="range" min="2" max="72" value={cfg.sla.turnaroundHours} onChange={e => upd(c => { c.sla.turnaroundHours = +e.target.value })} aria-label="Turnaround hours" /><span className="slider-v">{cfg.sla.turnaroundHours} h</span></div>
            <div className="slider-row"><div><b>At-risk alert</b><div className="muted tiny">Flag documents after this share of SLA time is used</div></div>
              <input type="range" min="50" max="95" step="5" value={cfg.sla.atRiskPct} onChange={e => upd(c => { c.sla.atRiskPct = +e.target.value })} aria-label="At-risk percent" /><span className="slider-v">{cfg.sla.atRiskPct}%</span></div>
          </section>
          <section className="card">
            <div className="card-head"><h2>Engagement</h2></div>
            <div className="slider-row"><div><b>Gamification</b><div className="muted tiny">Points, badges and leaderboard on the dashboard</div></div><span /><Toggle checked={cfg.gamification} onChange={v => upd(c => { c.gamification = v })} /></div>
          </section>
        </div>
      )}

      {tab === 'history' && (
        <section className="card">
          <div className="card-head"><h2>Version history</h2></div>
          {cfg.history.length === 0 ? <p className="muted">Version 1 – created from catalogue defaults. No changes yet.</p> : (
            <ul className="history">
              {[...cfg.history].reverse().map(h => <li key={h.version}><span className="ver">v{h.version}</span><span>{h.note}</span><span className="muted small">{h.by} · {fmtDT(h.at)}</span></li>)}
              <li><span className="ver">v1</span><span>Created from catalogue defaults</span></li>
            </ul>
          )}
        </section>
      )}

      {dirty && (
        <div className="savebar">
          <Icon name="info" size={16} /><span>Unsaved configuration changes</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Change note (optional)" />
          <span className="grow" />
          <button className="btn" onClick={() => setCfg(structuredClone(saved))}>Discard</button>
          <button className="btn primary" disabled={busy} onClick={publish}>Publish v{saved.version + 1}</button>
        </div>
      )}
    </div>
  )
}
