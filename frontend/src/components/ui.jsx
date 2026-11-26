import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

/* ---------------------------------------------------------------- toasts */
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2)
    const item = typeof t === 'string' ? { id, text: t } : { id, ...t }
    setItems(x => [...x, item])
    setTimeout(() => setItems(x => x.filter(i => i.id !== id)), item.ms || 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={`toast tk-${t.kind || 'info'}`}>
            {t.kind === 'award'
              ? <span className="toast-award"><Icon name="award" size={22} /></span>
              : <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'checkCircle' : 'info'} size={18} />}
            <div>
              <div className="toast-title">{t.text}</div>
              {t.sub && <div className="toast-sub">{t.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------------------------------------------------------------- modal */
export function Modal({ title, onClose, children, footer, width = 520 }) {
  useEffect(() => {
    const on = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- popover menu */
export function useOutside(ref, onOut, active = true) {
  useEffect(() => {
    if (!active) return
    const on = e => ref.current && !ref.current.contains(e.target) && onOut()
    document.addEventListener('mousedown', on)
    return () => document.removeEventListener('mousedown', on)
  }, [active])
}

export function Menu({ trigger, items, align = 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  useOutside(ref, () => setOpen(false), open)
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && (
        <div className={`menu menu-${align}`} role="menu">
          {items.map((it, i) => it.divider ? <div key={i} className="menu-div" /> : (
            <button key={i} role="menuitem" className={'menu-item' + (it.danger ? ' danger' : '')} disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick?.() }}>
              {it.icon && <Icon name={it.icon} size={16} />}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- small pieces */
export function Toggle({ checked, onChange, label, title }) {
  return (
    <label className="toggle" title={title}>
      <button type="button" role="switch" aria-checked={checked} className={'switch' + (checked ? ' on' : '')} onClick={() => onChange(!checked)}>
        <span className="knob">{checked ? <Icon name="check" size={9} stroke={3} /> : <Icon name="x" size={9} stroke={3} />}</span>
      </button>
      {label && <span>{label}</span>}
    </label>
  )
}

export function Pager({ page, pages, onPage }) {
  const [val, setVal] = useState(page)
  useEffect(() => setVal(page), [page])
  const commit = () => {
    const n = Math.max(1, Math.min(pages, parseInt(val, 10) || 1))
    setVal(n); if (n !== page) onPage(n)
  }
  return (
    <div className="pager">
      <span className="muted">Page</span>
      <div className="pager-group">
        <button className="pg-btn" disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page"><Icon name="first" size={16} /></button>
        <button className="pg-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><Icon name="chevLeft" size={16} /></button>
      </div>
      <div className="pg-field">
        <input value={val} onChange={e => setVal(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()} aria-label="Page number" />
        <span className="muted">/ {pages}</span>
      </div>
      <div className="pager-group">
        <button className="pg-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><Icon name="chevRight" size={16} /></button>
        <button className="pg-btn" disabled={page >= pages} onClick={() => onPage(pages)} aria-label="Last page"><Icon name="last" size={16} /></button>
      </div>
    </div>
  )
}

export const Avatar = ({ id, size = 32, title }) => (
  <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} title={title}>{id}</span>
)

export const Spinner = ({ size = 18 }) => <span className="spinner" style={{ width: size, height: size }} aria-label="Processing" />

export function Empty({ icon = 'documents', title, text, action }) {
  return (
    <div className="empty">
      <div className="empty-ic"><Icon name={icon} size={30} /></div>
      <div className="empty-title">{title}</div>
      {text && <div className="muted">{text}</div>}
      {action}
    </div>
  )
}

export function Skeleton({ rows = 5, h = 48 }) {
  return <div className="skel-wrap">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skel" style={{ height: h }} />)}</div>
}

export const SLA_LABEL = { on_track: 'On track', at_risk: 'At risk', breached: 'Breached', met: 'Met' }
export function SlaChip({ sla, compact }) {
  if (!sla) return null
  const text = sla.status === 'met' ? 'SLA met' : sla.status === 'breached' && sla.remainingMs >= 0 ? 'Breached' : null
  return (
    <span className={`sla sla-${sla.status}`} title={`SLA ${SLA_LABEL[sla.status]}`}>
      <Icon name={sla.status === 'on_track' || sla.status === 'met' ? 'clock' : 'alert'} size={13} />
      {compact ? SLA_LABEL[sla.status] : text || fmtLeft(sla.remainingMs)}
    </span>
  )
}
function fmtLeft(ms) {
  const neg = ms < 0
  let m = Math.round(Math.abs(ms) / 60000)
  const h = Math.floor(m / 60); m -= h * 60
  const s = h ? `${h}h ${m}m` : `${m}m`
  return neg ? `${s} over` : `${s} left`
}

export const FieldStatusIcon = ({ status, selected }) => {
  const k = selected ? 'selected' : status
  const name = k === 'valid' || k === 'selected' ? 'checkCircle' : k === 'error' ? 'xCircle' : 'alert'
  return <span className={`fs fs-${k}`}><Icon name={name} size={15} stroke={2} /></span>
}
