/* API client. Talks to the FastAPI backend, or to the in-browser mock when
   built with __MOCK__ (npm run dev:mock, or the hosted preview). */

/* global __MOCK__, __PREVIEW__ */
const MOCK = typeof __MOCK__ !== 'undefined' && __MOCK__
export const PREVIEW = typeof __PREVIEW__ !== 'undefined' && __PREVIEW__
let mockServer = null

async function loadMock() {
  const m = await import('./mock/server.js')
  // The hosted preview fetches the seed beside the page; local mock mode bundles it.
  const seed = PREVIEW ? await (await fetch('seed.json')).json() : (await import('./mock/seed.json')).default
  m.boot(seed)
  return m
}

export class ApiError extends Error {
  constructor(status, message, detail) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

function qs(params) {
  const p = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return p.length ? '?' + new URLSearchParams(p).toString() : ''
}

export async function api(method, path, body, params) {
  const url = path + qs(params)
  if (MOCK) {
    if (!mockServer) mockServer = loadMock()
    const server = await mockServer
    await new Promise(r => setTimeout(r, 120)) // feel like a network call
    try {
      return structuredClone(server.handle(method, url, body))
    } catch (e) {
      if (e && e.status) throw new ApiError(e.status, e.message, e.detail)
      throw e
    }
  }
  const opts = { method, headers: {} }
  if (body instanceof FormData) opts.body = body
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(url, opts)
  } catch {
    throw new ApiError(0, 'Cannot reach the Clarix API. Is the backend running on port 8000?')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.message || data.detail || 'Request failed', data.detail)
  return data
}

export const get = (path, params) => api('GET', path, undefined, params)
export const post = (path, body) => api('POST', path, body)
export const put = (path, body) => api('PUT', path, body)
export const patch = (path, body) => api('PATCH', path, body)

export async function uploadFiles(pid, files, batchName) {
  if (MOCK) {
    return api('POST', `/api/projects/${pid}/upload`, {
      files: files.map(f => ({ name: f.name, size: f.size })), batchName,
    })
  }
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  if (batchName) fd.append('batchName', batchName)
  return api('POST', `/api/projects/${pid}/upload`, fd)
}

export const isMock = MOCK
