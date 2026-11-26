import React, { useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Empty, Menu, Modal, Pager, useToast } from '../components/ui.jsx'
import { patch, post } from '../api.js'
import { fmtDate, go, useInterval } from '../util.js'
import { useApp } from '../App.jsx'

const STATUS_CLASS = { 'Ready': 'ready', 'Inprogress': 'progress', 'Ready to Delete': 'delete', 'Install Error': 'error' }
const PER_PAGE = 12

export default function Projects({ search }) {
  const { projects, refreshProjects, meta } = useApp()
  const toast = useToast()
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('modified')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  useInterval(refreshProjects, projects.some(p => p.status === 'Inprogress') ? 2000 : 0, [projects])

  const list = useMemo(() => {
    let l = projects.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    if (filter === 'bookmarked') l = l.filter(p => p.bookmarked)
    else if (filter !== 'all') l = l.filter(p => p.status === filter)
    l = [...l].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'status' ? a.status.localeCompare(b.status) : b.lastModified - a.lastModified)
    return [...l.filter(p => p.bookmarked), ...l.filter(p => !p.bookmarked)]
  }, [projects, search, filter, sort])
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE))
  const shown = list.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const open = (p, where = '') => {
    if (p.status === 'Ready') return go(`/p/${p.id}${where}`)
    const why = {
      'Inprogress': 'This project is still being set up. It will open once it is Ready.',
      'Ready to Delete': 'This project is marked for deletion and is read-only.',
      'Install Error': 'Deployment failed. Check the install log or contact your administrator.',
    }[p.status]
    toast({ kind: 'error', text: `${p.name} can’t be opened`, sub: why })
  }
  const bookmark = async (p) => {
    await patch(`/api/projects/${p.id}`, { bookmarked: !p.bookmarked })
    refreshProjects()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>All Projects ({list.length})</h1>
        <div className="toolbar">
          <Menu trigger={({ toggle }) => <button className="btn" onClick={toggle}><Icon name="filter" size={16} />Filter{filter !== 'all' && <span className="badge-dot" />}</button>}
            items={[['all', 'All projects'], ['bookmarked', 'Bookmarked'], ['Ready', 'Ready'], ['Inprogress', 'In progress'], ['Ready to Delete', 'Ready to delete'], ['Install Error', 'Install error']]
              .map(([k, l]) => ({ label: (filter === k ? '✓ ' : '') + l, onClick: () => { setFilter(k); setPage(1) } }))} />
          <Menu trigger={({ toggle }) => <button className="btn" onClick={toggle}><Icon name="sort" size={16} />Sort</button>}
            items={[['modified', 'Last modified'], ['name', 'Name'], ['status', 'Status']].map(([k, l]) => ({ label: (sort === k ? '✓ ' : '') + l, onClick: () => setSort(k) }))} />
          <span className="vsep" />
          <Pager page={page} pages={pages} onPage={setPage} />
          <span className="vsep" />
          <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />Create Project</button>
        </div>
      </div>
      {shown.length === 0 ? <Empty icon="projects" title="No projects match" text="Try another filter or search term." /> : (
        <div className="proj-grid">
          {shown.map((p, i) => (
            <article key={p.id} className="proj-card" style={{ animationDelay: `${i * 25}ms` }} onClick={() => open(p)} tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && open(p)}>
              <div className="proj-top">
                <h3>{p.name}</h3>
                <div onClick={e => e.stopPropagation()}>
                  <Menu trigger={({ toggle }) => <button className="icon-btn" onClick={toggle} aria-label="Project actions"><Icon name="more" /></button>}
                    items={[
                      { label: 'Open dashboard', icon: 'dashboard', onClick: () => open(p) },
                      { label: 'Documents', icon: 'documents', onClick: () => open(p, '/documents') },
                      { label: 'Configure', icon: 'settings', onClick: () => open(p, '/config') },
                      { label: p.bookmarked ? 'Remove bookmark' : 'Bookmark', icon: 'bookmark', onClick: () => bookmark(p) },
                    ]} />
                </div>
              </div>
              <p className="proj-desc">{p.description}</p>
              <div className="proj-meta">{p.docTypes.join(' · ')}{p.documents ? ` · ${p.documents} documents` : ''}</div>
              <div className="proj-foot">
                <span className={`pstatus ps-${STATUS_CLASS[p.status]}`}>{p.status === 'Inprogress' ? 'Inprogress' : p.status}</span>
                <button className={'icon-btn bm' + (p.bookmarked ? ' on' : '')} onClick={e => { e.stopPropagation(); bookmark(p) }}
                  aria-label={p.bookmarked ? 'Remove bookmark' : 'Bookmark project'} title={p.bookmarked ? 'Bookmarked' : 'Bookmark'}>
                  <Icon name="bookmark" size={18} />
                </button>
                <span className="muted small">Last Modified : {fmtDate(p.lastModified)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
      {creating && <CreateProject meta={meta} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refreshProjects() }} />}
    </div>
  )
}

function CreateProject({ meta, onClose, onCreated }) {
  const toast = useToast()
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [types, setTypes] = useState(['invoice'])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const toggle = k => setTypes(t => t.includes(k) ? t.filter(x => x !== k) : [...t, k])
  const create = async () => {
    setBusy(true); setErr('')
    try {
      await post('/api/projects', { name, description: desc, docTypes: types })
      toast({ kind: 'success', text: `Project ${name} created`, sub: 'Setting up… it will be Ready in a few seconds. Fine-tune fields and thresholds in Config.' })
      onCreated()
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <Modal title="Create project" onClose={onClose} width={640}
      footer={<>
        <span className="muted small">Step {step} of 2</span>
        <span className="grow" />
        {step === 2 && <button className="btn" onClick={() => setStep(1)}>Back</button>}
        {step === 1
          ? <button className="btn primary" disabled={!name.trim()} onClick={() => setStep(2)}>Next</button>
          : <button className="btn primary" disabled={!types.length || busy} onClick={create}>{busy ? 'Creating…' : 'Create project'}</button>}
      </>}>
      {step === 1 ? (
        <div className="form">
          <label>Project name<input autoFocus value={name} onChange={e => setName(e.target.value.replace(/\s+/g, '_'))} placeholder="e.g. EMEA_AP_Invoices" /></label>
          <label>Description<textarea rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder="What documents will this project process?" /></label>
        </div>
      ) : (
        <div>
          <p className="muted">Choose the document types this project will handle. Each comes with default fields of interest; you can mark must-have fields and set accuracy thresholds in Config after creation.</p>
          <div className="type-pick">
            {meta.catalogue.map(t => (
              <label key={t.key} className={'type-opt' + (types.includes(t.key) ? ' on' : '')}>
                <input type="checkbox" checked={types.includes(t.key)} onChange={() => toggle(t.key)} />
                <div>
                  <b>{t.name}</b>
                  <div className="muted small">{t.description}</div>
                  <div className="chips">{t.fields.map(f => <span key={f.key} className={'chip' + (f.mandatory ? ' must' : '')}>{f.label}{f.mandatory ? ' *' : ''}</span>)}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
      {err && <div className="form-err"><Icon name="alert" size={16} />{err}</div>}
    </Modal>
  )
}
