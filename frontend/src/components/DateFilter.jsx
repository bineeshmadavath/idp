import React, { useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { useOutside } from './ui.jsx'

const DAY = 86400000
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function longFmt(d) {
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`
}
export const describeRange = (from, to) =>
  from && to ? `${longFmt(new Date(+from))} – ${longFmt(new Date(+to))}` : from ? `After ${longFmt(new Date(+from))}` : to ? `Before ${longFmt(new Date(+to))}` : ''

function Month({ view, setView, start, end, onPick, nav = 'both' }) {
  const y = view.getFullYear(), m = view.getMonth()
  const first = new Date(y, m, 1)
  const cells = []
  for (let i = 0; i < 42; i++) cells.push(new Date(y, m, 1 - first.getDay() + i))
  const same = (a, b) => a && b && a.toDateString() === b.toDateString()
  const inRange = d => start && end && d > start && d < end
  return (
    <div className="cal">
      <div className="cal-head">
        {nav !== 'right' ? <button className="icon-btn sm" onClick={() => setView(new Date(y, m - 1, 1))} aria-label="Previous month"><Icon name="chevLeft" size={16} /></button> : <span />}
        <span>{MONTHS[m]} {y}</span>
        {nav !== 'left' ? <button className="icon-btn sm" onClick={() => setView(new Date(y, m + 1, 1))} aria-label="Next month"><Icon name="chevRight" size={16} /></button> : <span />}
      </div>
      <div className="cal-grid">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <span key={d} className="cal-dow">{d}</span>)}
        {cells.map((d, i) => (
          <button key={i} className={'cal-day' + (d.getMonth() !== m ? ' out' : '') + (same(d, start) || same(d, end) ? ' sel' : '') + (inRange(d) ? ' range' : '') + (same(d, new Date()) ? ' today' : '')}
            onClick={() => onPick(d)}>{d.getDate()}</button>
        ))}
      </div>
    </div>
  )
}

function TimePick({ date, onChange }) {
  if (!date) return <div className="timepick muted small">Pick a date</div>
  const h = date.getHours(), mi = date.getMinutes()
  const set = (nh, nm) => { const d = new Date(date); d.setHours(nh, nm, 0, 0); onChange(d) }
  const h12 = h % 12 || 12, pm = h >= 12
  return (
    <div className="timepick">
      <span className="stepper"><button onClick={() => set((h + 23) % 24, mi)} aria-label="Hour down"><Icon name="chevLeft" size={14} /></button><b>{String(h12).padStart(2, '0')}</b><button onClick={() => set((h + 1) % 24, mi)} aria-label="Hour up"><Icon name="chevRight" size={14} /></button></span>
      <span className="stepper"><button onClick={() => set(h, (mi + 59) % 60)} aria-label="Minute down"><Icon name="chevLeft" size={14} /></button><b>{String(mi).padStart(2, '0')}</b><button onClick={() => set(h, (mi + 1) % 60)} aria-label="Minute up"><Icon name="chevRight" size={14} /></button></span>
      <span className="stepper"><button onClick={() => set((h + 12) % 24, mi)} aria-label="Toggle AM PM"><Icon name="chevLeft" size={14} /></button><b>{pm ? 'PM' : 'AM'}</b><button onClick={() => set((h + 12) % 24, mi)} aria-label="Toggle AM PM"><Icon name="chevRight" size={14} /></button></span>
    </div>
  )
}

export default function DateFilter({ from, to, onApply }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  useOutside(ref, () => setOpen(false), open)
  const init = () => {
    const f = from ? new Date(+from) : null, t = to ? new Date(+to) : null
    return { mode: f && t ? 'between' : t ? 'before' : 'after', start: f || (t ? null : null), end: t, preset: f || t ? 'custom' : null }
  }
  const [st, setSt] = useState(init)
  const [view, setView] = useState(() => { const d = from ? new Date(+from) : new Date(); return new Date(d.getFullYear(), d.getMonth() - (from ? 0 : 0), 1) })
  const active = !!(from || to)

  const openIt = () => { setSt(init()); setOpen(o => !o) }
  const pick = d => {
    const keep = (base, src) => { const n = new Date(d); n.setHours(src ? src.getHours() : 10, src ? src.getMinutes() : 0, 0, 0); return n }
    setSt(s => {
      if (s.mode !== 'between') return { ...s, preset: 'custom', [s.mode === 'before' ? 'end' : 'start']: keep(d, s.mode === 'before' ? s.end : s.start) }
      if (!s.start || (s.start && s.end)) return { ...s, preset: 'custom', start: keep(d, s.start), end: null }
      const n = keep(d, s.end || s.start)
      return n < s.start ? { ...s, start: n, end: s.start } : { ...s, end: n }
    })
  }
  const preset = p => {
    const now = new Date()
    const start = p === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : new Date(now - { week: 7, month: 30, year: 365 }[p] * DAY)
    setSt({ mode: 'between', start, end: now, preset: p })
    setView(new Date(start.getFullYear(), start.getMonth(), 1))
  }
  const value = st.mode === 'between' ? [st.start, st.end] : st.mode === 'before' ? [null, st.end] : [st.start, null]
  const valid = st.mode === 'between' ? st.start && st.end && st.end > st.start : !!(value[0] || value[1])
  const apply = () => { onApply(value[0] ? +value[0] : '', value[1] ? +value[1] : ''); setOpen(false) }
  const reset = () => { setSt({ mode: 'after', start: null, end: null, preset: null }); onApply('', ''); setOpen(false) }
  const second = new Date(view.getFullYear(), view.getMonth() + 1, 1)

  return (
    <div className="menu-wrap" ref={ref}>
      <button className={'icon-btn bordered' + (active ? ' active' : '')} onClick={openIt} title={active ? describeRange(from, to) : 'Filter by batch date'} aria-label="Date filter">
        <Icon name="calendar" size={17} />{active && <span className="badge-dot" />}
      </button>
      {open && (
        <div className={'datepop' + (st.mode === 'between' ? ' wide' : '')} role="dialog" aria-label="Select date">
          <div className="dp-head">
            <b>Select Date</b>
            {['before', 'after', 'between'].map(m => (
              <label key={m} className="radio"><input type="radio" checked={st.mode === m} onChange={() => setSt(s => ({ ...s, mode: m, preset: 'custom' }))} />{m[0].toUpperCase() + m.slice(1)}</label>
            ))}
            <span className="grow" />
            <button className="icon-btn sm" onClick={() => setOpen(false)} aria-label="Close"><Icon name="x" size={16} /></button>
          </div>
          <div className="dp-body">
            <div className="dp-cals">
              <div className="dp-col">
                <Month view={view} setView={setView} start={value[0]} end={value[1]} onPick={pick} nav={st.mode === 'between' ? 'left' : 'both'} />
                <TimePick date={st.mode === 'before' ? st.end : st.start} onChange={d => setSt(s => ({ ...s, [s.mode === 'before' ? 'end' : 'start']: d }))} />
              </div>
              {st.mode === 'between' && (
                <div className="dp-col">
                  <Month view={second} setView={d => setView(new Date(d.getFullYear(), d.getMonth() - 1, 1))} start={value[0]} end={value[1]} onPick={pick} nav="right" />
                  <TimePick date={st.end} onChange={d => setSt(s => ({ ...s, end: d }))} />
                </div>
              )}
              <div className="dp-summary">
                {st.mode === 'between'
                  ? <><span>{st.start ? longFmt(st.start) : 'Start date'}</span><span className="muted">to</span><span>{st.end ? longFmt(st.end) : 'End date'}</span></>
                  : <span>{value[0] || value[1] ? `${st.mode === 'before' ? 'Before' : 'After'} ${longFmt(value[0] || value[1])}` : 'Pick a date'}</span>}
              </div>
            </div>
            <div className="dp-side">
              {[['today', 'Today'], ['week', 'Last Week'], ['month', 'Last Month'], ['year', 'Last Year']].map(([k, l]) => (
                <button key={k} className={'dp-preset' + (st.preset === k ? ' on' : '')} onClick={() => preset(k)}>{l}</button>
              ))}
              <button className={'dp-preset' + (st.preset === 'custom' ? ' on' : '')} onClick={() => setSt(s => ({ ...s, preset: 'custom' }))}>Custom</button>
              <span className="grow" />
              <button className="btn" onClick={reset}>Reset</button>
              <button className="btn primary" disabled={!valid} onClick={apply}>Select</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
