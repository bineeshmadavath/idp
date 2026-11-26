import React, { Fragment, useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Avatar, Empty, Menu, Modal, Pager, Skeleton, SlaChip, Spinner, Toggle, useToast } from '../components/ui.jsx'
import DateFilter, { describeRange } from '../components/DateFilter.jsx'
import DocRender from '../components/DocRender.jsx'
import { get, post, PREVIEW, uploadFiles } from '../api.js'
import { downloadCSV, fmtDT, go, STAGES, two, useInterval } from '../util.js'
import { useApp } from '../App.jsx'

const SORTABLE = {
  in_progress: [['name', 'Batch name'], ['createdAt', 'Batch created on'], ['origin', 'Origin'], ['uploadedBy', 'Uploaded by'], ['total', 'Total'], ['inProgress', 'In progress'], ['failed', 'Failed']],
  to_review: [['name', 'Batch name'], ['createdAt', 'Batch created on'], ['modifiedOn', 'Modified on'], ['pending', 'Pending'], ['unassigned', 'Unassigned']],
  done: [['name', 'Batch name'], ['createdAt', 'Batch created on'], ['modifiedOn', 'Modified on'], ['origin', 'Origin'], ['total', 'Documents']],
}

export default function Documents({ pid, query }) {
  const { meta, project } = useApp()
  const toast = useToast()
  const stage = query.stage || 'in_progress'
  const page = +query.page || 1
  const sort = query.sort || 'createdAt', dir = query.dir || 'desc'
  const filters = { q: query.q, assignee: query.assignee, sla: query.sla, from: query.from, to: query.to, docType: query.docType, mine: query.mine }
  const [counts, setCounts] = useState(null)
  const [data, setData] = useState(null)
  const [openRows, setOpenRows] = useState({})
  const [selected, setSelected] = useState(new Set())
  const [panel, setPanel] = useState(stage === 'to_review')
  const [workload, setWorkload] = useState(null)
  const [uploading, setUploading] = useState(!!query.upload)
  const [preview, setPreview] = useState(null)
  const reviewable = stage === 'to_review' || stage === 'escalated'
  const autoOpened = useRef(null)
  const set = (patch) => go(`/p/${pid}/documents`, { ...query, ...patch, upload: undefined })

  const load = async () => {
    const [c, b, w] = await Promise.all([
      get(`/api/projects/${pid}/counts`, filters),
      get(`/api/projects/${pid}/batches`, { ...filters, stage, page, sort, dir }),
      get(`/api/projects/${pid}/workload`),
    ])
    setCounts(c); setData(b); setWorkload(w)
    if (b.rows.length && autoOpened.current !== stage) {
      autoOpened.current = stage
      setOpenRows({ [b.rows[0].id]: true })
    }
  }
  useEffect(() => { setData(null); setSelected(new Set()); load().catch(e => toast({ kind: 'error', text: e.message })) }, [stage, page, sort, dir, JSON.stringify(filters)])
  useEffect(() => { if (reviewable) setPanel(true) }, [stage])
  useInterval(() => load().catch(() => {}), 4000, [stage, page, sort, dir, JSON.stringify(filters)])

  const toggleDoc = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleBatch = row => setSelected(s => {
    const n = new Set(s); const all = row.docs.every(d => n.has(d.id))
    row.docs.forEach(d => all ? n.delete(d.id) : n.add(d.id)); return n
  })
  const assign = async (reviewer) => {
    if (!selected.size) return toast({ text: 'Select batches or documents first', sub: 'Tick the checkboxes in the listing, then choose a reviewer.' })
    try {
      const r = await post(`/api/projects/${pid}/assign`, { docIds: [...selected], reviewer })
      const name = [...meta.reviewers, meta.user].find(x => x.id === reviewer)?.name
      toast({ kind: 'success', text: `${r.assigned} document${r.assigned > 1 ? 's' : ''} assigned to ${name}` })
      setSelected(new Set()); load()
    } catch (e) { toast({ kind: 'error', text: e.message }) }
  }
  const act = async (doc, action) => {
    try {
      await post(`/api/documents/${doc.id}/action`, { action })
      toast({ kind: 'success', text: action === 'retry' ? `Retrying ${doc.name}` : `${doc.name} resent for review` })
      load()
    } catch (e) { toast({ kind: 'error', text: e.message }) }
  }
  const download = async () => {
    const ids = selected.size ? [...selected] : (data?.rows || []).flatMap(r => r.docs.map(d => d.id))
    if (!ids.length) return toast('Nothing to download on this page')
    if (PREVIEW) return toast({ text: 'Downloads are turned off in the hosted preview', sub: 'Run the project locally to export extracted data as CSV.' })
    const docs = await Promise.all(ids.map(id => get(`/api/documents/${id}`)))
    const keys = [...new Set(docs.flatMap(d => d.fields.map(f => f.key)))]
    downloadCSV(`${project.name}_${stage}_export.csv`, [
      ['document', 'batch', 'document_type', 'stage', 'assigned_to', ...keys],
      ...docs.map(d => [d.name, d.batchName, d.docTypeName, d.stage, d.assignedTo || '', ...keys.map(k => d.fields.find(f => f.key === k)?.value ?? '')]),
    ])
    toast({ kind: 'success', text: `Exported ${docs.length} documents (CSV)` })
  }

  const cols = SORTABLE[stage === 'in_progress' ? 'in_progress' : reviewable ? 'to_review' : 'done']
  const activeFilters = [
    filters.q && ['q', `Search: “${filters.q}”`],
    filters.assignee && ['assignee', filters.assignee === 'unassigned' ? 'Unassigned only' : `Assigned to ${filters.assignee}`],
    filters.sla && ['sla', `SLA: ${filters.sla.replace('_', ' ')}`],
    (filters.from || filters.to) && ['date', describeRange(filters.from, filters.to)],
    filters.docType && ['docType', `Type: ${filters.docType.replace('_', ' ')}`],
  ].filter(Boolean)

  return (
    <div className={'docs-layout' + (panel && reviewable ? ' with-panel' : '')}>
      <div className="page docs">
        <div className="page-head">
          <div className="title-row">
            <button className="icon-btn" onClick={() => go(`/p/${pid}`)} aria-label="Back to dashboard"><Icon name="back" size={20} /></button>
            <h1>Document listing by Batches</h1>
          </div>
          <div className="toolbar">
            {stage === 'in_progress' && <span className="with-info"><Toggle checked={!query.mine} onChange={v => set({ mine: v ? undefined : 1, page: 1 })} label="Show all batches" title="Off: only batches you uploaded or are assigned to" /><span title="Off shows only batches you uploaded or are assigned to"><Icon name="info" size={15} className="info" /></span></span>}
            <DateFilter from={filters.from} to={filters.to} onApply={(from, to) => set({ from, to, page: 1 })} />
            <button className="btn" onClick={() => setUploading(true)} disabled={project.status !== 'Ready'}><Icon name="upload" size={16} />Upload</button>
            <button className="btn" onClick={download}><Icon name="download" size={16} />Download{selected.size ? ` (${selected.size})` : ''}</button>
            <span className="vsep" />
            <Pager page={data?.page || 1} pages={data?.pages || 1} onPage={p => set({ page: p })} />
            {reviewable && <button className={'icon-btn bordered' + (panel ? ' active' : '')} onClick={() => setPanel(p => !p)} title="Job assignments" aria-label="Job assignments"><Icon name="users" size={17} /></button>}
          </div>
        </div>
        <div className="tabs" role="tablist">
          {STAGES.map(s => (
            <button key={s.key} role="tab" aria-selected={stage === s.key} className={'tab' + (stage === s.key ? ' on' : '')}
              onClick={() => set({ stage: s.key, page: 1, sort: undefined, dir: undefined })}>
              <Icon name={s.icon} size={18} />{s.label} ({counts ? two(counts[s.key]) : '··'})
            </button>
          ))}
        </div>
        {activeFilters.length > 0 && (
          <div className="filter-chips">
            {activeFilters.map(([k, l]) => <span key={k} className="fchip">{l}<button onClick={() => set(k === 'date' ? { from: '', to: '', page: 1 } : { [k]: '', page: 1 })} aria-label="Remove filter"><Icon name="x" size={12} /></button></span>)}
            <button className="link-btn" onClick={() => go(`/p/${pid}/documents`, { stage })}>Clear all</button>
          </div>
        )}
        {!data ? <Skeleton rows={6} h={52} /> : data.rows.length === 0 ? (
          <Empty icon={STAGES.find(s => s.key === stage).icon} title={`No batches in ${STAGES.find(s => s.key === stage).label}`}
            text={activeFilters.length ? 'Try clearing the filters.' : stage === 'in_progress' ? 'Upload documents to start processing.' : 'Documents will appear here as they move through the pipeline.'}
            action={stage === 'in_progress' && !activeFilters.length && <button className="btn primary" onClick={() => setUploading(true)}><Icon name="upload" size={16} />Upload</button>} />
        ) : (
          <div className="btable">
            <div className={`bt-head bt-${stage}`}>
              {reviewable && <span />}
              {cols.map(([k, l]) => (
                <button key={k} className="th" onClick={() => set({ sort: k, dir: sort === k && dir === 'desc' ? 'asc' : 'desc' })}>
                  {l}<span className={'sort-ic' + (sort === k ? ' on' : '')}>{sort === k ? (dir === 'desc' ? '↓' : '↑') : '⇅'}</span>
                </button>
              ))}
              <span />
            </div>
            {data.rows.map(row => (
              <BatchRow key={row.id} row={row} stage={stage} open={!!openRows[row.id]} reviewable={reviewable}
                onToggle={() => setOpenRows(o => ({ ...o, [row.id]: !o[row.id] }))}
                selected={selected} toggleDoc={toggleDoc} toggleBatch={toggleBatch}
                onOpenDoc={d => go(`/p/${pid}/review/${d.id}`, { from: stage })}
                onAct={act} onPreview={setPreview} meta={meta} />
            ))}
          </div>
        )}
      </div>
      {panel && reviewable && workload && <JobPanel workload={workload} onClose={() => setPanel(false)} onAssign={assign} selectedCount={selected.size}
        onUnassigned={() => set({ stage: 'to_review', assignee: 'unassigned', page: 1 })} />}
      {preview && <HoverPreview id={preview} />}
      {uploading && <UploadModal pid={pid} onClose={() => setUploading(false)} onDone={() => { setUploading(false); set({ stage: 'in_progress', page: 1, mine: undefined }); load() }} />}
    </div>
  )
}

function BatchRow({ row, stage, open, onToggle, reviewable, selected, toggleDoc, toggleBatch, onOpenDoc, onAct, onPreview }) {
  const allSel = row.docs.length > 0 && row.docs.every(d => selected.has(d.id))
  const someSel = row.docs.some(d => selected.has(d.id))
  const hoverT = useRef()
  const hover = id => { clearTimeout(hoverT.current); hoverT.current = setTimeout(() => onPreview(id), 280) }
  const leave = () => { clearTimeout(hoverT.current); onPreview(null) }
  return (
    <div className={'brow' + (open ? ' open' : '')}>
      <div className={`bt-row bt-${stage}`} onClick={onToggle}>
        {reviewable && <span onClick={e => e.stopPropagation()}><input type="checkbox" checked={allSel} ref={el => { if (el) el.indeterminate = !allSel && someSel }} onChange={() => toggleBatch(row)} aria-label={`Select ${row.name}`} /></span>}
        <span className="bname">
          {reviewable && <span className={'health h-' + row.health} title={row.health === 'ok' ? 'All documents healthy' : 'Contains failed or rejected documents'}><Icon name={row.health === 'ok' ? 'checkCircle' : 'xCircle'} size={15} stroke={2.2} /></span>}
          {row.name}{row.updated && reviewable && <span className="tag t-updated">Updated</span>}
        </span>
        <span>{fmtDT(row.createdAt)}</span>
        {stage === 'in_progress' ? <>
          <span>{row.origin}</span><span>{row.uploadedBy === 'System' ? 'System (API)' : row.uploadedBy}</span>
          <span>{two(row.total)}</span><span>{two(row.inProgress)}</span><span className={row.failed ? 'red' : ''}>{two(row.failed)}</span>
        </> : reviewable ? <>
          <span>{fmtDT(row.modifiedOn)}</span><span>{row.pending}</span><span>{row.unassigned}</span>
        </> : <>
          <span>{fmtDT(row.modifiedOn)}</span><span>{row.origin}</span><span>{two(row.docs.length)}<span className="muted"> / {two(row.total)}</span></span>
        </>}
        <span className="chev"><Icon name={open ? 'chevUp' : 'chevDown'} size={18} /></span>
      </div>
      {open && (
        <div className="dtable">
          <div className={`dt-head dt-${stage}`}>
            {reviewable && <span />}
            <span>Document name</span><span>Document type</span>
            {stage === 'in_progress' ? <><span>Last processed</span><span>Status</span></>
              : reviewable ? <><span>Assigned to</span><span>Created on</span><span>SLA</span></>
                : <><span>{stage === 'rejected' ? 'Rejected by' : 'Completed by'}</span><span>Completed on</span><span>{stage === 'rejected' ? 'Reason' : 'Route'}</span></>}
            <span className="ta-c">Actions</span>
          </div>
          {row.docs.map(d => (
            <div key={d.id} className={`dt-row dt-${stage}` + (selected.has(d.id) ? ' sel' : '')}>
              {reviewable && <span><input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleDoc(d.id)} aria-label={`Select ${d.name}`} /></span>}
              <span className="dname" onMouseEnter={() => d.proc === 'done' && hover(d.id)} onMouseLeave={leave}>
                <button className="link-plain" onClick={() => d.proc === 'done' && onOpenDoc(d)} disabled={d.proc !== 'done'}>{d.name}</button>
                {d.flags.map(f => <span key={f} className={'tag t-' + f.toLowerCase()}>{f}</span>)}
              </span>
              <span>{d.docTypeName}</span>
              {stage === 'in_progress' ? <>
                <span>{d.processedAt ? fmtDT(d.processedAt) : '–'}</span>
                <span>{d.proc === 'failed'
                  ? <span className="pstat failed" title={d.error}><Icon name="alert" size={18} stroke={2} /> Failed</span>
                  : <span className="pstat" title="Classifying and extracting"><Spinner size={18} /> Processing</span>}</span>
              </> : reviewable ? <>
                <span>{d.assignedTo ? <span className="assignee"><Avatar id={d.assignedTo} size={24} />{d.assignedTo}</span> : <span className="muted">Unassigned</span>}</span>
                <span>{fmtDT(d.createdAt)}</span>
                <span><SlaChip sla={d.sla} /></span>
              </> : <>
                <span>{d.completedBy === 'System' ? <span className="tag t-stp">STP</span> : d.completedBy || '–'}</span>
                <span>{fmtDT(d.completedAt)}</span>
                <span className="ellipsis" title={d.reason || ''}>{stage === 'rejected' ? d.reason : d.stp ? 'Straight-through' : 'Human review'}</span>
              </>}
              <span className="ta-c actions">
                {d.proc === 'failed' && <button className="icon-btn sm" title="Retry processing" onClick={() => onAct(d, 'retry')}><Icon name="rerun" size={16} /></button>}
                {stage === 'rejected' && <button className="icon-btn sm" title="Resend for review" onClick={() => onAct(d, 'resend')}><Icon name="send" size={16} /></button>}
                {d.proc === 'done' && <button className="icon-btn sm" title={reviewable ? 'Review document' : 'View document'} onClick={() => onOpenDoc(d)}><Icon name="eye" size={17} /></button>}
                {d.proc === 'processing' && <span className="muted tiny">…</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const PANEL_COLS = [['assigned', 'user', 'Assigned, to review'], ['approved', 'checkCircle', 'Approved'], ['rejected', 'xCircle', 'Rejected'], ['escalated', 'escalate', 'Escalated'], ['sent', 'send', 'Sent']]

function JobPanel({ workload, onClose, onAssign, selectedCount, onUnassigned }) {
  const [col, setCol] = useState('assigned')
  return (
    <aside className="jobpanel" aria-label="Job assignments">
      <div className="jp-head"><h2>Job Assignments</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
      <div className="jp-tabs">
        <span className="jp-name-h" title="Reviewer"><Icon name="users" size={16} /></span>
        {PANEL_COLS.map(([k, ic, t]) => <button key={k} className={col === k ? 'on' : ''} onClick={() => setCol(k)} title={t} aria-label={t}><Icon name={ic} size={16} /></button>)}
      </div>
      <div className="jp-rows">
        {workload.reviewers.map(r => (
          <div key={r.id} className={'jp-row' + (selectedCount ? ' can' : '')}>
            <span className="jp-name-h"><Avatar id={r.id} size={30} title={r.name} /></span>
            {PANEL_COLS.map(([k]) => <span key={k} className={'jp-n' + (col === k ? ' on' : '')}>{two(r[k])}</span>)}
            {selectedCount > 0 && <button className="btn xs primary jp-assign" onClick={() => onAssign(r.id)}>Assign {selectedCount}</button>}
          </div>
        ))}
      </div>
      <div className="jp-foot">
        <div className="jp-hint"><Icon name="file" size={34} stroke={1.2} /><span>Select unassigned batches or documents from the document listing and assign them to selected reviewers.</span></div>
        <button className="btn dark block" onClick={onUnassigned}>Unassigned ({workload.unassigned})</button>
      </div>
    </aside>
  )
}

const cache = new Map()
function HoverPreview({ id }) {
  const [doc, setDoc] = useState(cache.get(id))
  useEffect(() => {
    if (cache.has(id)) return setDoc(cache.get(id))
    get(`/api/documents/${id}`).then(d => { cache.set(id, d); setDoc(d) })
  }, [id])
  return (
    <div className="hover-preview" role="tooltip">
      {!doc ? <Spinner size={24} /> : <>
        <div className="hp-head"><span>{doc.name}</span><span className="muted">{doc.pages} Page{doc.pages > 1 ? 's' : ''}</span></div>
        <div className="hp-page"><DocRender doc={doc} showBoxes={false} /></div>
      </>}
    </div>
  )
}

function UploadModal({ pid, onClose, onDone }) {
  const toast = useToast()
  const [files, setFiles] = useState([])
  const [name, setName] = useState('')
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const input = useRef()
  const ok = f => /\.(pdf|png|jpe?g|tiff?)$/i.test(f.name) && f.size <= 20 * 1024 * 1024
  const add = list => setFiles(f => [...f, ...Array.from(list)])
  const sample = () => {
    const mk = n => new File([new Uint8Array(1024 * (40 + Math.floor(Math.random() * 300)))], n, { type: 'application/pdf' })
    setFiles(f => [...f, mk('Invoice_Northwind_Nov.pdf'), mk('PO_Lakeside_88231.pdf'), mk('Delivery_Note_DN-55120.pdf'), mk('Invoice_Helix_Scan.png')])
  }
  const send = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await uploadFiles(pid, files, name.trim() || undefined)
      toast({ kind: 'success', text: `Batch uploaded – ${r.documents} document${r.documents > 1 ? 's' : ''}`, sub: 'Classifying and extracting now. Watch them move from In Progress.' })
      onDone()
    } catch (e) { setErr(e.detail?.length ? e.detail : [e.message]); setBusy(false) }
  }
  return (
    <Modal title="Upload documents" onClose={onClose} width={600}
      footer={<><button className="link-btn" onClick={sample}>Add sample files</button><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!files.length || busy || files.some(f => !ok(f))} onClick={send}>{busy ? 'Uploading…' : `Upload ${files.length || ''}`}</button></>}>
      <div className={'drop' + (drag ? ' over' : '')} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files) }} onClick={() => input.current.click()}>
        <Icon name="upload" size={28} />
        <b>Drag and drop files here, or click to browse</b>
        <span className="muted small">PDF, PNG, JPG or TIFF · up to 20 MB each · document type is identified automatically</span>
        <input ref={input} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" onChange={e => add(e.target.files)} />
      </div>
      <label className="form inline">Batch name (optional)<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Northwind_Nov_Invoices" /></label>
      {files.length > 0 && (
        <ul className="filelist">
          {files.map((f, i) => (
            <li key={i} className={ok(f) ? '' : 'bad'}>
              <Icon name="file" size={16} /><span className="ellipsis">{f.name}</span>
              <span className="muted small">{(f.size / 1024).toFixed(0)} KB</span>
              {!ok(f) && <span className="red small">Not supported</span>}
              <button className="icon-btn sm" onClick={() => setFiles(x => x.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted tiny">Demo note: files are validated but not read. Each file becomes a simulated sample document, classified from its name (e.g. “PO”, “Delivery”) or as an invoice.</p>
      {err && <div className="form-err"><Icon name="alert" size={16} />{err.join(' · ')}</div>}
    </Modal>
  )
}
