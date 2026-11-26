import { useEffect, useRef, useState } from 'react'

const tzName = (() => {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date())
    const n = p.find(x => x.type === 'timeZoneName')?.value || ''
    return n === 'GMT+5:30' ? 'IST' : n
  } catch { return '' }
})()

const pad = n => String(n).padStart(2, '0')

export function fmtDT(ms) {
  if (!ms) return '–'
  const d = new Date(ms)
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${tzName}`
}

export function fmtDate(ms) {
  const d = new Date(ms)
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`
}

export function fmtDuration(ms) {
  const neg = ms < 0
  let m = Math.round(Math.abs(ms) / 60000)
  const d = Math.floor(m / 1440); m -= d * 1440
  const h = Math.floor(m / 60); m -= h * 60
  const s = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
  return neg ? `${s} overdue` : `${s} left`
}

export function fmtSec(s) {
  if (!s) return '–'
  return s >= 60 ? `${Math.floor(s / 60)}m ${pad(s % 60)}s` : `${s}s`
}

export const STAGES = [
  { key: 'in_progress', label: 'In Progress', icon: 'progress' },
  { key: 'to_review', label: 'To Review', icon: 'eye' },
  { key: 'approved', label: 'Approved', icon: 'checkCircle' },
  { key: 'rejected', label: 'Rejected', icon: 'xCircle' },
  { key: 'escalated', label: 'Escalated', icon: 'escalate' },
  { key: 'sent', label: 'Send', icon: 'send' },
]
export const stageLabel = k => STAGES.find(s => s.key === k)?.label || k

export const two = n => String(n).padStart(2, '0')

export function useInterval(fn, ms, deps = []) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!ms) return
    const id = setInterval(() => ref.current(), ms)
    return () => clearInterval(id)
  }, [ms, ...deps])
}

/* Router: hash-based locally (#/p/p1/documents?stage=to_review). The hosted
   preview keeps the route in memory, because its frame owns the URL hash. */
/* global __PREVIEW__ */
const MEM = typeof __PREVIEW__ !== 'undefined' && __PREVIEW__
let memHash = '/'
const current = () => MEM ? memHash : (window.location.hash.replace(/^#/, '') || '/')

export function useRoute() {
  const parse = () => {
    const [path, query = ''] = current().split('?')
    return { path, parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(query)) }
  }
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => setRoute(parse())
    window.addEventListener(MEM ? 'sv-route' : 'hashchange', on)
    let click
    if (MEM) {
      click = e => {
        const a = e.target.closest && e.target.closest('a[href^="#/"]')
        if (a) { e.preventDefault(); go(a.getAttribute('href').slice(1)) }
      }
      document.addEventListener('click', click)
    }
    return () => { window.removeEventListener(MEM ? 'sv-route' : 'hashchange', on); click && document.removeEventListener('click', click) }
  }, [])
  return route
}

export function go(path, query) {
  const q = query ? Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null) : []
  const target = path + (q.length ? '?' + new URLSearchParams(q).toString() : '')
  if (MEM) {
    memHash = target
    window.dispatchEvent(new Event('sv-route'))
    document.querySelector('.main')?.scrollTo?.(0, 0)
  } else window.location.hash = target
}

export function useCountUp(target, ms = 700) {
  const [v, setV] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('no-motion')
    if (reduce || typeof target !== 'number') { setV(target); prev.current = target; return }
    const from = prev.current, t0 = performance.now()
    let raf
    const step = t => {
      const k = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      setV(from + (target - from) * e)
      if (k < 1) raf = requestAnimationFrame(step)
      else prev.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}

export function downloadCSV(filename, rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = rows.map(r => r.map(esc).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
