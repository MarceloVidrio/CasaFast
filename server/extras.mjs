import { randomUUID, createHash } from 'node:crypto'
import { createMailer } from './email.mjs'

// Funciones extra de CasaFast:
// · vistas por publicación y estadísticas del vendedor
// · marcar como vendida o rentada
// · insignia de vendedor verificado y calificación promedio
// · aviso de baja de precio a quien la tiene en favoritos
// · reportes de publicaciones (comprador → administrador)
// · métricas generales para el administrador

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const DAY = 86400000
export const REPORT_REASONS = {
  fraude: 'Parece fraude o pide dinero por adelantado',
  fotos: 'Las fotos no corresponden a la propiedad',
  vendida: 'Ya se vendió o rentó',
  datos: 'Precio o datos incorrectos',
  otro: 'Otro motivo'
}
const money = n => `$${Math.round(Number(n)).toLocaleString('es-MX')}`

export function createExtras(db, { env = {}, dataDir, mailer: providedMailer, visits, reviews } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS property_views (
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      day TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY(property_id, day, visitor)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL, detail TEXT,
      status TEXT NOT NULL DEFAULT 'abierto', created TEXT NOT NULL, resolved TEXT, resolver TEXT, resolution TEXT
    );`)
  let mailer = providedMailer
  const getMailer = () => (mailer ||= createMailer(env, dataDir))
  const property = id => {
    const r = db.prepare('SELECT * FROM properties WHERE id=?').get(id)
    if (!r) fail('Publicación no encontrada.', 404)
    return { ...JSON.parse(r.data), id: r.id, code: r.code, sellerId: r.seller_id, active: !!r.active }
  }
  const today = () => new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10)
  const audit = (actor, action, target, detail = '') => {
    try { db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(), actor, detail ? `${action}: ${detail}` : action, target, new Date().toISOString()) } catch {}
  }

  // Insignia y calificación por vendedor (se agrega a cada publicación).
  function sellerBadges() {
    const verified = new Set(db.prepare(`SELECT DISTINCT p.seller_id FROM property_reviews r JOIN properties p ON p.id=r.property_id
      WHERE r.status='aprobada' AND r.reviewer IS NOT NULL`).all().map(r => r.seller_id))
    const ratings = new Map(db.prepare('SELECT seller_id,AVG(stars) avg,COUNT(*) n FROM visit_ratings GROUP BY seller_id').all().map(r => [r.seller_id, { avg: Math.round(r.avg * 10) / 10, count: r.n }]))
    return sellerId => ({ sellerVerified: verified.has(sellerId), sellerRating: ratings.get(sellerId) || null })
  }

  // Aviso de baja de precio: a quienes la guardaron en favoritos (no al vendedor).
  async function priceDrop(p, oldPrice) {
    const drop = Number(oldPrice) - Number(p.price)
    if (!(drop > 0)) return
    const pct = Math.round(drop / Number(oldPrice) * 100)
    const people = db.prepare('SELECT u.email,u.name FROM favorites f JOIN users u ON u.id=f.user_id WHERE f.property_id=? AND u.active=1 AND u.id<>?').all(p.id, p.sellerId)
    const m = getMailer()
    if (!m.enabled) return
    for (const person of people) {
      try {
        await m.send({
          email: person.email, name: person.name, purpose: 'notice', subject: `Bajó de precio: ${p.title}`,
          text: `CasaFast\n${p.title} bajó de ${money(oldPrice)} a ${money(p.price)} (${pct}% menos).\nVela en CasaFast.`,
          notice: {
            tone: 'success', icon: '📉', badge: `${pct}% menos`, heading: '¡Una casa que te gusta bajó de precio!',
            intro: 'Guardaste esta propiedad en tus favoritos y el vendedor acaba de bajar su precio. Puede ser un buen momento para agendar una visita.',
            details: [['Propiedad', [p.title, p.location].filter(Boolean).join(' · ')], ['Antes', `${money(oldPrice)}${p.operation === 'renta' ? ' /mes' : ''}`], ['Ahora', `${money(p.price)}${p.operation === 'renta' ? ' /mes' : ''}`]],
            cta: { label: 'Ver la propiedad', query: `?propiedad=${encodeURIComponent(p.id)}` },
            footer: 'Recibes este aviso porque guardaste esta propiedad en tus favoritos de CasaFast.'
          }
        })
      } catch (error) { console.error('[CasaFast] Aviso de baja de precio:', error.message) }
    }
  }

  function metrics() {
    const now = Date.now()
    const weekStart = i => { const d = new Date(now - 7 * 3600000); d.setUTCHours(0, 0, 0, 0); const back = (d.getUTCDay() + 6) % 7; return d.getTime() - back * DAY - i * 7 * DAY + 7 * 3600000 }
    const weeks = Array.from({ length: 8 }, (_, k) => 7 - k).map(i => ({ start: weekStart(i), end: weekStart(i) + 7 * DAY }))
    const label = t => new Date(t).toLocaleDateString('es-MX', { timeZone: 'America/Mazatlan', day: 'numeric', month: 'short' })
    const created = db.prepare("SELECT json_extract(data,'$.created') c, json_extract(data,'$.demo') demo FROM properties").all().filter(r => !r.demo).map(r => Date.parse(r.c)).filter(Number.isFinite)
    const requested = db.prepare("SELECT created FROM visit_events WHERE event='Pendiente'").all().map(r => Date.parse(r.created))
    const since = new Date(now - 30 * DAY).toISOString()
    const reviewed = db.prepare("SELECT submitted,reviewed,due,status FROM property_reviews WHERE reviewed>? AND submitted IS NOT NULL AND reviewer IS NOT NULL").all(since)
    const hours = reviewed.map(r => (Date.parse(r.reviewed) - Date.parse(r.submitted)) / 3600000).filter(h => h >= 0)
    const v = db.prepare(`SELECT
        SUM(CASE WHEN e.event='Pendiente' THEN 1 ELSE 0 END) requested,
        SUM(CASE WHEN e.event='Aceptada' THEN 1 ELSE 0 END) confirmed,
        SUM(CASE WHEN e.event='Cancelada' THEN 1 ELSE 0 END) cancelled,
        SUM(CASE WHEN e.event='Asistió' THEN 1 ELSE 0 END) attended,
        SUM(CASE WHEN e.event='No se presentó' THEN 1 ELSE 0 END) noShows
      FROM visit_events e WHERE e.created>?`).get(since)
    const rating = db.prepare('SELECT AVG(stars) avg,COUNT(*) n,SUM(matched) matched,SUM(seller_arrived) arrived FROM visit_ratings').get()
    const closed = db.prepare("SELECT json_extract(data,'$.closed.result') r,COUNT(*) n FROM properties WHERE json_extract(data,'$.closed.result') IS NOT NULL GROUP BY r").all()
    return {
      weeks: weeks.map(w => ({ label: label(w.start), listings: created.filter(t => t >= w.start && t < w.end).length, visits: requested.filter(t => t >= w.start && t < w.end).length })),
      review: { count: reviewed.length, avgHours: hours.length ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length * 10) / 10 : null, onTime: reviewed.length ? Math.round(reviewed.filter(r => r.reviewed <= r.due).length / reviewed.length * 100) : null, rejected: reviewed.filter(r => r.status === 'rechazada').length },
      visits: { requested: v.requested || 0, confirmed: v.confirmed || 0, cancelled: v.cancelled || 0, attended: v.attended || 0, noShows: v.noShows || 0 },
      ratings: { avg: rating.n ? Math.round(rating.avg * 10) / 10 : null, count: rating.n, matched: rating.n ? Math.round(rating.matched / rating.n * 100) : null, arrived: rating.n ? Math.round(rating.arrived / rating.n * 100) : null },
      closed: { vendida: closed.find(c => c.r === 'vendida')?.n || 0, rentada: closed.find(c => c.r === 'rentada')?.n || 0 },
      reports: db.prepare("SELECT COUNT(*) n FROM reports WHERE status='abierto'").get().n,
      views30: db.prepare('SELECT COUNT(*) n FROM property_views WHERE day>=?').get(new Date(now - 30 * DAY - 7 * 3600000).toISOString().slice(0, 10)).n
    }
  }

  async function handle({ path, method, body, auth, user, send }) {
    // Vista de una publicación (una por persona y día; no cuenta al dueño).
    const view = /^\/api\/properties\/([^/]+)\/view$/.exec(path)
    if (view && method === 'POST') {
      const p = property(view[1])
      if (p.sellerId !== user?.id) {
        const raw = user?.id || (typeof body.visitor === 'string' && /^[a-z0-9-]{8,64}$/i.test(body.visitor) ? body.visitor : '')
        if (raw) db.prepare('INSERT OR IGNORE INTO property_views VALUES(?,?,?)').run(p.id, today(), createHash('sha256').update(raw).digest('hex').slice(0, 24))
      }
      send({ ok: true }); return true
    }

    if (path === '/api/seller/stats' && method === 'GET') {
      const me = auth(['vendedor', 'admin'])
      const ids = db.prepare('SELECT id FROM properties WHERE seller_id=?').all(me.id).map(r => r.id)
      const week = new Date(Date.now() - 7 * DAY - 7 * 3600000).toISOString().slice(0, 10)
      const out = {}
      for (const id of ids) {
        const views = db.prepare('SELECT COUNT(*) n, SUM(CASE WHEN day>=? THEN 1 ELSE 0 END) w FROM property_views WHERE property_id=?').get(week, id)
        const visitsRow = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN attendance='asistio' THEN 1 ELSE 0 END) attended, SUM(CASE WHEN attendance='no_asistio' THEN 1 ELSE 0 END) noShows,
          SUM(CASE WHEN status IN ('Pendiente','Aceptada','Propuesta') AND date>? THEN 1 ELSE 0 END) upcoming FROM appointments WHERE property_id=?`).get(new Date().toISOString(), id)
        const rating = db.prepare('SELECT AVG(stars) avg, COUNT(*) n FROM visit_ratings WHERE property_id=?').get(id)
        out[id] = {
          views: views.n || 0, viewsWeek: views.w || 0,
          favorites: db.prepare('SELECT COUNT(*) n FROM favorites WHERE property_id=?').get(id).n,
          visits: visitsRow.n || 0, upcoming: visitsRow.upcoming || 0, attended: visitsRow.attended || 0, noShows: visitsRow.noShows || 0,
          rating: rating.n ? { avg: Math.round(rating.avg * 10) / 10, count: rating.n } : null
        }
      }
      send(out); return true
    }

    // Marcar como vendida o rentada: sale del catálogo, se cancelan sus visitas futuras.
    const close = /^\/api\/properties\/([^/]+)\/close$/.exec(path)
    if (close && method === 'POST') {
      const me = auth(['vendedor', 'admin'])
      const p = property(close[1])
      if (p.sellerId !== me.id && me.role !== 'admin') fail('Solo puedes gestionar tus publicaciones.', 403)
      if (!['vendida', 'rentada'].includes(body.result)) fail('Indica si se vendió o se rentó.')
      const { id: _i, code: _c, sellerId: _s, active: _a, ...data } = p
      db.prepare('UPDATE properties SET data=?,active=0 WHERE id=?').run(JSON.stringify({ ...data, closed: { result: body.result, date: new Date().toISOString() } }), p.id)
      const cancelled = visits?.cancelForProperty ? visits.cancelForProperty(p.id, `La propiedad se ${body.result === 'vendida' ? 'vendió' : 'rentó'}.`) : 0
      send({ ok: true, cancelled }); return true
    }

    // Reportar una publicación.
    if (path === '/api/reports' && method === 'POST') {
      const me = auth()
      const p = property(body.propertyId)
      if (p.sellerId === me.id) fail('No puedes reportar tu propia publicación.')
      if (!REPORT_REASONS[body.reason]) fail('Elige el motivo del reporte.')
      const detail = typeof body.detail === 'string' ? body.detail.trim().slice(0, 600) : ''
      if (body.reason === 'otro' && detail.length < 5) fail('Cuéntanos brevemente qué ocurre.')
      if (db.prepare("SELECT 1 FROM reports WHERE property_id=? AND reporter_id=? AND status='abierto'").get(p.id, me.id)) fail('Ya reportaste esta publicación. Nuestro equipo la está revisando.', 409)
      if (db.prepare('SELECT COUNT(*) n FROM reports WHERE reporter_id=? AND created>?').get(me.id, new Date(Date.now() - DAY).toISOString()).n >= 10) fail('Enviaste muchos reportes hoy. Intenta mañana.', 429)
      db.prepare('INSERT INTO reports(id,property_id,reporter_id,reason,detail,created) VALUES(?,?,?,?,?,?)').run(randomUUID(), p.id, me.id, body.reason, detail || null, new Date().toISOString())
      const open = db.prepare("SELECT COUNT(*) n FROM reports WHERE property_id=? AND status='abierto'").get(p.id).n
      void reviews?.notifyAdmins?.('🚩 Nueva publicación reportada', `«${p.title}»${p.code ? ` (folio ${p.code})` : ''}: ${REPORT_REASONS[body.reason]}.${detail ? `\n${detail}` : ''}`, {
        tone: 'danger', icon: '🚩', badge: open > 1 ? `${open} reportes` : 'Reporte nuevo', heading: 'Reportaron una publicación',
        intro: 'Un usuario marcó esta publicación como sospechosa o con información incorrecta. Revísala cuando puedas.',
        details: [['Publicación', [p.title, p.location].filter(Boolean).join(' · ')], ['Folio', p.code], ['Motivo', REPORT_REASONS[body.reason]], ['Comentario', detail]],
        cta: { label: 'Ver reportes', query: '?admin' }, footer: 'Recibes este aviso porque tu cuenta administra CasaFast.'
      })?.catch?.(() => {})
      send({ ok: true }, 201); return true
    }

    if (path === '/api/admin/reports' && method === 'GET') {
      auth(['admin'])
      const rows = db.prepare(`SELECT r.*,p.data,p.code,p.active,p.seller_id,u.name reporter_name,u.email reporter_email,s.name seller_name,s.email seller_email
        FROM reports r JOIN properties p ON p.id=r.property_id JOIN users u ON u.id=r.reporter_id JOIN users s ON s.id=p.seller_id
        WHERE r.status='abierto' OR r.resolved>? ORDER BY CASE r.status WHEN 'abierto' THEN 0 ELSE 1 END, r.created DESC LIMIT 200`).all(new Date(Date.now() - 30 * DAY).toISOString())
      send(rows.map(r => { const d = JSON.parse(r.data); return {
        id: r.id, propertyId: r.property_id, code: r.code, title: d.title, location: d.location, image: d.images?.[0], active: !!r.active,
        reason: r.reason, reasonLabel: REPORT_REASONS[r.reason], detail: r.detail || '', status: r.status, created: r.created, resolved: r.resolved, resolution: r.resolution || '',
        reporter: { name: r.reporter_name, email: r.reporter_email }, seller: { id: r.seller_id, name: r.seller_name, email: r.seller_email },
        total: db.prepare('SELECT COUNT(*) n FROM reports WHERE property_id=?').get(r.property_id).n
      } })); return true
    }

    const resolve = /^\/api\/admin\/reports\/([^/]+)$/.exec(path)
    if (resolve && method === 'POST') {
      const admin = auth(['admin'])
      const r = db.prepare('SELECT * FROM reports WHERE id=?').get(resolve[1])
      if (!r) fail('Reporte no encontrado.', 404)
      if (r.status !== 'abierto') fail('Este reporte ya se atendió.', 409)
      if (!['resuelto', 'descartado'].includes(body.status)) fail('Estado inválido.')
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : ''
      // Al resolver, se cierran juntos todos los reportes abiertos de esa publicación.
      db.prepare("UPDATE reports SET status=?,resolved=?,resolver=?,resolution=? WHERE property_id=? AND status='abierto'").run(body.status, new Date().toISOString(), admin.id, note || null, r.property_id)
      audit(admin.id, body.status === 'resuelto' ? 'resolver reporte' : 'descartar reporte', r.property_id, note)
      send({ ok: true }); return true
    }

    if (path === '/api/admin/metrics' && method === 'GET') {
      auth(['admin']); send(metrics()); return true
    }
    return false
  }

  return { handle, sellerBadges, priceDrop, metrics }
}
