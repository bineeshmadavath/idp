import React, { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Avatar, FieldStatusIcon, Menu, Modal, SlaChip, Spinner, Toggle, useToast } from '../components/ui.jsx'
import DocRender, { layoutDocument, PAGE_H, PAGE_W } from '../components/DocRender.jsx'
import { get, post, put } from '../api.js'
import { fmtDT, go, stageLabel } from '../util.js'

const SESSION_SEC = 600
const RE = { date: /^\d{2}\/\d{2}\/\d{4}$/, currency: /^\d+(\.\d{2})?$/, number: /^\d+$/ }
const fmtOk = (type, v) => v !== '' && (!RE[type] || RE[type].test(v))
const REASONS = {
  reject: ['Duplicate document', 'Not a valid business document', 'Illegible scan', 'Wrong project'],
  escalate: ['Vendor not in master data – please confirm', 'Amount mismatch with PO', 'Unusual payment terms', 'Needs SME review'],
}

export default function Review({ pid, docId, query }) {
  const toast = useToast()
  const [doc, setDoc] = useState(null)
  const [edits, setEdits] = useState({})
  const [confirmed, setConfirmed] = useState(new Set())
  const [lines, setLines] = useState(null)
  const [sel, setSel] = useState(null)
  const [pop, setPop] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(0)
  const [page, setPage] = useState(1)
  const [autoSave, setAutoSave] = useState(false)
  const [left, setLeft] = useState(SESSION_SEC)
  const [reason, setReason] = useState(null)
  const [typeChange, setTypeChange] = useState(null)
  const [busy, setBusy] = useState(false)
  const [full, setFull] = useState(false)
  const [panelTab, setPanelTab] = useState('fields')
  const [ask, setAsk] = useState(null)
  const opened = useRef(Date.now())
  const viewer = useRef()
  const from = query.from || doc?.stage || 'to_review'

  const load = () => get(`/api/documents/${docId}`).then(d => {
    setDoc(d); setEdits({}); setConfirmed(new Set()); setLines(null)
    const first = d.fields.find(f => f.status !== 'valid')
    setSel(s => s || (first ? first.key : null))
  }).catch(e => toast({ kind: 'error', text: e.message }))
  useEffect(() => { load(); opened.current = Date.now() }, [docId])

  const editable = doc && (doc.stage === 'to_review' || doc.stage === 'escalated')
  const dirty = Object.keys(edits).length > 0 || confirmed.size > 0 || lines !== null

  // session timeout (REV-03)
  useEffect(() => {
    const id = setInterval(() => setLeft(l => l - 1), 1000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    if (left > 0) return
    ;(async () => {
      if (dirty && editable) await save(true)
      toast({ kind: 'error', text: 'Session timed out', sub: dirty ? 'Your changes were saved as a draft.' : 'The document was released.' })
      go(`/p/${pid}/documents`, { stage: from })
    })()
  }, [left])

  // auto-save (REV-02)
  useEffect(() => {
    if (!autoSave || !dirty || !editable) return
    const t = setTimeout(() => save(true), 1200)
    return () => clearTimeout(t)
  }, [edits, confirmed, lines, autoSave])

  const fields = useMemo(() => (doc?.fields || []).map(f => {
    const v = edits[f.key] ?? f.value
    const changed = f.key in edits
    let status = f.status
    if (changed || confirmed.has(f.key)) status = fmtOk(f.type, v) || (!f.mandatory && v === '') ? 'valid' : 'error'
    return { ...f, value: v, status, changed }
  }), [doc, edits, confirmed])
  const blocking = fields.filter(f => f.mandatory && f.status === 'error')
  const attention = fields.filter(f => f.status !== 'valid')
  const layout = useMemo(() => doc ? layoutDocument(doc) : null, [doc])
  const statuses = Object.fromEntries(fields.map(f => [f.key, f.status]))
  if (doc) (doc.lineConf || []).forEach((c, i) => { statuses[`line:${i}`] = c * 100 >= doc.thresholds.extraction || lines ? 'valid' : 'low' })

  const select = (key, openPop = true) => {
    setSel(key); setPop(openPop && editable); setPanelTab('fields')
    const b = layout?.boxes[key]
    if (b && viewer.current && rot === 0) {
      const el = viewer.current
      const y = (b[1] / PAGE_W) * el.querySelector('.page-wrap').clientWidth
      el.scrollTo({ top: Math.max(0, y - 140), behavior: 'smooth' })
    }
  }
  const setVal = (key, v) => setEdits(e => ({ ...e, [key]: v }))
  const confirm = key => {
    setConfirmed(c => new Set(c).add(key)); setPop(false)
    const idx = fields.findIndex(f => f.key === key)
    const next = fields.slice(idx + 1).concat(fields.slice(0, idx)).find(f => f.status !== 'valid' && f.key !== key)
    if (next) setTimeout(() => select(next.key), 120)
  }
  const cancel = key => { setEdits(e => { const n = { ...e }; delete n[key]; return n }); setPop(false) }

  async function save(silent) {
    if (!dirty) { if (!silent) toast('No changes to save'); return doc }
    try {
      const d = await put(`/api/documents/${docId}`, { fields: edits, confirm: [...confirmed], lines })
      setDoc(d); setEdits({}); setConfirmed(new Set()); setLines(null)
      if (!silent) toast({ kind: 'success', text: 'Changes saved' })
      return d
    } catch (e) { toast({ kind: 'error', text: e.message }); return null }
  }

  const doAction = async (action, why) => {
    setBusy(true)
    try {
      if (dirty && editable) { const ok = await save(true); if (!ok) return }
      const r = await post(`/api/documents/${docId}/action`, { action, reason: why, handlingSec: Math.round((Date.now() - opened.current) / 1000) })
      if (action === 'approve') {
        toast({ kind: 'award', text: `+${r.award.points} points`, sub: r.award.withinSla ? 'Approved within SLA – nice work!' : 'Approved. Points include accuracy, not just speed.' })
      } else if (action === 'rerun') {
        toast({ kind: 'success', text: 'Sent for reprocessing', sub: 'It will reappear in To Review or be auto-approved.' })
        return go(`/p/${pid}/documents`, { stage: 'in_progress' })
      } else toast({ kind: 'success', text: action === 'reject' ? 'Document rejected' : 'Document escalated', sub: why })
      if (doc.nav.next) go(`/p/${pid}/review/${doc.nav.next}`, { from })
      else go(`/p/${pid}/documents`, { stage: from })
    } catch (e) {
      toast({ kind: 'error', text: e.message, sub: Array.isArray(e.detail) ? e.detail.join(', ') : undefined })
      if (Array.isArray(e.detail)) { const f = fields.find(x => x.label === e.detail[0]); f && select(f.key) }
    } finally { setBusy(false) }
  }
  const approve = () => {
    if (blocking.length) {
      toast({ kind: 'error', text: `${blocking.length} mandatory field${blocking.length > 1 ? 's' : ''} need attention`, sub: blocking.map(f => f.label).join(', ') })
      return select(blocking[0].key)
    }
    doAction('approve')
  }
  const guard = (fn) => (dirty && editable) ? setAsk({ run: fn }) : fn()
  const leave = () => guard(() => go(`/p/${pid}/documents`, { stage: from }))
  const nav = id => { if (id) guard(() => go(`/p/${pid}/review/${id}`, { from })) }

  // keyboard (REV-37)
  useEffect(() => {
    const on = e => {
      if (e.key === 'Escape') setPop(false)
      if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); const i = fields.findIndex(f => f.key === sel); fields[i + 1] && select(fields[i + 1].key) }
      if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); const i = fields.findIndex(f => f.key === sel); fields[i - 1] && select(fields[i - 1].key) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [fields, sel])

  if (!doc) return <div className="review"><div className="rv-loading"><Spinner size={30} /></div></div>
  const selField = fields.find(f => f.key === sel)
  const box = sel && layout.boxes[sel]
  const mins = Math.floor(Math.max(0, left) / 60), secs = Math.max(0, left) % 60
  const rows = lines ?? doc.lines

  return (
    <div className={'review' + (full ? ' full' : '')}>
      <div className="rv-top">
        <button className="icon-btn" onClick={leave} aria-label="Back to listing"><Icon name="back" size={20} /></button>
        <span className="rv-crumb"><b>Reviewing:</b> <a href={`#/p/${pid}`}>{doc.projectName}</a> <span className="muted">/</span> {doc.name}</span>
        {doc.stp ? <span className="tag t-stp">STP</span> : <span className={'tag t-cls' + (doc.clsOk ? '' : ' low')} title={`Classification confidence ${(doc.clsConf * 100).toFixed(1)}% (threshold ${doc.thresholds.classification}%)`}>{doc.docTypeName} · {(doc.clsConf * 100).toFixed(0)}% match</span>}
        <SlaChip sla={doc.sla} />
        <span className="grow" />
        {editable && <Toggle checked={autoSave} onChange={setAutoSave} label="Auto Save" />}
        <span className="vsep" />
        <span className={'timeout' + (left < 60 ? ' warn' : '')}><Icon name="clock" size={17} />Timeout in {mins}:{String(secs).padStart(2, '0')}</span>
        <button className="link-btn" onClick={() => setLeft(SESSION_SEC)}>Refresh</button>
      </div>

      <div className="rv-toolbar">
        <span className={'stage-chip st-' + doc.stage}><Icon name={doc.stage === 'to_review' ? 'clock' : doc.stage === 'escalated' ? 'escalate' : doc.stage === 'rejected' ? 'xCircle' : 'checkCircle'} size={15} />{doc.stage === 'to_review' ? 'Pending' : stageLabel(doc.stage)}</span>
        {doc.assignedTo && <span className="assignee small"><Avatar id={doc.assignedTo} size={22} />{doc.assignedTo}</span>}
        <span className="grow" />
        <label className="dtype">Document type:
          <select className="select" value={doc.docType} disabled={!editable} onChange={e => setTypeChange(e.target.value)}>
            {doc.docTypes.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </label>
        <span className="vsep" />
        <button className="btn" disabled title="Create a new document from selected pages – not simulated in this demo"><Icon name="newDoc" size={16} />New Doc</button>
        <button className="btn" disabled title="Split a multi-document file – not simulated in this demo"><Icon name="split" size={16} />Split Doc</button>
        <span className="vsep" />
        {editable && <>
          <div className="split-btn">
            <button className="btn" onClick={() => save()} disabled={!dirty}><Icon name="save" size={16} />Save</button>
            <Menu trigger={({ toggle }) => <button className="btn caret" onClick={toggle} aria-label="More save options"><Icon name="chevDown" size={16} /></button>}
              items={[{ label: 'Save and next', icon: 'chevRight', disabled: !doc.nav.next, onClick: async () => { if (await save(true)) go(`/p/${pid}/review/${doc.nav.next}`, { from }) } }, { label: 'Discard changes', icon: 'x', disabled: !dirty, onClick: () => { setEdits({}); setConfirmed(new Set()); setLines(null) } }]} />
          </div>
          <button className="btn" onClick={() => doAction('rerun')} disabled={busy} title="Re-run classification and extraction"><Icon name="rerun" size={16} />Rerun</button>
          <div className="split-btn">
            <button className="btn primary dark" onClick={approve} disabled={busy}>Approve</button>
            <Menu trigger={({ toggle }) => <button className="btn primary dark caret" onClick={toggle} aria-label="More actions"><Icon name="chevDown" size={16} /></button>}
              items={[{ label: 'Reject…', icon: 'xCircle', danger: true, onClick: () => setReason('reject') }, ...(doc.stage === 'to_review' ? [{ label: 'Escalate…', icon: 'escalate', onClick: () => setReason('escalate') }] : [])]} />
          </div>
        </>}
        <button className="icon-btn bordered" onClick={() => setFull(f => !f)} title="Full screen" aria-label="Full screen"><Icon name="expand" size={17} /></button>
      </div>

      {!editable && (
        <div className={'rv-banner b-' + doc.stage}>
          <Icon name="info" size={16} />
          {doc.stage === 'in_progress' ? 'This document is still processing.' :
            `${stageLabel(doc.stage)}${doc.completedBy ? ` by ${doc.completedBy === 'System' ? 'System (straight-through)' : doc.completedBy}` : ''}${doc.completedAt ? ` on ${fmtDT(doc.completedAt)}` : ''}${doc.reason ? ` · ${doc.reason}` : ''}. Read-only.`}
        </div>
      )}

      <div className="rv-main">
        <section className="rv-viewer card">
          <div className="rv-nav">
            <NavBox label="Batch" index={doc.nav.batchIndex} total={doc.nav.batchTotal} prev={doc.nav.prevBatch} next={doc.nav.nextBatch} onNav={nav} />
            <NavBox label="Document" index={doc.nav.index} total={doc.nav.total} prev={doc.nav.prev} next={doc.nav.next} onNav={nav} />
            <NavBox label="Pages" index={page} total={doc.pages} prev={page > 1} next={page < doc.pages} onNav={v => setPage(p => v === 'prev' ? p - 1 : p + 1)} pages />
            <span className="grow" />
            <div className="tools">
              <button className="icon-btn" onClick={() => setRot(r => (r + 270) % 360)} title="Rotate left"><Icon name="rotL" /></button>
              <button className="icon-btn" onClick={() => setRot(r => (r + 90) % 360)} title="Rotate right"><Icon name="rotR" /></button>
              <button className="icon-btn" onClick={() => { setZoom(1); setRot(0) }} title="Reset view"><Icon name="move" /></button>
              <button className="icon-btn" onClick={() => setZoom(z => Math.max(0.6, +(z - 0.15).toFixed(2)))} title="Zoom out"><Icon name="zoomOut" /></button>
              <span className="muted small zoomv">{Math.round(zoom * 100)}%</span>
              <button className="icon-btn" onClick={() => setZoom(z => Math.min(2, +(z + 0.15).toFixed(2)))} title="Zoom in"><Icon name="zoomIn" /></button>
              <span className="vsep" />
              <button className="icon-btn" title="Original file" onClick={() => toast('Demo: originals are simulated sample documents')}><Icon name="pdf" /></button>
            </div>
          </div>
          <div className="rv-canvas" ref={viewer} onClick={() => setPop(false)}>
            <div className="page-wrap" style={{ width: `${zoom * 100}%`, transform: `rotate(${rot}deg)` }}>
              <DocRender doc={doc} page={page} selected={sel} statuses={statuses} onPick={k => k.startsWith('line:') ? setPanelTab('tables') : select(k)} />
              {pop && box && rot === 0 && page === 1 && selField && (
                <div className="field-pop" style={{ ...(box[0] > PAGE_W * 0.5 ? { right: `${(1 - (box[0] + box[2]) / PAGE_W) * 100}%` } : { left: `${(box[0] / PAGE_W) * 100}%` }), top: `${((box[1] + box[3] + 6) / PAGE_H) * 100}%`, width: `${Math.max(36, (box[2] / PAGE_W) * 100)}%` }}
                  onClick={e => e.stopPropagation()}>
                  <PopEditor field={selField} onChange={v => setVal(selField.key, v)} onConfirm={() => confirm(selField.key)} onCancel={() => cancel(selField.key)} />
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="rv-panel card">
          <div className="rv-tabs" role="tablist">
            <button role="tab" aria-selected={panelTab === 'fields'} className={panelTab === 'fields' ? 'on' : ''} onClick={() => setPanelTab('fields')}>
              Field of Interest <span className="cnt">{fields.length}</span>{attention.length > 0 && <span className="dot-warn" title={`${attention.length} to check`} />}
            </button>
            <button role="tab" aria-selected={panelTab === 'tables'} className={panelTab === 'tables' ? 'on' : ''} onClick={() => setPanelTab('tables')}>
              Tables <span className="cnt">{rows.length ? 1 : 0}</span>{!lines && doc.lineConf.some(c => c * 100 < doc.thresholds.extraction) && <span className="dot-warn" title="Rows to check" />}
            </button>
          </div>
          {panelTab === 'fields' ? (
            <div className="rv-tabbody">
              <div className="rv-sub muted small">{attention.length ? `${attention.length} field${attention.length > 1 ? 's' : ''} to check` : 'All fields valid'}</div>
              {blocking.length > 0 && editable && <div className="blocking"><Icon name="alert" size={15} />Mandatory: {blocking.map(f => f.label).join(', ')}</div>}
              <div className="flist">
                {fields.map(f => (
                  <FieldRow key={f.key} f={f} selected={sel === f.key} editable={editable} onSelect={() => select(f.key)}
                    onChange={v => setVal(f.key, v)} onConfirm={() => confirm(f.key)} />
                ))}
              </div>
            </div>
          ) : (
            <div className="rv-tabbody">
              {rows.length > 0 ? <>
                <div className="rv-sub small"><b>Line items</b> <span className="muted">({rows.length} rows)</span></div>
                <div className="lines">
                  <table>
                    <thead><tr>{doc.table.map(c => <th key={c}>{c.replace('_', ' ')}</th>)}{editable && <th />}</tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className={!lines && doc.lineConf[i] * 100 < doc.thresholds.extraction ? 'low' : ''} title={`Row confidence ${Math.round((doc.lineConf[i] || 1) * 100)}%`}>
                          {doc.table.map(c => <td key={c} className={'c-' + c}><input value={r[c] ?? ''} disabled={!editable} onChange={e => setLines((lines ?? doc.lines).map((x, j) => j === i ? { ...x, [c]: e.target.value } : x))} /></td>)}
                          {editable && <td><button className="icon-btn sm" onClick={() => setLines((lines ?? doc.lines).filter((_, j) => j !== i))} aria-label="Delete row"><Icon name="trash" size={14} /></button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {editable && <button className="link-btn add-row" onClick={() => setLines([...(lines ?? doc.lines), Object.fromEntries(doc.table.map(c => [c, '']))])}><Icon name="plus" size={14} /> Add row</button>}
              </> : <div className="muted small pad-s">No tables extracted for this document type.</div>}
            </div>
          )}
        </aside>
      </div>

      {ask && (
        <Modal title="Unsaved changes" onClose={() => setAsk(null)}
          footer={<><button className="btn" onClick={() => setAsk(null)}>Keep editing</button>
            <button className="btn" onClick={() => { const r = ask.run; setAsk(null); r() }}>Discard</button>
            <button className="btn primary" onClick={async () => { const r = ask.run; setAsk(null); if (await save(true)) r() }}>Save and continue</button></>}>
          <p>You have edits that are not saved yet.</p>
        </Modal>
      )}
      {reason && <ReasonModal kind={reason} onClose={() => setReason(null)} onSubmit={why => { setReason(null); doAction(reason, why) }} />}
      {typeChange && (
        <Modal title="Change document type?" onClose={() => setTypeChange(null)}
          footer={<><button className="btn" onClick={() => setTypeChange(null)}>Cancel</button>
            <button className="btn primary" onClick={async () => {
              const t = typeChange; setTypeChange(null)
              try { const d = await post(`/api/documents/${docId}/doctype`, { docType: t }); setDoc(d); setEdits({}); setSel(null); toast({ kind: 'success', text: `Reclassified as ${d.docTypeName}`, sub: 'Fields reloaded for the new type and re-extracted.' }) }
              catch (e) { toast({ kind: 'error', text: e.message }) }
            }}>Change and re-extract</button></>}>
          <p>The field list will switch to <b>{doc.docTypes.find(t => t.key === typeChange)?.name}</b> and values will be re-extracted. Unsaved edits are discarded.</p>
        </Modal>
      )}
    </div>
  )
}

function NavBox({ label, index, total, prev, next, onNav, pages }) {
  return (
    <div className="navbox">
      <span className="nb-l">{label}</span>
      <button className="pg-btn" disabled={!prev} onClick={() => onNav(pages ? 'prev' : prev)} aria-label={`Previous ${label}`}><Icon name="chevLeft" size={16} /></button>
      <span className="nb-v"><b>{index}</b> <span className="muted">/ {total}</span></span>
      <button className="pg-btn" disabled={!next} onClick={() => onNav(pages ? 'next' : next)} aria-label={`Next ${label}`}><Icon name="chevRight" size={16} /></button>
    </div>
  )
}

function PopEditor({ field, onChange, onConfirm, onCancel }) {
  const ref = useRef()
  useEffect(() => { ref.current?.focus({ preventScroll: true }); ref.current?.select?.() }, [field.key])
  const multi = field.type === 'address'
  const sugg = (field.sugg || []).filter(s => s && s !== field.value)
  return (
    <div className="pop">
      <div className="pop-l">{field.label}{field.mandatory && <span className="req"> *</span>}
        <span className="pop-conf">conf {Math.floor(field.conf * 1000) / 10}% · min {field.threshold}%</span></div>
      {multi
        ? <textarea ref={ref} rows={Math.min(5, String(field.value).split('\n').length + 1)} value={field.value} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onConfirm() }} />
        : <input ref={ref} value={field.value} onChange={e => onChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && onConfirm()} />}
      <div className="pop-foot">
        {sugg.length > 0 ? <div className="sugg">{sugg.map(s => <button key={s} className="sugg-chip" onClick={() => onChange(s)} title="Use suggestion">{s.split('\n')[0]}</button>)}</div> : <span className="muted tiny">No suggestions</span>}
        <span className="grow" />
        <button className="icon-btn sm light" onClick={onCancel} aria-label="Cancel" title="Cancel (Esc)"><Icon name="x" size={16} /></button>
        <button className="icon-btn sm light" onClick={onConfirm} aria-label="Confirm" title="Confirm (Enter)"><Icon name="check" size={16} /></button>
      </div>
    </div>
  )
}

function FieldRow({ f, selected, editable, onSelect, onChange, onConfirm }) {
  const ref = useRef()
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [selected])
  return (
    <div ref={ref} className={'frow' + (selected ? ' sel' : '') + ` st-${f.status}` + (f.changed ? ' changed' : '')} onClick={onSelect}>
      <FieldStatusIcon status={f.status} selected={selected && f.status === 'valid'} />
      <div className="frow-l">
        <span>{f.label}{f.mandatory && <span className="req" title="Mandatory field"> *</span>}</span>
        {f.status !== 'valid' && <span className="tiny muted">{f.value === '' ? 'Not found' : f.status === 'error' ? 'Invalid format' : `Low confidence ${Math.floor(f.conf * 1000) / 10}% < ${f.threshold}%`}</span>}
        {f.orig != null && f.orig !== f.value && f.status === 'valid' && <span className="tiny muted" title={`Extracted: ${f.orig}`}>Corrected</span>}
      </div>
      {selected && editable ? (
        <div className="frow-edit" onClick={e => e.stopPropagation()}>
          {f.type === 'address'
            ? <textarea value={f.value} rows={3} onChange={e => onChange(e.target.value)} />
            : <input value={f.value} onChange={e => onChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && onConfirm()} list={`sg-${f.key}`} />}
          <datalist id={`sg-${f.key}`}>{(f.sugg || []).map(s => <option key={s} value={s} />)}</datalist>
          {f.status !== 'valid' && <button className="icon-btn sm ok" onClick={onConfirm} title="Confirm value" aria-label="Confirm value"><Icon name="check" size={15} /></button>}
        </div>
      ) : <span className={'frow-v' + (f.status === 'error' ? ' red' : f.status === 'low' ? ' orange' : '')} title={f.value}>{f.value || '—'}</span>}
    </div>
  )
}

function ReasonModal({ kind, onClose, onSubmit }) {
  const [text, setText] = useState('')
  return (
    <Modal title={kind === 'reject' ? 'Reject document' : 'Escalate document'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={'btn primary' + (kind === 'reject' ? ' danger' : '')} disabled={!text.trim()} onClick={() => onSubmit(text.trim())}>{kind === 'reject' ? 'Reject' : 'Escalate'}</button></>}>
      <p className="muted">A reason is required and is recorded in the audit trail.</p>
      <div className="chips">{REASONS[kind].map(r => <button key={r} className={'chip btnchip' + (text === r ? ' on' : '')} onClick={() => setText(r)}>{r}</button>)}</div>
      <textarea className="full" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Add a reason or comment" autoFocus />
    </Modal>
  )
}
