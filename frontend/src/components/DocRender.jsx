import React from 'react'

/* Renders a sample business document as an SVG "scanned page" and returns the
   bounding box of every field, so the review workspace can highlight where each
   extracted value sits on the image. Content comes from doc.truth (what is
   printed); extracted values may differ, as with real OCR. */

export const PAGE_W = 800
export const PAGE_H = 1035
const CW = 0.54 // average glyph width / font size for Arial

const tw = (t, size) => String(t).length * size * CW

function block(els, boxes, key, x, y, lines, { size = 13, weight = 400, lh = 18, anchor = 'start', upper } = {}) {
  const ls = Array.isArray(lines) ? lines : String(lines || '').split('\n')
  let w = 0
  ls.forEach((l, i) => {
    const t = upper ? l.toUpperCase() : l
    els.push({ x, y: y + i * lh, t, size, weight, anchor })
    w = Math.max(w, tw(t, size))
  })
  if (key) {
    const x0 = anchor === 'end' ? x - w : x
    boxes[key] = [x0 - 5, y - size - 2, w + 10, (ls.length - 1) * lh + size + 9]
  }
  return y + ls.length * lh
}

function labelValue(els, boxes, key, label, value, y, lx = 500, vx = 750) {
  els.push({ x: lx, y, t: label, size: 13, weight: 400, fill: '#444' })
  block(els, boxes, key, vx, y, value, { size: 14, weight: 700, anchor: 'end' })
}

export function layoutDocument(doc) {
  const els = [], boxes = {}, rects = [], lines = []
  const tr = doc.truth || { values: {}, lines: [], vendor: {}, buyer: {} }
  const v = tr.values
  const type = doc.trueType || doc.docType
  const L = tr.lines || []

  if (type === 'invoice') {
    block(els, boxes, 'vendor_name', 50, 86, v.vendor_name, { size: 26, weight: 700 })
    let y = block(els, boxes, 'vendor_address', 50, 116, v.vendor_address, { size: 14, lh: 19 })
    els.push({ x: 50, y: y + 6, t: `Phone #  ${tr.vendor?.phone || ''}`, size: 13 })
    els.push({ x: 750, y: 86, t: 'INVOICE', size: 30, weight: 700, anchor: 'end', fill: '#1f3b57' })
    labelValue(els, boxes, 'invoice_number', 'Invoice #', v.invoice_number, 122)
    labelValue(els, boxes, 'invoice_date', 'Invoice date', v.invoice_date, 146)
    labelValue(els, boxes, 'due_date', 'Due date', v.due_date, 170)
    labelValue(els, boxes, 'po_number', 'Customer P.O.', v.po_number, 194)
    labelValue(els, boxes, 'currency', 'Currency', v.currency, 218)
    els.push({ x: 50, y: 262, t: 'Bill To:', size: 14 })
    block(els, boxes, 'bill_to', 50, 288, v.bill_to, { size: 15, weight: 700, lh: 21 })
    tableLayout(els, rects, lines, boxes, 380, L, ['Quantity', 'Item Code', 'Description', 'Price Each', 'Amount'], [50, 135, 255, 590, 680, 750])
    const ty = 380 + 34 + Math.max(L.length, 4) * 30 + 30
    totals(els, boxes, ty, [['Subtotal', 'subtotal', v.subtotal], ['Tax (10%)', 'tax', v.tax], ['Total', 'total_amount', v.total_amount, true]])
    footer(els, rects, 'How to pay: bank transfer to the account shown on your statement. Thank you for your business.')
  } else if (type === 'purchase_order') {
    block(els, boxes, 'buyer_name', 50, 86, v.buyer_name, { size: 26, weight: 700 })
    block(els, null, null, 50, 116, tr.buyer?.address, { size: 14, lh: 19 })
    els.push({ x: 750, y: 86, t: 'PURCHASE ORDER', size: 26, weight: 700, anchor: 'end', fill: '#1f3b57' })
    labelValue(els, boxes, 'po_number', 'PO number', v.po_number, 122)
    labelValue(els, boxes, 'po_date', 'PO date', v.po_date, 146)
    labelValue(els, boxes, 'delivery_date', 'Deliver by', v.delivery_date, 170)
    labelValue(els, boxes, 'payment_terms', 'Terms', v.payment_terms, 194)
    labelValue(els, boxes, 'currency', 'Currency', v.currency, 218)
    els.push({ x: 50, y: 262, t: 'Supplier:', size: 14 })
    block(els, boxes, 'supplier_name', 50, 288, v.supplier_name, { size: 15, weight: 700 })
    block(els, null, null, 50, 309, tr.vendor?.address, { size: 14, lh: 19 })
    els.push({ x: 430, y: 262, t: 'Ship To:', size: 14 })
    block(els, boxes, 'ship_to', 430, 288, v.ship_to, { size: 15, weight: 700, lh: 21 })
    tableLayout(els, rects, lines, boxes, 380, L, ['Quantity', 'Item Code', 'Description', 'Unit Price', 'Amount'], [50, 135, 255, 590, 680, 750])
    const ty = 380 + 34 + Math.max(L.length, 4) * 30 + 30
    totals(els, boxes, ty, [['Total', 'total_amount', v.total_amount, true]])
    footer(els, rects, 'Please quote the PO number on all invoices and delivery notes.')
  } else {
    block(els, boxes, 'supplier_name', 50, 86, v.supplier_name, { size: 26, weight: 700 })
    block(els, null, null, 50, 116, tr.vendor?.address, { size: 14, lh: 19 })
    els.push({ x: 750, y: 86, t: 'DELIVERY NOTE', size: 26, weight: 700, anchor: 'end', fill: '#1f3b57' })
    labelValue(els, boxes, 'delivery_number', 'Delivery #', v.delivery_number, 122)
    labelValue(els, boxes, 'delivery_date', 'Date', v.delivery_date, 146)
    labelValue(els, boxes, 'po_number', 'PO number', v.po_number, 170)
    labelValue(els, boxes, 'carrier', 'Carrier', v.carrier, 194)
    labelValue(els, boxes, 'total_packages', 'Packages', v.total_packages, 218)
    els.push({ x: 50, y: 262, t: 'Deliver To:', size: 14 })
    block(els, boxes, 'recipient', 50, 288, v.recipient, { size: 15, weight: 700 })
    block(els, boxes, 'delivery_address', 50, 311, v.delivery_address, { size: 14, lh: 19 })
    tableLayout(els, rects, lines, boxes, 380, L, ['Quantity', 'Item Code', 'Description'], [50, 150, 290, 750])
    const sy = 380 + 34 + Math.max(L.length, 4) * 30 + 70
    els.push({ x: 50, y: sy, t: 'Received by (name & signature)', size: 13, fill: '#555' })
    lines.push([50, sy + 40, 330, sy + 40]); lines.push([430, sy + 40, 750, sy + 40])
    els.push({ x: 430, y: sy, t: 'Date received', size: 13, fill: '#555' })
    footer(els, rects, 'Please check goods on arrival and report damages within 48 hours.')
  }
  return { els, boxes, rects, lines }
}

function tableLayout(els, rects, lines, boxes, y0, L, heads, xs) {
  const rowH = 30, n = Math.max(L.length, 4)
  rects.push({ x: xs[0], y: y0, w: xs[xs.length - 1] - xs[0], h: 34, fill: '#e9edf1' })
  rects.push({ x: xs[0], y: y0, w: xs[xs.length - 1] - xs[0], h: 34 + n * rowH, stroke: '#333' })
  heads.forEach((h, i) => els.push({ x: xs[i] + 8, y: y0 + 22, t: h, size: 13, weight: 700 }))
  xs.slice(1, -1).forEach(x => lines.push([x, y0, x, y0 + 34 + n * rowH]))
  lines.push([xs[0], y0 + 34, xs[xs.length - 1], y0 + 34])
  const keys = heads.length === 5 ? ['qty', 'item_code', 'description', 'unit_price', 'amount'] : ['qty', 'item_code', 'description']
  L.forEach((r, i) => {
    const y = y0 + 34 + i * rowH + 20
    keys.forEach((k, j) => {
      const right = k === 'unit_price' || k === 'amount' || k === 'qty'
      let t = r[k] || ''
      const maxw = xs[j + 1] - xs[j] - 14
      while (tw(t, 12.5) > maxw && t.length > 3) t = t.slice(0, -2)
      if (t !== (r[k] || '')) t = t.slice(0, -1) + '…'
      els.push({ x: right ? xs[j + 1] - 8 : xs[j] + 8, y, t, size: 12.5, anchor: right ? 'end' : 'start' })
    })
    boxes[`line:${i}`] = [xs[0] + 2, y0 + 34 + i * rowH + 2, xs[xs.length - 1] - xs[0] - 4, rowH - 4]
  })
}

function totals(els, boxes, y, rows) {
  rows.forEach(([label, key, value, bold], i) => {
    els.push({ x: 560, y: y + i * 28, t: label, size: 14, weight: bold ? 700 : 400 })
    block(els, boxes, key, 750, y + i * 28, value ? `$${value}` : '', { size: bold ? 16 : 14, weight: 700, anchor: 'end' })
  })
}

function footer(els, rects, text) {
  rects.push({ x: 50, y: 950, w: 700, h: 1, fill: '#999' })
  els.push({ x: 400, y: 978, t: text, size: 12, anchor: 'middle', fill: '#555' })
}

export default function DocRender({ doc, page = 1, selected, statuses = {}, onPick, showBoxes = true, className = '' }) {
  if (page > 1) {
    return (
      <svg className={'docsvg ' + className} viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} role="img" aria-label={`Page ${page}`}>
        <rect width={PAGE_W} height={PAGE_H} fill="#fff" />
        <text x="50" y="90" fontFamily="Arial" fontSize="20" fontWeight="700">Terms and conditions</text>
        {Array.from({ length: 24 }).map((_, i) => (
          <rect key={i} x="50" y={130 + i * 30} width={i % 5 === 4 ? 380 : 700} height="9" fill="#d9dde2" rx="2" />
        ))}
        <text x="400" y="1000" textAnchor="middle" fontFamily="Arial" fontSize="12" fill="#777">Page {page}</text>
      </svg>
    )
  }
  const { els, boxes, rects, lines } = layoutDocument(doc)
  return (
    <svg className={'docsvg ' + className} viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} role="img" aria-label={doc.name}>
      <defs>
        <filter id="paper"><feTurbulence baseFrequency="0.9" numOctaves="1" seed="3" /><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.025 0" /><feComposite in2="SourceGraphic" operator="in" /></filter>
      </defs>
      <rect width={PAGE_W} height={PAGE_H} fill="#fff" />
      <rect width={PAGE_W} height={PAGE_H} filter="url(#paper)" />
      {rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill || 'none'} stroke={r.stroke || 'none'} strokeWidth="1.2" />)}
      {lines.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke="#333" strokeWidth="1" />)}
      <g transform="rotate(-0.25 400 500)">
        {els.map((e, i) => (
          <text key={i} x={e.x} y={e.y} fontFamily="Arial, Helvetica, sans-serif" fontSize={e.size} fontWeight={e.weight || 400}
            textAnchor={e.anchor || 'start'} fill={e.fill || '#111'} style={{ whiteSpace: 'pre' }}>{e.t}</text>
        ))}
      </g>
      {showBoxes && Object.entries(boxes).map(([k, b]) => {
        const st = statuses[k]
        const isSel = selected === k
        if (!isSel && !st) return null
        return (
          <rect key={k} className={`fbox fbox-${isSel ? 'selected' : st}`} x={b[0]} y={b[1]} width={b[2]} height={b[3]} rx="2"
            onClick={e => { e.stopPropagation(); onPick && onPick(k) }} />
        )
      })}
    </svg>
  )
}
