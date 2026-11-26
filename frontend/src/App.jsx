import React, { createContext, useContext, useEffect, useState } from 'react'
import Icon from './components/Icon.jsx'
import { Avatar, ToastProvider, useToast } from './components/ui.jsx'
import { get, isMock } from './api.js'
import { go, useRoute } from './util.js'
import Projects from './pages/Projects.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Documents from './pages/Documents.jsx'
import Review from './pages/Review.jsx'
import Config from './pages/Config.jsx'

export const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

export default function App() {
  return <ToastProvider><Shell /></ToastProvider>
}

function Shell() {
  const route = useRoute()
  const toast = useToast()
  const [meta, setMeta] = useState(null)
  const [projects, setProjects] = useState([])
  const [search, setSearch] = useState('')
  const [motion, setMotion] = useState(true)
  const [error, setError] = useState(null)

  const refreshProjects = () => get('/api/projects').then(setProjects).catch(e => setError(e.message))
  useEffect(() => {
    get('/api/meta').then(setMeta).catch(e => setError(e.message))
    refreshProjects()
  }, [])
  useEffect(() => { document.body.classList.toggle('no-motion', !motion) }, [motion])

  const [p0, pid, section, docId] = route.parts
  const inProject = p0 === 'p' && pid
  const project = projects.find(p => p.id === pid)
  useEffect(() => { setSearch(route.query.q || '') }, [pid, section])

  if (error) return <div className="fatal"><Icon name="alert" size={28} /><h2>Something went wrong</h2><p>{error}</p></div>
  if (!meta) return <div className="boot"><span className="spinner" style={{ width: 28, height: 28 }} /></div>

  const ctx = { meta, projects, refreshProjects, project, search, motion, setMotion }
  const reviewing = section === 'review'

  const onSearch = (e) => {
    e.preventDefault()
    if (inProject) go(`/p/${pid}/documents`, { ...route.query, stage: route.query.stage || 'to_review', q: search, page: 1 })
  }

  return (
    <AppCtx.Provider value={ctx}>
      <div className={'app' + (reviewing ? ' reviewing' : '')}>
        {!reviewing && (
          <header className="topbar">
            <a className="brand" href="#/">SmartVision</a>
            <form className="gsearch" onSubmit={onSearch} role="search">
              <Icon name="search" size={16} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={inProject ? 'Search by document or batch name' : 'Search for projects'} aria-label="Search" />
              {search && <button type="button" className="icon-btn sm" onClick={() => { setSearch(''); inProject && go(`/p/${pid}/${section || 'documents'}`, { ...route.query, q: '' }) }} aria-label="Clear search"><Icon name="x" size={14} /></button>}
            </form>
            <div className="topbar-right">
              {isMock && <span className="demo-pill" title="Running with the in-browser mock API">Demo data</span>}
              {inProject && project && <span className="proj-name">Project Name: <b>{project.name}</b></span>}
              {inProject && <span className="vsep" />}
              <button className="icon-btn" title="Notifications" aria-label="Notifications" onClick={() => toast('Notification centre arrives in version 2')}><Icon name="bell" size={20} /><span className="dot" /></button>
              {inProject && <button className="icon-btn help" title="Help and support" aria-label="Help" onClick={() => toast('Help: hover any icon for a tooltip; the review workspace supports Tab / Enter / Esc')}><Icon name="help" size={18} /></button>}
              <ProfileMenu meta={meta} motion={motion} setMotion={setMotion} />
            </div>
            <div className="ust">
              <span><b>UST</b> SmartOps</span>
              <Icon name="grid" size={20} />
            </div>
          </header>
        )}
        <div className="body">
          {!reviewing && <Sidebar inProject={inProject} pid={pid} section={section || 'dashboard'} />}
          <main className="main">
            {!inProject && <Projects search={search} />}
            {inProject && !project && projects.length > 0 && <div className="pad">Project not found. <a href="#/">Back to projects</a></div>}
            {inProject && project && (!section || section === 'dashboard') && <Dashboard key={pid} pid={pid} />}
            {inProject && project && section === 'documents' && <Documents key={pid} pid={pid} query={route.query} />}
            {inProject && project && section === 'config' && <Config key={pid} pid={pid} />}
            {inProject && project && section === 'review' && <Review key={docId} pid={pid} docId={docId} query={route.query} />}
          </main>
        </div>
      </div>
    </AppCtx.Provider>
  )
}

function ProfileMenu({ meta, motion, setMotion }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="menu-wrap">
      <button className="avatar-btn" onClick={() => setOpen(o => !o)} aria-label="Profile">{meta.user.id}</button>
      {open && (
        <div className="menu menu-right profile" onMouseLeave={() => setOpen(false)}>
          <div className="profile-head"><Avatar id={meta.user.id} size={36} /><div><b>{meta.user.name}</b><div className="muted">{meta.user.role}</div></div></div>
          <div className="menu-div" />
          <label className="menu-item"><input type="checkbox" checked={motion} onChange={e => setMotion(e.target.checked)} /> Animations</label>
        </div>
      )}
    </div>
  )
}

function Sidebar({ inProject, pid, section }) {
  const items = inProject
    ? [
      { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: `#/p/${pid}` },
      { key: 'documents', label: 'Documents', icon: 'documents', href: `#/p/${pid}/documents` },
      { key: 'search', label: 'Search', icon: 'search', soon: true },
      { key: 'compare', label: 'Compare', icon: 'compare', soon: true },
    ]
    : [{ key: 'projects', label: 'Projects', icon: 'projects', href: '#/' }]
  const active = inProject ? section : 'projects'
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="nav-top">
        {inProject && <a className="nav-item nav-back" href="#/" title="All projects"><Icon name="projects" size={20} /><span>Projects</span></a>}
        {items.map(it => it.soon ? (
          <span key={it.key} className="nav-item disabled" title={`${it.label} – coming in version 2`}><Icon name={it.icon} size={21} /><span>{it.label}</span></span>
        ) : (
          <a key={it.key} className={'nav-item' + (active === it.key ? ' active' : '')} href={it.href}><Icon name={it.icon} size={21} /><span>{it.label}</span></a>
        ))}
      </div>
      <div className="nav-bottom">
        {inProject
          ? <a className={'nav-item' + (active === 'config' ? ' active' : '')} href={`#/p/${pid}/config`}><Icon name="settings" size={20} /><span>Config</span></a>
          : <span className="nav-item disabled" title="Master configuration – coming in version 2"><Icon name="settings" size={20} /><span>Master Co…</span></span>}
        <div className="ust-mark" aria-label="UST"><span>U</span><span className="sq" /><span>S</span><span>T</span></div>
      </div>
    </nav>
  )
}
