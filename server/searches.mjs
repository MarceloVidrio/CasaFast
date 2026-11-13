import { randomUUID } from 'node:crypto'

// Búsquedas guardadas: cada cuenta conserva hasta MAX_SEARCHES combinaciones de filtros.
// El servidor solo guarda filtros saneados y la fecha de la última revisión;
// el navegador calcula las coincidencias con el mismo motor de búsqueda del catálogo,
// así una búsqueda guardada siempre muestra exactamente lo que el usuario vería.
export const MAX_SEARCHES = 10
const OPERATIONS = ['', 'venta', 'renta']
const TYPES = ['', 'Casa', 'Departamento', 'Terreno']
const SORTS = ['new', 'low', 'high', 'near']
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }

function optionalNumber(value, min, max) {
  if (value === '' || value === null || value === undefined) return ''
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) fail('La búsqueda contiene un valor fuera de rango.')
  return String(n)
}

function text(value, max) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > max) fail('La búsqueda contiene un texto inválido.')
  return value.trim()
}

export function cleanFilters(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Filtros inválidos.')
  const operation = raw.operation ?? ''
  const type = raw.type ?? ''
  const sort = raw.sort ?? 'new'
  if (!OPERATIONS.includes(operation)) fail('Operación inválida.')
  if (!TYPES.includes(type)) fail('Tipo inválido.')
  if (!SORTS.includes(sort)) fail('Orden inválido.')
  let center = null
  if (raw.center !== undefined && raw.center !== null) {
    const lat = Number(raw.center?.lat), lng = Number(raw.center?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail('Centro de búsqueda inválido.')
    center = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 }
  }
  return {
    operation,
    type,
    sort,
    query: text(raw.query, 120),
    city: text(raw.city, 60),
    max: optionalNumber(raw.max, 1, 1e10),
    rooms: optionalNumber(raw.rooms, 0, 100),
    radius: optionalNumber(raw.radius, 1, 50),
    center
  }
}

export function createSearches(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS saved_searches(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filters TEXT NOT NULL,
    created TEXT NOT NULL,
    last_seen TEXT NOT NULL
  )`)
  const view = r => ({ id: r.id, name: r.name, filters: JSON.parse(r.filters), created: r.created, lastSeen: r.last_seen })
  const own = (id, userId) => {
    const row = db.prepare('SELECT * FROM saved_searches WHERE id=? AND user_id=?').get(id, userId)
    if (!row) fail('Búsqueda no encontrada.', 404)
    return row
  }

  async function handle({ path, method, body, auth, send }) {
    if (!path.startsWith('/api/searches')) return false
    const user = auth()
    if (path === '/api/searches' && method === 'GET') {
      return send(db.prepare('SELECT * FROM saved_searches WHERE user_id=? ORDER BY created DESC').all(user.id).map(view)), true
    }
    if (path === '/api/searches' && method === 'POST') {
      const name = text(body.name, 60)
      if (!name) fail('Ponle un nombre a tu búsqueda.')
      const filters = cleanFilters(body.filters)
      const count = db.prepare('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id=?').get(user.id).n
      if (count >= MAX_SEARCHES) fail(`Puedes guardar hasta ${MAX_SEARCHES} búsquedas. Elimina una para continuar.`, 409)
      const now = new Date().toISOString()
      const id = randomUUID()
      db.prepare('INSERT INTO saved_searches VALUES(?,?,?,?,?,?)').run(id, user.id, name, JSON.stringify(filters), now, now)
      return send(view(own(id, user.id)), 201), true
    }
    const seen = /^\/api\/searches\/([^/]+)\/seen$/.exec(path)
    if (seen && method === 'POST') {
      own(seen[1], user.id)
      db.prepare('UPDATE saved_searches SET last_seen=? WHERE id=?').run(new Date().toISOString(), seen[1])
      return send(view(own(seen[1], user.id))), true
    }
    const single = /^\/api\/searches\/([^/]+)$/.exec(path)
    if (single && method === 'DELETE') {
      own(single[1], user.id)
      db.prepare('DELETE FROM saved_searches WHERE id=?').run(single[1])
      return send({ ok: true }), true
    }
    fail('Ruta no encontrada.', 404)
  }

  return { handle }
}
