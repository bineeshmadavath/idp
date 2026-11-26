/* In-browser mock of the SmartVision API (mirrors backend/app/service.py).
   Used by `npm run dev:mock` and the hosted preview, so the UI works with no
   backend. Seed data is exported from the Python generator (seed.json) and
   time-shifted so that it is always "live". */
const HOUR = 3600000, DAY = 24 * HOUR
const STAGES = ['in_progress', 'to_review', 'approved', 'rejected', 'escalated', 'sent']
const OPEN = new Set(['in_progress', 'to_review', 'escalated'])
const DONE = new Set(['approved', 'sent', 'rejected'])
const ALLOWED = /\.(pdf|png|jpe?g|tiff?)$/i
const RE = { date: /^\d{2}\/\d{2}\/\d{4}$/, currency: /^\d+(\.\d{2})?$/, number: /^\d+$/ }
const CONF = { '0': 'O', 'O': '0', '1': 'I', 'I': '1', '5': 'S', 'S': '5', '8': 'B', 'B': '8', '2': 'Z', '6': 'G' }
let SEED, USER, REVIEWERS, SIM, S, now = Date.now()

class ApiErr { constructor(status, message, detail = null) { Object.assign(this, { status, message, detail }) } }
const err = (s, m, d) => { throw new ApiErr(s, m, d) }
const clone = o => JSON.parse(JSON.stringify(o))

/* ---------------------------------------------------------------- state */
const TIME_KEYS = ['createdAt', 'processedAt', 'assignedAt', 'completedAt', 'sentAt', 'processAt', 'autoSendAt', 'updatedAt', 'lastModified', 'readyAt']
export function boot(seed) {
  SEED = seed; USER = seed.meta.user; REVIEWERS = seed.meta.reviewers; SIM = seed.sim
  S = clone(seed)
  const shift = Date.now() - seed.generatedAt
  const shiftObj = o => TIME_KEYS.forEach(k => { if (typeof o[k] === 'number') o[k] += shift })
  Object.values(S.projects).forEach(p => { shiftObj(p); p.config.history.forEach(h => { h.at += shift }) })
  Object.values(S.batches).forEach(shiftObj)
  Object.values(S.docs).forEach(shiftObj)
  now = Date.now()
}
const rnd = (a, b) => a + Math.random() * (b - a)
const rint = (a, b) => Math.floor(rnd(a, b + 1))
const pick = a => a[Math.floor(Math.random() * a.length)]
const id = k => `${k}${++S.seq[k]}`
const r3 = x => Math.round(x * 1000) / 1000
const round1 = x => Math.round(x * 10) / 10
const pad = n => String(n).padStart(2, '0')
const fmtDate = ms => { const d = new Date(ms); return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}` }
const typeDef = (pid, key) => S.projects[pid].config.docTypes.find(t => t.key === key) || null

/* ---------------------------------------------------------------- simulator */
function makeTruth(type, created) {
  const vendor = pick(SIM.vendors), buyer = pick(SIM.buyers)
  const items = [...SIM.items].sort(() => Math.random() - 0.5).slice(0, rint(2, 5))
  const lines = items.map(([code, desc, price]) => { const q = rint(1, 24); return { qty: String(q), item_code: code, description: desc, unit_price: price.toFixed(2), amount: (q * price).toFixed(2) } })
  const sub = Math.round(lines.reduce((s, l) => s + +l.amount, 0) * 100) / 100
  const tax = Math.round(sub * 10) / 100
  const issue = created - rint(1, 6) * DAY, due = issue + pick([30, 45, 60]) * DAY
  const po = `PO-${rint(10000, 99999)}`
  let v
  if (type === 'invoice') v = { invoice_number: `INV${rint(100000, 999999)}`, invoice_date: fmtDate(issue), due_date: fmtDate(due), vendor_name: vendor.name, vendor_address: vendor.address, bill_to: `${buyer.name.toUpperCase()}\nATTN: ACCOUNTS PAYABLE\n${buyer.address.toUpperCase()}`, po_number: po, subtotal: sub.toFixed(2), tax: tax.toFixed(2), total_amount: (sub + tax).toFixed(2), currency: 'USD' }
  else if (type === 'purchase_order') v = { po_number: po, po_date: fmtDate(issue), buyer_name: buyer.name, supplier_name: vendor.name, ship_to: buyer.address, delivery_date: fmtDate(due - 20 * DAY), payment_terms: pick(SIM.paymentTerms), total_amount: (sub + tax).toFixed(2), currency: 'USD' }
  else { lines.forEach(l => { delete l.unit_price; delete l.amount }); v = { delivery_number: `DN-${rint(100000, 999999)}`, delivery_date: fmtDate(issue), supplier_name: vendor.name, recipient: buyer.name, delivery_address: buyer.address, po_number: po, carrier: pick(SIM.carriers), total_packages: String(rint(1, 12)) } }
  return { values: v, lines, vendor, buyer }
}
function corrupt(val) {
  if (!val) return val
  const c = [...val], idx = c.map((x, i) => CONF[x] ? i : -1).filter(i => i >= 0)
  if (idx.length && Math.random() < 0.8) { const i = pick(idx); c[i] = CONF[c[i]] } else c.splice(Math.floor(Math.random() * c.length), 1)
  return c.join('')
}
function extract(values, defs, er = 0.022) {
  const out = {}
  for (const f of defs) {
    const t = values[f.key] || '', r = Math.random()
    if (!t) out[f.key] = { value: '', conf: r3(rnd(0.1, 0.4)), sugg: [] }
    else if (r < er * 0.25) out[f.key] = { value: '', conf: 0, sugg: [t] }
    else if (r < er) { const bad = corrupt(t); out[f.key] = { value: bad, conf: r3(rnd(0.52, 0.83)), sugg: [...new Set([t, corrupt(t)])].filter(s => s !== bad) } }
    else if (r < er * 2.2) out[f.key] = { value: t, conf: r3(rnd(0.7, 0.86)), sugg: [corrupt(t)] }
    else out[f.key] = { value: t, conf: r3(0.998 - Math.random() ** 5 * 0.07), sugg: [] }
  }
  return out
}
const classifyConf = () => Math.random() < 0.05 ? r3(rnd(0.6, 0.88)) : r3(rnd(0.91, 0.995))
const validFormat = (t, v) => v !== '' && (!RE[t] || RE[t].test(v))

function newDoc(pid, bid, type, created, name) {
  const truth = makeTruth(type, created), v = truth.values
  const ident = v.invoice_number || v.po_number || v.delivery_number
  const prefix = { invoice: 'Invoice', purchase_order: 'PurchaseOrder', delivery_note: 'DeliveryNote' }[type]
  return { id: id('d'), projectId: pid, batchId: bid, name: name || `${prefix}_${ident}.pdf`, pages: rint(1, 3), trueType: type, docType: null, clsConf: null,
    stage: 'in_progress', proc: 'processing', processAt: null, error: null, createdAt: created, processedAt: null, assignedTo: null, assignedAt: null,
    completedAt: null, completedBy: null, sentAt: null, stp: false, flags: [], reason: null, truth, fields: {}, lines: [], lineConf: [], handlingSec: null, corrections: 0, configVersion: null }
}
function runExtraction(d) {
  const t = typeDef(d.projectId, d.docType)
  d.fields = extract(d.truth.values, t.fields)
  d.lines = d.docType === d.trueType ? clone(d.truth.lines) : []
  d.lineConf = d.lines.map(() => Math.random() < 0.025 ? r3(rnd(0.62, 0.84)) : r3(rnd(0.88, 0.99)))
  d.configVersion = S.projects[d.projectId].config.version
}
function completeProcessing(d, at) {
  const cfg = S.projects[d.projectId].config
  const active = cfg.docTypes.filter(t => t.active).map(t => t.key)
  d.clsConf = classifyConf()
  if (active.includes(d.trueType)) d.docType = d.trueType
  else { d.docType = active[0] || cfg.docTypes[0].key; d.clsConf = r3(rnd(0.4, 0.7)) }
  runExtraction(d)
  Object.assign(d, { proc: 'done', processAt: null, processedAt: at })
  if (evaluate(d).stp) Object.assign(d, { stage: 'approved', stp: true, completedAt: at, completedBy: 'System', autoSendAt: at + 45000 })
  else d.stage = 'to_review'
}

/* ---------------------------------------------------------------- rules */
function thresholdsFor(pid, type, cfg) {
  cfg = cfg || S.projects[pid].config
  const t = cfg.docTypes.find(x => x.key === type), th = cfg.thresholds, out = {}
  for (const f of (t ? t.fields : [])) out[f.key] = f.threshold != null ? f.threshold : f.mandatory ? Math.max(th.extraction, th.mandatory) : th.extraction
  return [out, t]
}
function evaluate(d, cfg, useOrig = false) {
  cfg = cfg || S.projects[d.projectId].config
  const [ths, t] = thresholdsFor(d.projectId, d.docType, cfg)
  const res = {}, blocking = []; let ok = true
  for (const fd of (t ? t.fields : [])) {
    const f = d.fields[fd.key] || { value: '', conf: 0, sugg: [] }
    const value = useOrig && 'orig' in f ? f.orig : f.value
    const corrected = f.corrected && !useOrig
    const thr = ths[fd.key], fmt = validFormat(fd.type, value)
    let st
    if (corrected && (fmt || (value === '' && !fd.mandatory))) st = 'valid'
    else if (value === '') st = fd.mandatory ? 'error' : 'low'
    else if (!fmt) st = 'error'
    else if (f.conf * 100 < thr) st = 'low'
    else st = 'valid'
    if (st !== 'valid') ok = false
    if (fd.mandatory && st === 'error') blocking.push(fd.label)
    res[fd.key] = { status: st, threshold: thr }
  }
  const clsOk = (d.clsConf || 0) * 100 >= cfg.thresholds.classification
  const linesOk = d.lineConf.every(c => c * 100 >= cfg.thresholds.extraction)
  return { fields: res, blocking, clsOk, stp: !!(clsOk && ok && linesOk && t) }
}
function sla(d, at) {
  const c = S.projects[d.projectId].config.sla
  const due = d.createdAt + c.turnaroundHours * HOUR, end = d.completedAt || at || now
  const used = (end - d.createdAt) / (c.turnaroundHours * HOUR)
  const status = d.completedAt ? (end <= due ? 'met' : 'breached') : used >= 1 ? 'breached' : used * 100 >= c.atRiskPct ? 'at_risk' : 'on_track'
  return { due, status, remainingMs: due - (at || now) }
}
function tick() {
  now = Date.now()
  for (const p of Object.values(S.projects)) if (p.status === 'Inprogress' && p.readyAt && p.readyAt <= now) { p.status = 'Ready'; p.readyAt = null }
  for (const d of Object.values(S.docs)) {
    if (d.proc === 'processing' && d.processAt && d.processAt <= now) { completeProcessing(d, d.processAt); S.batches[d.batchId].updatedAt = now }
    else if (d.stage === 'approved' && d.autoSendAt && d.autoSendAt <= now) Object.assign(d, { stage: 'sent', sentAt: d.autoSendAt, autoSendAt: null })
  }
}

/* ---------------------------------------------------------------- handlers */
const project = pid => S.projects[pid] || err(404, 'Project not found')
const docOf = did => S.docs[did] || err(404, 'Document not found')
const docsOf = pid => Object.values(S.docs).filter(d => d.projectId === pid)

function listProjects() {
  return Object.values(S.projects).map(p => {
    const docs = docsOf(p.id)
    return { id: p.id, name: p.name, description: p.description, status: p.status, bookmarked: p.bookmarked, lastModified: p.lastModified,
      documents: docs.length, openDocuments: docs.filter(d => OPEN.has(d.stage)).length, docTypes: p.config.docTypes.filter(t => t.active).map(t => t.name) }
  })
}
function defaultConfig(types) {
  return { version: 1, docTypes: types.map(k => { const c = SEED.meta.catalogue.find(x => x.key === k); return { key: k, name: c.name, active: true, fields: c.fields.map(f => ({ ...f, threshold: null })), table: [...c.table] } }),
    thresholds: { classification: 90, extraction: 85, mandatory: 95 }, sla: { turnaroundHours: 24, atRiskPct: 80 }, gamification: true, history: [] }
}
function createProject(b) {
  const name = (b.name || '').trim()
  if (!name) err(400, 'Project name is required')
  if (Object.values(S.projects).some(p => p.name.toLowerCase() === name.toLowerCase())) err(400, 'A project with this name already exists')
  const types = (b.docTypes || []).filter(t => SEED.meta.catalogue.some(c => c.key === t))
  if (!types.length) err(400, 'Select at least one document type')
  const pid = id('p')
  S.projects[pid] = { id: pid, name, description: b.description || '', status: 'Inprogress', bookmarked: false, lastModified: now, createdAt: now, readyAt: now + 6000, config: defaultConfig(types) }
  return listProjects().at(-1)
}
function putConfig(pid, body) {
  const p = project(pid), cfg = clone(body)
  for (const k of ['classification', 'extraction', 'mandatory']) { const v = cfg.thresholds?.[k]; if (typeof v !== 'number' || v < 0 || v > 100) err(400, `Threshold '${k}' must be between 0 and 100`) }
  for (const t of cfg.docTypes) {
    if (t.active && !t.fields.length) err(400, `Document type '${t.name}' needs at least one field`)
    for (const f of t.fields) if (f.threshold != null && (f.threshold < 0 || f.threshold > 100)) err(400, `Threshold for '${f.label}' must be between 0 and 100`)
  }
  if (!cfg.docTypes.some(t => t.active)) err(400, 'At least one document type must be active')
  cfg.version = p.config.version + 1
  cfg.history = [...p.config.history, { version: cfg.version, at: now, by: USER.name, note: body.note || 'Configuration updated' }]
  delete cfg.note
  p.config = cfg; p.lastModified = now
  return clone(cfg)
}
function simulate(pid, body) {
  const p = project(pid), prop = { ...clone(p.config), ...(body.thresholds && { thresholds: body.thresholds }), ...(body.docTypes && { docTypes: body.docTypes }) }
  const docs = docsOf(pid).filter(d => d.processedAt && d.processedAt >= now - 30 * DAY && d.docType)
  if (!docs.length) return { documents: 0, currentStp: 0, proposedStp: 0, reviewPerDay: 0 }
  const cur = docs.filter(d => evaluate(d, p.config, true).stp).length, nw = docs.filter(d => evaluate(d, prop, true).stp).length
  return { documents: docs.length, currentStp: round1(100 * cur / docs.length), proposedStp: round1(100 * nw / docs.length), reviewPerDay: round1((docs.length - nw) / 30) }
}
function summary(d) {
  return { id: d.id, name: d.name, docType: d.docType, docTypeName: d.docType ? (typeDef(d.projectId, d.docType) || {}).name || 'Unclassified' : 'Classifying…',
    stage: d.stage, proc: d.proc, error: d.error, createdAt: d.createdAt, processedAt: d.processedAt, assignedTo: d.assignedTo, flags: d.flags, stp: d.stp,
    pages: d.pages, completedAt: d.completedAt, completedBy: d.completedBy, reason: d.reason, sla: sla(d) }
}
function filtered(pid, q) {
  let docs = docsOf(pid)
  if (q.q) { const s = q.q.toLowerCase(); docs = docs.filter(d => d.name.toLowerCase().includes(s) || S.batches[d.batchId].name.toLowerCase().includes(s)) }
  if (q.docType) docs = docs.filter(d => d.docType === q.docType)
  if (q.assignee) docs = docs.filter(d => (d.assignedTo || 'unassigned') === q.assignee)
  if (q.sla) docs = docs.filter(d => sla(d).status === q.sla)
  if (q.from) docs = docs.filter(d => S.batches[d.batchId].createdAt >= +q.from)
  if (q.to) docs = docs.filter(d => S.batches[d.batchId].createdAt <= +q.to)
  if (q.mine === '1' || q.mine === 'true') docs = docs.filter(d => S.batches[d.batchId].uploadedBy === USER.id || d.assignedTo === USER.id)
  return docs
}
function counts(pid, q) {
  project(pid)
  const docs = filtered(pid, q), out = { docs: {} }
  for (const s of STAGES) { out[s] = new Set(docs.filter(d => d.stage === s).map(d => d.batchId)).size; out.docs[s] = docs.filter(d => d.stage === s).length }
  return out
}
function listBatches(pid, q) {
  project(pid)
  const stage = q.stage || 'in_progress'
  const docs = filtered(pid, q).filter(d => d.stage === stage), by = {}
  docs.forEach(d => { (by[d.batchId] = by[d.batchId] || []).push(d) })
  const rows = Object.entries(by).map(([bid, bd]) => {
    const b = S.batches[bid], all = Object.values(S.docs).filter(d => d.batchId === bid)
    return { ...b, docs: bd.sort((a, c) => a.name.localeCompare(c.name)).map(summary), total: all.length,
      inProgress: all.filter(d => d.proc === 'processing').length, failed: all.filter(d => d.proc === 'failed').length,
      pending: all.filter(d => d.stage === 'to_review' && d.assignedTo).length, unassigned: all.filter(d => d.stage === 'to_review' && !d.assignedTo).length,
      health: all.some(d => d.proc === 'failed' || d.stage === 'rejected') ? 'error' : 'ok',
      updated: (now - b.updatedAt < 2 * HOUR && b.updatedAt !== b.createdAt) || bd.some(d => d.flags.length),
      modifiedOn: Math.max(b.updatedAt, ...all.map(d => d.processedAt || 0), ...all.map(d => d.completedAt || 0)) }
  })
  const sort = q.sort || 'createdAt', rev = (q.dir || 'desc') === 'desc'
  rows.sort((a, b) => { const x = a[sort], y = b[sort]; const c = typeof x === 'string' ? x.toLowerCase().localeCompare(y.toLowerCase()) : x - y; return rev ? -c : c })
  const size = +(q.pageSize || 10), pages = Math.max(1, Math.ceil(rows.length / size)), page = Math.min(Math.max(1, +(q.page || 1)), pages)
  return { rows: rows.slice((page - 1) * size, page * size), page, pages, total: rows.length }
}
function workload(pid) {
  const docs = docsOf(pid)
  return { reviewers: [...REVIEWERS, USER].map(r => { const m = docs.filter(d => d.assignedTo === r.id); return { id: r.id, name: r.name,
    assigned: m.filter(d => d.stage === 'to_review').length, approved: m.filter(d => d.stage === 'approved' && d.completedBy === r.id).length,
    rejected: m.filter(d => d.stage === 'rejected').length, escalated: m.filter(d => d.stage === 'escalated').length, sent: m.filter(d => d.stage === 'sent' && d.completedBy === r.id).length } }),
    unassigned: docs.filter(d => d.stage === 'to_review' && !d.assignedTo).length }
}
function assign(pid, b) {
  if (![...REVIEWERS, USER].some(r => r.id === b.reviewer)) err(400, 'Unknown reviewer')
  let n = 0
  for (const did of b.docIds || []) { const d = S.docs[did]; if (d && d.projectId === pid && (d.stage === 'to_review' || d.stage === 'escalated')) { d.assignedTo = b.reviewer; d.assignedAt = now; S.batches[d.batchId].updatedAt = now; n++ } }
  if (!n) err(400, 'Select documents in To Review or Escalated to assign')
  return { assigned: n }
}
function upload(pid, b) {
  const p = project(pid)
  if (p.status !== 'Ready') err(400, 'Project is not ready for uploads')
  const files = b.files || []
  if (!files.length) err(400, 'Select at least one file')
  const errors = files.flatMap(f => !ALLOWED.test(f.name) ? [`${f.name}: file type not supported`] : f.size > 20 * 1024 * 1024 ? [`${f.name}: larger than 20 MB`] : [])
  if (errors.length) err(400, 'Some files were rejected', errors)
  const bid = id('b')
  S.batches[bid] = { id: bid, projectId: pid, name: b.batchName || `Upload_Batch_${pad(S.seq.b).padStart(4, '0')}`, createdAt: now, updatedAt: now, origin: 'Direct Upload', uploadedBy: USER.id }
  const active = p.config.docTypes.filter(t => t.active).map(t => t.key)
  files.forEach((f, i) => {
    const low = f.name.toLowerCase()
    const g = low.replace('report', '').includes('po') ? 'purchase_order' : (low.includes('delivery') || low.includes('dn')) ? 'delivery_note' : 'invoice'
    const d = newDoc(pid, bid, active.includes(g) ? g : pick(active), now, f.name)
    d.processAt = now + 4000 + i * 1500 + rint(0, 3000)
    S.docs[d.id] = d
  })
  p.lastModified = now
  return { batchId: bid, documents: files.length }
}
function getDoc(did) {
  const d = docOf(did), p = S.projects[d.projectId]
  const t = d.docType ? typeDef(d.projectId, d.docType) : null
  const ev = d.docType ? evaluate(d) : { fields: {}, blocking: [], stp: false, clsOk: false }
  const fields = (t ? t.fields : []).map(fd => { const f = d.fields[fd.key] || { value: '', conf: 0, sugg: [] }; return { ...fd, value: f.value, conf: f.conf, sugg: f.sugg || [], orig: f.orig ?? null, corrected: !!f.corrected, ...(ev.fields[fd.key] || {}) } })
  const same = docsOf(d.projectId).filter(x => x.stage === d.stage).sort((a, b) => (S.batches[b.batchId].createdAt - S.batches[a.batchId].createdAt) || a.name.localeCompare(b.name))
  const ids = same.map(x => x.id), bids = [...new Set(same.map(x => x.batchId))]
  const i = Math.max(0, ids.indexOf(d.id)), bi = bids.indexOf(d.batchId)
  const inBatch = same.filter(x => x.batchId === d.batchId)
  return { ...summary(d), projectId: p.id, projectName: p.name, batchName: S.batches[d.batchId].name, clsConf: d.clsConf, clsOk: ev.clsOk, stpEligible: ev.stp,
    blocking: ev.blocking, fields, table: t ? t.table : [], lines: d.lines, lineConf: d.lineConf, truth: d.truth, trueType: d.trueType,
    thresholds: p.config.thresholds, docTypes: p.config.docTypes.filter(x => x.active).map(x => ({ key: x.key, name: x.name })),
    nav: { index: i + 1, total: ids.length, prev: i > 0 ? ids[i - 1] : null, next: i + 1 < ids.length ? ids[i + 1] : null,
      batchIndex: bi >= 0 ? bi + 1 : 1, batchTotal: bids.length, docInBatch: inBatch.findIndex(x => x.id === d.id) + 1, batchSize: inBatch.length,
      prevBatch: bi > 0 ? same.find(x => x.batchId === bids[bi - 1]).id : null, nextBatch: bi >= 0 && bi + 1 < bids.length ? same.find(x => x.batchId === bids[bi + 1]).id : null },
    configVersion: d.configVersion, currentConfigVersion: p.config.version }
}
function saveDoc(did, b) {
  const d = docOf(did)
  if (d.stage !== 'to_review' && d.stage !== 'escalated') err(400, 'Only documents in To Review or Escalated can be edited')
  for (const [k, v0] of Object.entries(b.fields || {})) {
    const f = d.fields[k] = d.fields[k] || { value: '', conf: 0, sugg: [] }, v = String(v0).trim()
    if (v !== f.value) { if (!('orig' in f)) f.orig = f.value; f.value = v }
    f.corrected = true
  }
  for (const k of b.confirm || []) if (d.fields[k]) d.fields[k].corrected = true
  if (b.lines != null) { d.lines = b.lines; d.lineConf = b.lines.map(() => 1) }
  d.corrections = Object.values(d.fields).filter(f => 'orig' in f && f.orig !== f.value).length
  S.batches[d.batchId].updatedAt = now
  return getDoc(did)
}
function changeType(did, b) {
  const d = docOf(did)
  if (!typeDef(d.projectId, b.docType)) err(400, 'Unknown document type')
  d.docType = b.docType; d.clsConf = 1; d.flags = [...new Set([...d.flags, 'Reclassified'])]
  runExtraction(d)
  return getDoc(did)
}
function action(did, b) {
  const d = docOf(did), act = b.action, reason = (b.reason || '').trim()
  let award = null
  if (act === 'approve') {
    if (d.stage !== 'to_review' && d.stage !== 'escalated') err(400, 'Document is not awaiting review')
    const ev = evaluate(d)
    if (ev.blocking.length) err(400, 'Mandatory fields are missing or invalid', ev.blocking)
    Object.values(d.fields).forEach(f => { f.corrected = true })
    Object.assign(d, { stage: 'approved', completedAt: now, completedBy: USER.id, assignedTo: d.assignedTo || USER.id, handlingSec: +(b.handlingSec || 120), reason: null, autoSendAt: now + 45000 })
    const within = sla(d).status === 'met'
    award = { points: 10 + (within ? 5 : 0), withinSla: within }
  } else if (act === 'reject' || act === 'escalate') {
    if (!reason) err(400, 'Please give a reason')
    if (d.stage !== 'to_review' && d.stage !== 'escalated') err(400, 'Document is not awaiting review')
    if (act === 'reject') Object.assign(d, { stage: 'rejected', completedAt: now, completedBy: USER.id, reason })
    else Object.assign(d, { stage: 'escalated', reason })
  } else if (act === 'rerun') {
    Object.assign(d, { stage: 'in_progress', proc: 'processing', processAt: now + 6000, completedAt: null, completedBy: null, stp: false, reason: null, error: null, fields: {} })
    d.flags = [...new Set([...d.flags.filter(f => f !== 'Resend'), 'Rerun'])]
  } else if (act === 'resend') {
    if (d.stage !== 'rejected') err(400, 'Only rejected documents can be resent')
    Object.assign(d, { stage: 'to_review', completedAt: null, completedBy: null, reason: null }); d.flags = [...new Set([...d.flags, 'Resend'])]
  } else if (act === 'retry') {
    if (d.proc !== 'failed') err(400, 'Only failed documents can be retried')
    Object.assign(d, { proc: 'processing', processAt: now + 5000, error: null })
  } else err(400, 'Unknown action')
  S.batches[d.batchId].updatedAt = now
  return { ok: true, award, document: summary(d) }
}
function dashboard(pid, q) {
  const p = project(pid), days = +(q.days || 30), end = now, start = end - days * DAY, prevStart = end - 2 * days * DAY
  let docs = docsOf(pid)
  if (q.docType) docs = docs.filter(d => d.docType === q.docType)
  const kpis = (a, b) => {
    const rec = docs.filter(d => d.createdAt >= a && d.createdAt < b)
    const done = docs.filter(d => d.completedAt && d.completedAt >= a && d.completedAt < b && DONE.has(d.stage))
    const proc = done.filter(d => d.stage === 'approved' || d.stage === 'sent'), human = proc.filter(d => !d.stp)
    const ft = human.reduce((s, d) => s + Object.keys(d.fields).length, 0), corr = human.reduce((s, d) => s + d.corrections, 0)
    const tat = proc.map(d => (d.completedAt - d.createdAt) / HOUR), met = done.filter(d => sla(d).status === 'met').length
    return { received: rec.length, processed: proc.length, stpRate: proc.length ? round1(100 * proc.filter(d => d.stp).length / proc.length) : 0,
      accuracy: ft ? round1(100 * (1 - corr / ft)) : 100, turnaround: tat.length ? round1(tat.reduce((a, c) => a + c, 0) / tat.length) : 0,
      slaCompliance: done.length ? round1(100 * met / done.length) : 100, rejectionRate: done.length ? round1(100 * done.filter(d => d.stage === 'rejected').length / done.length) : 0 }
  }
  const open = docs.filter(d => OPEN.has(d.stage))
  const slaOpen = open.filter(d => d.stage !== 'in_progress' || d.proc !== 'processing').map(d => [d, sla(d)])
  const nearest = [...slaOpen].sort((a, b) => a[1].remainingMs - b[1].remainingMs).slice(0, 6)
  const nb = Math.min(days, 30), series = []
  for (let i = nb - 1; i >= 0; i--) { const a = end - (i + 1) * DAY, b = end - i * DAY; series.push({ day: b, received: docs.filter(d => d.createdAt >= a && d.createdAt < b).length, processed: docs.filter(d => d.completedAt && d.completedAt >= a && d.completedAt < b && (d.stage === 'approved' || d.stage === 'sent')).length }) }
  const weeks = []
  for (let i = 11; i >= 0; i--) { const a = end - (i + 1) * 7 * DAY, b = end - i * 7 * DAY; const pr = docs.filter(d => d.completedAt && d.completedAt >= a && d.completedAt < b && (d.stage === 'approved' || d.stage === 'sent')); weeks.push({ week: b, stpRate: pr.length ? round1(100 * pr.filter(d => d.stp).length / pr.length) : null }) }
  const corr = {}
  docs.forEach(d => { if (d.completedAt && d.completedAt >= start) Object.entries(d.fields).forEach(([k, f]) => { if ('orig' in f && f.orig !== f.value) corr[k] = (corr[k] || 0) + 1 }) })
  const labels = {}; p.config.docTypes.forEach(t => t.fields.forEach(f => { labels[f.key] = f.label }))
  const mix = {}
  docs.forEach(d => { if (d.createdAt >= start && d.docType) { const n = (typeDef(pid, d.docType) || {}).name || d.docType; mix[n] = (mix[n] || 0) + 1 } })
  const sc = { on_track: 0, at_risk: 0, breached: 0 }; slaOpen.forEach(([, s]) => { if (s.status in sc) sc[s.status]++ })
  return { days, kpis: kpis(start, end), previous: kpis(prevStart, start), backlog: open.length, unassigned: docs.filter(d => d.stage === 'to_review' && !d.assignedTo).length,
    pipeline: Object.fromEntries(STAGES.map(s => [s, docs.filter(d => d.stage === s).length])),
    sla: { ...sc, targetHours: p.config.sla.turnaroundHours, nearest: nearest.map(([d]) => ({ ...summary(d), batchName: S.batches[d.batchId].name })) },
    throughput: series, stpTrend: weeks, topCorrected: Object.entries(corr).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, c]) => ({ key: k, label: labels[k] || k, count: c })),
    docTypeMix: Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })), reviewers: reviewerStats(docs, start), lastRefreshed: now }
}
function reviewerStats(docs, start) {
  return [...REVIEWERS, USER].map(r => {
    const done = docs.filter(d => d.completedBy === r.id && d.completedAt && d.completedAt >= start), ok = done.filter(d => d.stage === 'approved' || d.stage === 'sent')
    const all = docs.filter(d => d.completedBy === r.id), within = ok.filter(d => sla(d).status === 'met')
    const points = ok.reduce((s, d) => s + 10 + (sla(d).status === 'met' ? 5 : 0), 0) + 3 * done.filter(d => d.stage === 'rejected').length
    const days = [...new Set(done.map(d => Math.floor(d.completedAt / DAY)))].sort((a, b) => a - b)
    let streak = 0, best = 0; days.forEach((dd, i) => { streak = i && dd - days[i - 1] === 1 ? streak + 1 : 1; best = Math.max(best, streak) })
    const badges = []
    if (all.length >= 100) badges.push({ key: 'century', label: 'Century', hint: '100+ documents reviewed' })
    if (ok.length >= 10 && within.length === ok.length) badges.push({ key: 'sla', label: 'SLA Guardian', hint: 'No SLA breaches this period' })
    if (new Set(all.map(d => d.docType)).size >= 3) badges.push({ key: 'multi', label: 'Multi-skilled', hint: 'Reviewed every document type' })
    if (best >= 5) badges.push({ key: 'streak', label: `${best}-day streak`, hint: 'Consecutive working days' })
    return { id: r.id, name: r.name, completed: done.length, open: docs.filter(d => d.assignedTo === r.id && d.stage === 'to_review').length,
      avgHandlingSec: done.length ? Math.round(done.reduce((s, d) => s + (d.handlingSec || 0), 0) / done.length) : 0,
      slaMet: ok.length ? round1(100 * within.length / ok.length) : 100, points, badges }
  }).sort((a, b) => b.points - a.points)
}

/* ---------------------------------------------------------------- router */
const routes = [
  ['GET', /^\/api\/meta$/, () => SEED.meta],
  ['GET', /^\/api\/projects$/, () => listProjects()],
  ['POST', /^\/api\/projects$/, (m, q, b) => createProject(b)],
  ['PATCH', /^\/api\/projects\/(\w+)$/, ([pid], q, b) => { const p = project(pid); ['bookmarked', 'description', 'name'].forEach(k => { if (k in b) p[k] = b[k] }); p.lastModified = now; return { ok: true } }],
  ['GET', /^\/api\/projects\/(\w+)\/config$/, ([pid]) => clone(project(pid).config)],
  ['PUT', /^\/api\/projects\/(\w+)\/config$/, ([pid], q, b) => putConfig(pid, b)],
  ['POST', /^\/api\/projects\/(\w+)\/config\/simulate$/, ([pid], q, b) => simulate(pid, b)],
  ['GET', /^\/api\/projects\/(\w+)\/dashboard$/, ([pid], q) => dashboard(pid, q)],
  ['GET', /^\/api\/projects\/(\w+)\/counts$/, ([pid], q) => counts(pid, q)],
  ['GET', /^\/api\/projects\/(\w+)\/batches$/, ([pid], q) => listBatches(pid, q)],
  ['GET', /^\/api\/projects\/(\w+)\/workload$/, ([pid]) => workload(pid)],
  ['POST', /^\/api\/projects\/(\w+)\/assign$/, ([pid], q, b) => assign(pid, b)],
  ['POST', /^\/api\/projects\/(\w+)\/upload$/, ([pid], q, b) => upload(pid, b)],
  ['GET', /^\/api\/documents\/(\w+)$/, ([did]) => getDoc(did)],
  ['PUT', /^\/api\/documents\/(\w+)$/, ([did], q, b) => saveDoc(did, b)],
  ['POST', /^\/api\/documents\/(\w+)\/doctype$/, ([did], q, b) => changeType(did, b)],
  ['POST', /^\/api\/documents\/(\w+)\/action$/, ([did], q, b) => action(did, b)],
]

export function handle(method, url, body) {
  tick()
  const [path, qs = ''] = url.split('?')
  const q = Object.fromEntries(new URLSearchParams(qs))
  for (const [m, re, fn] of routes) {
    const match = m === method && path.match(re)
    if (match) return fn(match.slice(1), q, body || {})
  }
  err(404, `No mock route for ${method} ${path}`)
}
