import { randomUUID } from 'node:crypto'
import { createVisitNotifications } from './visit-notifications.mjs'

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const zone = 'America/Mazatlan'
const hour = 3600000
// Fecha corta y clara para correos y WhatsApp: «jueves 12 de noviembre, 10:00 a.m. (hora de Culiacán)».
// Las visitas son dentro de los próximos 90 días, así que el año no hace falta.
const display = date => {
  const d = new Date(date)
  const day = d.toLocaleDateString('es-MX', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')
  const time = d.toLocaleTimeString('es-MX', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true })
  return `${day}, ${time} (hora de Culiacán)`
}
// Enlace corto de Google Maps (se ve mejor en WhatsApp y abre igual la app de mapas).
const mapLink = (lat, lng) => `https://maps.google.com/?q=${Math.round(lat * 1e5) / 1e5},${Math.round(lng * 1e5) / 1e5}`
const isoDate = input => {
  if (typeof input !== 'string' || !Number.isFinite(Date.parse(input))) fail('Selecciona un horario válido.')
  const d = new Date(input)
  if (d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0) fail('Las visitas comienzan en horas completas y duran 60 minutos.')
  if (d.getTime() < Date.now() + hour || d.getTime() > Date.now() + 90 * 86400000) fail('Elige un horario con al menos una hora de anticipación, dentro de los próximos 90 días.')
  return d.toISOString()
}
// Agenda abierta: si una propiedad no tiene horarios publicados, el comprador puede
// pedir cualquier hora completa de 9:00 a 18:00 (Culiacán, UTC−7) en los próximos 14 días.
// El vendedor confirma, rechaza o propone otra hora, igual que con un horario publicado.
// Los identificadores de esos horarios son «open:<fecha ISO>».
const NO_SHOW_LIMIT = 3
const OPEN_DAYS = 14, OPEN_FIRST_HOUR = 9, OPEN_LAST_HOUR = 18
const localHour = iso => (new Date(iso).getUTCHours() + 24 - 7) % 24
function openDates() {
  const dates = [], start = new Date(Date.now() + hour)
  start.setUTCMinutes(0, 0, 0)
  for (let t = start.getTime() + hour; t < Date.now() + OPEN_DAYS * 86400000; t += hour) {
    const h = localHour(t)
    if (h >= OPEN_FIRST_HOUR && h <= OPEN_LAST_HOUR) dates.push(new Date(t).toISOString())
  }
  return dates
}

export function createVisits(db, options) {
  for (const [name, sql] of Object.entries({ slot_id: 'TEXT', proposed_slot_id: 'TEXT', proposed_date: 'TEXT', proposed_by: 'TEXT', previous_status: 'TEXT', hold_until: 'INTEGER', phone: 'TEXT', consent_at: 'TEXT', revision: 'INTEGER NOT NULL DEFAULT 0', confirmed_address: 'TEXT', confirmed_map: 'TEXT', reminded_24: 'TEXT', reminded_2: 'TEXT', attendance: 'TEXT' })) {
    if (!db.prepare('PRAGMA table_info(appointments)').all().some(c => c.name === name)) db.exec(`ALTER TABLE appointments ADD COLUMN ${name} ${sql}`)
  }
  db.exec(`CREATE TABLE IF NOT EXISTS visit_slots (
    id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL,
    UNIQUE(seller_id,date)
  ); CREATE TABLE IF NOT EXISTS visit_events (
    id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    actor TEXT, event TEXT NOT NULL, created TEXT NOT NULL, detail TEXT
  )`)
  // Modo vacaciones: un periodo por vendedor (días completos, hora de Culiacán).
  db.exec(`CREATE TABLE IF NOT EXISTS seller_vacations (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    start_day TEXT NOT NULL, end_day TEXT NOT NULL, note TEXT, created TEXT NOT NULL
  )`)
  // Bloqueos puntuales del vendedor (por ejemplo «el jueves en la tarde no puedo») y calificaciones de visitas.
  db.exec(`CREATE TABLE IF NOT EXISTS seller_blocks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start TEXT NOT NULL, end TEXT NOT NULL, note TEXT, created TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS visit_ratings (
    appointment_id TEXT PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
    buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, property_id TEXT NOT NULL,
    stars INTEGER NOT NULL, seller_arrived INTEGER NOT NULL, matched INTEGER NOT NULL, comment TEXT, created TEXT NOT NULL
  )`)
  const notifications = createVisitNotifications(db, options)
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value } catch (e) { db.exec('ROLLBACK'); throw e } }
  const property = id => {
    // Solo admite visitas si está activa, su vendedor está activo y la documentación fue aprobada.
    const hasReviews = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='property_reviews'").get()
    const r = db.prepare(`SELECT p.*,u.active seller_active${hasReviews ? ',rv.status review_status,rv.admin_hold' : ''} FROM properties p JOIN users u ON u.id=p.seller_id${hasReviews ? ' LEFT JOIN property_reviews rv ON rv.property_id=p.id' : ''} WHERE p.id=?`).get(id)
    if (!r) fail('Publicación no encontrada.', 404)
    const approved = !r.review_status || (r.review_status === 'aprobada' && !r.admin_hold)
    return { ...JSON.parse(r.data), id: r.id, sellerId: r.seller_id, active: !!r.active && !!r.seller_active && approved }
  }
  const event = (a, actor, action, detail = '') => db.prepare('INSERT INTO visit_events VALUES(?,?,?,?,?,?)').run(randomUUID(), a.id, actor, action, new Date().toISOString(), detail)
  function queue(a, action, { exact = false } = {}) {
    const p = property(a.property_id)
    const buyer = db.prepare('SELECT * FROM users WHERE id=?').get(a.buyer_id)
    const seller = db.prepare('SELECT * FROM users WHERE id=?').get(p.sellerId)
    const subject = ({ Pendiente: 'Solicitud de visita pendiente', Aceptada: 'Visita confirmada', Rechazada: 'Solicitud de visita rechazada', Cancelada: 'Visita cancelada', Propuesta: 'Nuevo horario propuesto', Reprogramada: 'Visita reprogramada', Vencida: 'Solicitud de visita vencida', Conservada: 'Se conserva el horario anterior', Recordatorio24: 'Recordatorio: tu visita es mañana', Recordatorio2: 'Tu visita es en 2 horas' })[action] || action
    const date = action === 'Propuesta' ? a.proposed_date : a.date
    for (const person of [buyer, seller]) {
      if (!person?.active) continue
      // Antes de confirmar no se comparte el domicilio exacto: solo la zona pública del anuncio.
      const active = ['Pendiente', 'Propuesta', 'Conservada', 'Reprogramada'].includes(action)
      const zone = typeof p.location === 'string' && p.location.trim() ? `Zona: ${p.location.trim()}.` : ''
      const payload = { revision: a.revision, email: person.email, name: person.name, title: p.title, subject, when: display(date), address: exact ? a.confirmed_address : '', mapUrl: exact ? a.confirmed_map : '',
        addressHint: active ? `${zone} La dirección exacta llega al confirmar la visita.`.trim() : zone || 'No aplica para esta visita.',
        mapHint: active ? 'Te la enviaremos en cuanto se confirme la visita.' : 'No aplica para esta visita.' }
      payload.visit = { appointmentId: a.id, code: db.prepare('SELECT code FROM appointments WHERE id=?').get(a.id)?.code || '', event: action, recipientRole: person.id === buyer.id ? 'buyer' : 'seller', title: p.title, date, deadline: a.hold_until ? new Date(a.hold_until).toISOString() : null, confirmed: exact, address: payload.address, mapUrl: payload.mapUrl }
      payload.text = `CasaFast\n${subject}\n${payload.visit.code ? `Folio: ${payload.visit.code}\n` : ''}${p.title}\n${payload.when}\n${exact ? `Domicilio: ${payload.address}\nUbicación exacta: ${payload.mapUrl}\n` : ''}${action === 'Pendiente' || action === 'Propuesta' ? 'Aún necesita confirmación de la otra persona.\n' : ''}Consulta Mis visitas en CasaFast para ver el estado actual y gestionar cambios.`
      for (const channel of person.id === buyer.id && a.consent_at && a.phone ? ['email', 'whatsapp'] : ['email']) {
        db.prepare('INSERT INTO visit_notifications(id,appointment_id,user_id,channel,event,payload,created) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), a.id, person.id, channel, action, JSON.stringify({ ...payload, phone: a.phone }), new Date().toISOString())
      }
    }
  }
  const get = id => db.prepare('SELECT * FROM appointments WHERE id=?').get(id)
  // Recordatorios de visitas confirmadas: 24 horas y 2 horas antes (correo y WhatsApp).
  // reminded_24 / reminded_2 guardan la fecha recordada; si la visita se mueve, se vuelve a recordar.
  function remind() {
    const now = Date.now()
    const list = db.prepare("SELECT * FROM appointments WHERE status='Aceptada' AND date>? AND date<=?").all(new Date(now).toISOString(), new Date(now + 24 * hour).toISOString())
    for (const a of list) {
      const left = Date.parse(a.date) - now
      const recent = db.prepare('SELECT created FROM visit_events WHERE appointment_id=? ORDER BY created DESC LIMIT 1').get(a.id)
      const justChanged = recent && now - Date.parse(recent.created) < 3 * hour
      if (left <= 2 * hour + 5 * 60000) {
        if (a.reminded_2 === a.date) continue
        db.prepare('UPDATE appointments SET reminded_2=?,reminded_24=? WHERE id=?').run(a.date, a.date, a.id)
        if (!(recent && now - Date.parse(recent.created) < 30 * 60000)) queue(a, 'Recordatorio2', { exact: true })
      } else if (a.reminded_24 !== a.date) {
        db.prepare('UPDATE appointments SET reminded_24=? WHERE id=?').run(a.date, a.id)
        // Si se acaba de confirmar o reprogramar, ese aviso ya sirve de recordatorio.
        if (!justChanged) queue(a, 'Recordatorio24', { exact: true })
      }
    }
  }
  function cleanup() {
    try { remind() } catch (error) { console.error('[CasaFast] Recordatorios:', error.message) }
    const stale = db.prepare("SELECT * FROM appointments WHERE status IN ('Pendiente','Propuesta') AND (hold_until<=? OR date<=? AND status='Pendiente')").all(Date.now(), new Date().toISOString())
    if (!stale.length) return
    transaction(() => { for (const a of stale) {
      const restored = a.status === 'Propuesta' && a.previous_status === 'Aceptada' && Date.parse(a.date) > Date.now()
      db.prepare('UPDATE appointments SET status=?,proposed_slot_id=NULL,proposed_date=NULL,proposed_by=NULL,hold_until=NULL,revision=revision+1 WHERE id=?').run(restored ? 'Aceptada' : 'Vencida', a.id)
      event(a, null, restored ? 'Conservada' : 'Vencida')
      queue(get(a.id), restored ? 'Conservada' : 'Vencida', { exact: restored })
    } })
  }
  const dayStart = day => Date.parse(`${day}T00:00:00-07:00`)
  const localToday = () => new Date(Date.now() - 7 * hour).toISOString().slice(0, 10)
  const vacationRow = sellerId => {
    const v = db.prepare('SELECT * FROM seller_vacations WHERE user_id=?').get(sellerId)
    if (v && dayStart(v.end_day) + 86400000 <= Date.now()) { db.prepare('DELETE FROM seller_vacations WHERE user_id=?').run(sellerId); return null }
    return v || null
  }
  const vacationView = v => v && { start: v.start_day, end: v.end_day, note: v.note || '', active: dayStart(v.start_day) <= Date.now() }
  // ¿La visita [inicio, inicio + 1 h) cae dentro de las vacaciones?
  const inVacation = (v, iso) => !!v && Date.parse(iso) < dayStart(v.end_day) + 86400000 && Date.parse(iso) + hour > dayStart(v.start_day)
  const longDay = day => new Date(`${day}T12:00:00-07:00`).toLocaleDateString('es-MX', { timeZone: zone, day: 'numeric', month: 'long' })
  function free(sellerId, date, exceptId = '') {
    const away = vacationRow(sellerId)
    if (inVacation(away, date)) fail(`El vendedor está de vacaciones del ${longDay(away.start_day)} al ${longDay(away.end_day)}. Elige otra fecha.`, 409)
    const start = Date.parse(date), end = start + hour
    const block = db.prepare('SELECT * FROM seller_blocks WHERE user_id=? AND start<? AND end>?').get(sellerId, new Date(end).toISOString(), new Date(start).toISOString())
    if (block) fail('El vendedor no está disponible en ese horario. Selecciona otro.', 409)
    const booked = db.prepare(`SELECT a.* FROM appointments a JOIN properties p ON p.id=a.property_id
      WHERE p.seller_id=? AND a.id<>? AND a.status IN ('Pendiente','Aceptada','Propuesta')`).all(sellerId, exceptId)
    if (booked.some(a => [a.date, ...(a.status === 'Propuesta' ? [a.proposed_date] : [])].filter(Boolean).some(d => Date.parse(d) < end && Date.parse(d) + hour > start))) fail('El vendedor ya tiene ocupado ese horario. Selecciona otro.', 409)
  }
  const hasPublishedSlots = p => !!db.prepare('SELECT 1 FROM visit_slots WHERE property_id=? AND date>? LIMIT 1').get(p.id, new Date().toISOString())
  function slot(id, p, exceptId) {
    if (typeof id === 'string' && id.startsWith('open:')) {
      if (hasPublishedSlots(p)) fail('Selecciona uno de los horarios publicados por el vendedor.')
      const date = isoDate(id.slice(5))
      const h = localHour(date)
      if (h < OPEN_FIRST_HOUR || h > OPEN_LAST_HOUR || Date.parse(date) > Date.now() + OPEN_DAYS * 86400000) fail('Elige una hora entre 9:00 y 18:00 dentro de los próximos 14 días.')
      free(p.sellerId, date, exceptId)
      return { id: `open:${date}`, date }
    }
    const s = typeof id === 'string' && db.prepare('SELECT * FROM visit_slots WHERE id=? AND property_id=?').get(id, p.id)
    if (!s) fail('Selecciona uno de los horarios publicados por el vendedor.')
    isoDate(s.date); free(p.sellerId, s.date, exceptId)
    return s
  }
  function confirm(a) {
    const p = property(a.property_id)
    if (!p.active) fail('La propiedad ya no está disponible.', 409)
    if (Date.parse(a.date) <= Date.now()) fail('No puedes confirmar una visita que ya pasó.')
    free(p.sellerId, a.date, a.id)
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || !p.address?.trim()) fail('El vendedor debe completar el domicilio y el punto del mapa antes de confirmar.')
    // En anuncios de ejemplo el «domicilio» es un aviso largo: se envía solo la zona, marcada como ejemplo.
    const address = p.demo && p.location ? `${p.location} (ubicación de ejemplo)` : p.address.replace(/\s+/g, ' ').trim()
    db.prepare('UPDATE appointments SET confirmed_address=?,confirmed_map=? WHERE id=?').run(address, mapLink(p.lat, p.lng), a.id)
  }
  if (options.background !== false) {
    const timer = setInterval(() => {
      try { cleanup(); void notifications.flush().catch(() => {}) } catch { /* El siguiente ciclo volverá a intentar. */ }
    }, 30000)
    timer.unref()
  }
  // Al marcar una propiedad como vendida o rentada se cancelan sus visitas futuras y se avisa a ambos.
  function cancelForProperty(propertyId, reason) {
    const list = db.prepare("SELECT * FROM appointments WHERE property_id=? AND status IN ('Pendiente','Aceptada','Propuesta') AND date>?").all(propertyId, new Date().toISOString())
    transaction(() => { for (const a of list) {
      db.prepare("UPDATE appointments SET status='Cancelada',proposed_slot_id=NULL,proposed_date=NULL,proposed_by=NULL,hold_until=NULL,revision=revision+1 WHERE id=?").run(a.id)
      const updated = get(a.id)
      event(updated, null, 'Cancelada', reason)
      queue(updated, 'Cancelada', { exact: !!updated.confirmed_map })
    } })
    void notifications.flush().catch(() => {})
    return list.length
  }
  return {
    cancelForProperty,
    config: { ...notifications.config, visitTimezone: zone, visitDurationMinutes: 60 },
    async handle({ path, method, body, auth, send }) {
      if (!/^\/api\/(visit-slots|appointments|visit-notifications|vacation|blocks)(\/|$)/.test(path)) return false
      const user = auth()
      cleanup()
      if (path === '/api/vacation') {
        if (method === 'GET') { send(vacationView(vacationRow(user.id))); return true }
        if (!['vendedor', 'admin'].includes(user.role)) fail('Solo los vendedores pueden activar el modo vacaciones.', 403)
        if (method === 'DELETE') { db.prepare('DELETE FROM seller_vacations WHERE user_id=?').run(user.id); send({ ok: true, vacation: null }); return true }
        if (method === 'PUT') {
          const valid = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(dayStart(d))
          if (!valid(body.start) || !valid(body.end)) fail('Selecciona la fecha de inicio y la de regreso.')
          if (body.start > body.end) fail('La fecha de regreso debe ser igual o posterior a la de inicio.')
          if (body.end < localToday()) fail('Las vacaciones deben terminar hoy o después.')
          if ((dayStart(body.end) - dayStart(body.start)) / 86400000 > 365) fail('El periodo de vacaciones puede durar hasta un año.')
          const note = typeof body.note === 'string' ? body.note.trim().slice(0, 140) : ''
          const v = { start_day: body.start, end_day: body.end }
          let cancelled = 0
          transaction(() => {
            db.prepare('INSERT INTO seller_vacations VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET start_day=excluded.start_day,end_day=excluded.end_day,note=excluded.note,created=excluded.created').run(user.id, v.start_day, v.end_day, note, new Date().toISOString())
            // Se cancelan las visitas activas de sus propiedades que caen en el periodo.
            const affected = db.prepare(`SELECT a.* FROM appointments a JOIN properties p ON p.id=a.property_id
              WHERE p.seller_id=? AND a.status IN ('Pendiente','Aceptada','Propuesta')`).all(user.id)
              .filter(a => inVacation(v, a.date) || (a.status === 'Propuesta' && a.proposed_date && inVacation(v, a.proposed_date)))
            for (const a of affected) {
              db.prepare("UPDATE appointments SET status='Cancelada',proposed_slot_id=NULL,proposed_date=NULL,proposed_by=NULL,hold_until=NULL,revision=revision+1 WHERE id=?").run(a.id)
              const updated = get(a.id)
              event(updated, user.id, 'Cancelada', `El vendedor estará de vacaciones del ${longDay(v.start_day)} al ${longDay(v.end_day)}.`)
              queue(updated, 'Cancelada', { exact: !!updated.confirmed_map })
              cancelled++
            }
          })
          await notifications.flush()
          send({ ok: true, cancelled, vacation: vacationView(vacationRow(user.id)) }); return true
        }
      }
      // Bloqueos puntuales de horario del vendedor.
      if (path === '/api/blocks' || path.startsWith('/api/blocks/')) {
        if (!['vendedor', 'admin'].includes(user.role)) fail('Solo los vendedores pueden bloquear horarios.', 403)
        if (method === 'GET' && path === '/api/blocks') {
          send(db.prepare('SELECT id,start,end,note FROM seller_blocks WHERE user_id=? AND end>? ORDER BY start').all(user.id, new Date().toISOString())); return true
        }
        if (method === 'POST' && path === '/api/blocks') {
          const start = typeof body.start === 'string' && Date.parse(body.start), end = typeof body.end === 'string' && Date.parse(body.end)
          if (!start || !end || end <= start) fail('Indica un inicio y un fin válidos.')
          if (end <= Date.now()) fail('Ese horario ya pasó.')
          if (end - start > 14 * 86400000) fail('Para ausencias de más de 14 días usa el modo vacaciones.')
          if (db.prepare('SELECT count(*) n FROM seller_blocks WHERE user_id=? AND end>?').get(user.id, new Date().toISOString()).n >= 50) fail('Puedes tener hasta 50 bloqueos activos.')
          const busy = db.prepare(`SELECT a.date FROM appointments a JOIN properties p ON p.id=a.property_id WHERE p.seller_id=? AND a.status IN ('Pendiente','Aceptada','Propuesta') AND a.date<? AND a.date>?`)
            .get(user.id, new Date(end).toISOString(), new Date(start - hour).toISOString())
          if (busy) fail(`Ya tienes una visita el ${display(busy.date)}. Cancélala o propón otro horario antes de bloquear ese tiempo.`, 409)
          const note = typeof body.note === 'string' ? body.note.trim().slice(0, 120) : ''
          const id = randomUUID()
          db.prepare('INSERT INTO seller_blocks VALUES(?,?,?,?,?,?)').run(id, user.id, new Date(start).toISOString(), new Date(end).toISOString(), note || null, new Date().toISOString())
          send({ id }, 201); return true
        }
        if (method === 'DELETE') {
          const r = db.prepare('DELETE FROM seller_blocks WHERE id=? AND user_id=?').run(path.split('/')[3] || '', user.id)
          if (!r.changes) fail('Bloqueo no encontrado.', 404)
          send({ ok: true }); return true
        }
      }
      // Crear una cita desde el panel de administración, con las mismas reglas que la página.
      if (path === '/api/appointments/admin' && method === 'POST') {
        if (user.role !== 'admin') fail('Solo un administrador puede crear citas desde el panel.', 403)
        const key = typeof body.property === 'string' ? body.property.trim() : ''
        if (!key) fail('Indica la propiedad (folio PUB-… o identificador).')
        const row = db.prepare('SELECT id FROM properties WHERE id=? OR upper(code)=upper(?)').get(key, key)
        if (!row) fail('No existe ninguna propiedad con ese folio.', 404)
        const p = property(row.id)
        if (!p.active) fail('Esa propiedad no está activa (retirada, en revisión o su vendedor está suspendido).', 409)
        const email = typeof body.buyerEmail === 'string' ? body.buyerEmail.trim().toLowerCase() : ''
        const buyer = db.prepare('SELECT * FROM users WHERE lower(email)=?').get(email)
        if (!buyer) fail('No existe ninguna cuenta con ese correo. El comprador debe registrarse primero.', 404)
        if (!buyer.active) fail('La cuenta de ese comprador está suspendida.', 409)
        if (buyer.id === p.sellerId) fail('El comprador no puede ser el mismo vendedor de la propiedad.')
        if (!['Pendiente', 'Aceptada'].includes(body.status)) fail('Elige si la cita queda pendiente o confirmada.')
        const date = isoDate(body.date)
        const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1500) : ''
        const id = randomUUID()
        transaction(() => {
          if (db.prepare("SELECT id FROM appointments WHERE buyer_id=? AND property_id=? AND status IN ('Pendiente','Aceptada','Propuesta') AND date>?").get(buyer.id, p.id, new Date().toISOString())) fail('Ese comprador ya tiene una visita activa para esta propiedad. Búscala en la lista y reprográmala.', 409)
          free(p.sellerId, date)
          db.prepare('INSERT INTO appointments(id,property_id,buyer_id,date,message,slot_id,hold_until,revision) VALUES(?,?,?,?,?,?,?,1)').run(id, p.id, buyer.id, date, message, `open:${date}`, Math.min(Date.now() + 48 * hour, Date.parse(date)))
          event({ id }, user.id, 'Pendiente', `Creada por administración (${user.name})`)
          if (body.status === 'Aceptada') {
            confirm(get(id))
            db.prepare("UPDATE appointments SET status='Aceptada',hold_until=NULL,revision=revision+1 WHERE id=?").run(id)
            event({ id }, user.id, 'Aceptada', 'Confirmada por administración')
            queue(get(id), 'Aceptada', { exact: true })
          } else queue(get(id), 'Pendiente')
        })
        await notifications.flush()
        send({ id, code: get(id).code, status: get(id).status }, 201); return true
      }
      // Después de la visita: el vendedor marca asistencia y el comprador califica.
      const after = /^\/api\/appointments\/([^/]+)\/(attendance|rating)$/.exec(path)
      if (after && method === 'POST') {
        const a = get(after[1])
        if (!a) fail('Visita no encontrada.', 404)
        const p = property(a.property_id)
        if (a.status !== 'Aceptada') fail('Solo aplica a visitas confirmadas.', 409)
        if (Date.parse(a.date) > Date.now()) fail('Podrás hacerlo cuando pase la hora de la visita.', 409)
        if (Date.parse(a.date) < Date.now() - 30 * 86400000) fail('Ya pasaron más de 30 días desde la visita.', 409)
        if (after[2] === 'attendance') {
          if (p.sellerId !== user.id) fail('Solo el vendedor puede marcar la asistencia.', 403)
          if (typeof body.attended !== 'boolean') fail('Indica si el comprador asistió.')
          if (a.attendance) fail('La asistencia ya se registró.', 409)
          db.prepare('UPDATE appointments SET attendance=? WHERE id=?').run(body.attended ? 'asistio' : 'no_asistio', a.id)
          event(a, user.id, body.attended ? 'Asistió' : 'No se presentó')
          send({ ok: true }); return true
        }
        if (a.buyer_id !== user.id) fail('Solo el comprador puede calificar la visita.', 403)
        if (a.attendance === 'no_asistio') fail('El vendedor registró que no asististe a esta visita.', 409)
        if (db.prepare('SELECT 1 FROM visit_ratings WHERE appointment_id=?').get(a.id)) fail('Ya calificaste esta visita.', 409)
        const stars = Number(body.stars)
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) fail('Elige de 1 a 5 estrellas.')
        if (typeof body.sellerArrived !== 'boolean' || typeof body.matched !== 'boolean') fail('Responde las dos preguntas.')
        const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 500) : ''
        db.prepare('INSERT INTO visit_ratings VALUES(?,?,?,?,?,?,?,?,?)').run(a.id, user.id, p.sellerId, p.id, stars, body.sellerArrived ? 1 : 0, body.matched ? 1 : 0, comment || null, new Date().toISOString())
        event(a, user.id, 'Calificada', `${stars} de 5 estrellas`)
        send({ ok: true }); return true
      }
      if (path.startsWith('/api/visit-slots/')) {
        const parts = path.split('/'), p = property(parts[3])
        const owner = p.sellerId === user.id || user.role === 'admin'
        if (method === 'GET' && parts.length === 4) {
          const list = db.prepare('SELECT * FROM visit_slots WHERE property_id=? AND date>? ORDER BY date LIMIT 300').all(p.id, new Date().toISOString())
          const slots = list.map(s => { try { isoDate(s.date); free(p.sellerId, s.date); return { ...s, available: true } } catch { return { ...s, available: false } } })
          // Sin horarios publicados: se ofrece la agenda abierta (solo horas libres del vendedor).
          const open = !list.length && p.active
          const openSlots = open ? openDates().flatMap(date => { try { free(p.sellerId, date); return [{ id: `open:${date}`, date, available: true, open: true }] } catch { return [] } }) : []
          send({ timezone: zone, duration: 60, open, vacation: vacationView(vacationRow(p.sellerId)), slots: [...(owner ? slots : slots.filter(s => s.available)), ...openSlots], whatsapp: notifications.config }); return true
        }
        if (!owner) fail('Solo el vendedor puede administrar estos horarios.', 403)
        if (method === 'POST' && parts.length === 4) {
          if (!p.active) fail('Publica la propiedad antes de agregar horarios.')
          if (!Array.isArray(body.dates) || !body.dates.length || body.dates.length > 60) fail('Agrega de 1 a 60 horarios.')
          const dates = [...new Set(body.dates.map(isoDate))]
          transaction(() => {
            if (db.prepare('SELECT count(*) n FROM visit_slots WHERE property_id=? AND date>?').get(p.id, new Date().toISOString()).n + dates.length > 300) fail('Puedes publicar hasta 300 horarios futuros.')
            for (const date of dates) {
              free(p.sellerId, date)
              const existing = db.prepare('SELECT * FROM visit_slots WHERE seller_id=? AND date=?').get(p.sellerId, date)
              if (existing && existing.property_id !== p.id) fail('Ya publicaste ese horario para otra propiedad.', 409)
              db.prepare('INSERT OR IGNORE INTO visit_slots VALUES(?,?,?,?)').run(randomUUID(), p.id, p.sellerId, date)
            }
          }); send({ ok: true }); return true
        }
        if (method === 'DELETE' && parts.length === 5) {
          const s = db.prepare('SELECT * FROM visit_slots WHERE id=? AND property_id=?').get(parts[4], p.id)
          if (!s) fail('Horario no encontrado.', 404)
          free(p.sellerId, s.date)
          db.prepare('DELETE FROM visit_slots WHERE id=?').run(s.id); send({ ok: true }); return true
        }
      }
      if (path === '/api/appointments' && method === 'GET') {
        await notifications.flush()
        const list = db.prepare(`SELECT a.*,u.name buyerName,u.email buyerEmail,p.seller_id sellerId,p.code propertyCode,s.name sellerName,s.email sellerEmail,p.data propertyData FROM appointments a JOIN properties p ON p.id=a.property_id JOIN users u ON u.id=a.buyer_id JOIN users s ON s.id=p.seller_id WHERE a.buyer_id=? OR p.seller_id=? OR ?='admin' ORDER BY a.date DESC`).all(user.id, user.id, user.role)
        // Correos de comprador y vendedor: solo para el administrador.
        send(list.map(({ propertyData, phone: _phone, consent_at: _consent, buyerEmail, sellerEmail, ...a }) => ({ ...a, title: JSON.parse(propertyData).title, ...(user.role === 'admin' ? { buyerEmail, sellerEmail } : {}),
          phone: a.buyer_id === user.id ? _phone : undefined, whatsappConsent: a.buyer_id === user.id && !!_consent,
          rating: (r => r && { stars: r.stars, sellerArrived: !!r.seller_arrived, matched: !!r.matched, comment: r.comment || '' })(db.prepare('SELECT * FROM visit_ratings WHERE appointment_id=?').get(a.id)),
          notifications: notifications.list(a.id, user.id), history: db.prepare('SELECT event,created,detail FROM visit_events WHERE appointment_id=? ORDER BY created').all(a.id) }))); return true
      }
      if (path === '/api/appointments' && method === 'POST') {
        const p = property(body.propertyId)
        if (!p.active) fail('Esta propiedad no está disponible para visitas en este momento.')
        if (p.sellerId === user.id) fail('No puedes agendar una visita a tu propia propiedad.')
        // Quien falta a 3 visitas en 90 días deja de poder agendar hasta que pasen 90 días de la más antigua.
        const misses = db.prepare("SELECT date FROM appointments WHERE buyer_id=? AND attendance='no_asistio' AND date>? ORDER BY date").all(user.id, new Date(Date.now() - 90 * 86400000).toISOString())
        if (misses.length >= NO_SHOW_LIMIT) fail(`No asististe a ${misses.length} visitas en los últimos 90 días, así que por ahora no puedes agendar. Podrás hacerlo de nuevo el ${new Date(Date.parse(misses[0].date) + 90 * 86400000).toLocaleDateString('es-MX', { timeZone: zone, day: 'numeric', month: 'long' })}.`, 403)
        let phone = null
        if (body.whatsappConsent === true) {
          phone = typeof body.phone === 'string' ? body.phone.replace(/[\s()-]/g, '') : ''
          if (!/^\+[1-9]\d{7,14}$/.test(phone)) fail('Escribe tu WhatsApp con código de país, por ejemplo +526671234567.')
        }
        const id = randomUUID()
        transaction(() => {
          const s = slot(body.slotId, p)
          if (db.prepare("SELECT id FROM appointments WHERE buyer_id=? AND property_id=? AND status IN ('Pendiente','Aceptada','Propuesta') AND date>?").get(user.id, p.id, new Date().toISOString())) fail('Ya tienes una visita activa para esta propiedad. Puedes reprogramarla desde Mis visitas.', 409)
          db.prepare('INSERT INTO appointments(id,property_id,buyer_id,date,message,slot_id,hold_until,phone,consent_at,revision) VALUES(?,?,?,?,?,?,?,?,?,1)').run(id, p.id, user.id, s.date, typeof body.message === 'string' ? body.message.trim().slice(0,1500) : '', s.id, Math.min(Date.now()+48*hour, Date.parse(s.date)), phone, phone ? new Date().toISOString() : null)
          event({ id }, user.id, 'Pendiente'); queue(get(id), 'Pendiente')
        })
        await notifications.flush(); send({ id, status: 'Pendiente' }, 201); return true
      }
      if (/^\/api\/appointments\/[^/]+$/.test(path) && method === 'PATCH') {
        const id = path.split('/').pop()
        transaction(() => {
          const a = get(id)
          if (!a) fail('Visita no encontrada.', 404)
          const p = property(a.property_id), seller = user.id === p.sellerId, buyer = user.id === a.buyer_id
          if (!seller && !buyer) fail('No puedes gestionar esta visita.', 403)
          if (body.revision !== a.revision) fail('La visita cambió. Actualiza la información antes de continuar.', 409)
          if (!['Pendiente','Aceptada','Propuesta'].includes(a.status)) fail('Esta solicitud ya fue resuelta.', 409)
          if (Date.parse(a.date) <= Date.now() && !(a.status === 'Propuesta' && Date.parse(a.proposed_date)>Date.now())) fail('Esta visita ya pasó.', 409)
          if (body.status === 'Reprogramar') {
            // El comprador cambia su propia cita: si el horario está libre se aplica al instante.
            // Solo con 12 horas o más de anticipación (respecto a la cita actual y al nuevo horario).
            if (!buyer) fail('Solo el comprador puede reprogramar directamente. Como vendedor, propón otro horario o cancela la visita.', 403)
            if (a.status === 'Propuesta') fail('Primero acepta o rechaza el horario que te propuso el vendedor.', 409)
            if (Date.parse(a.date) - Date.now() < 12 * hour) fail('Solo puedes reprogramar con al menos 12 horas de anticipación. Si tienes un imprevisto, responde al correo de tu cita y te ayudamos.', 409)
            const s = slot(body.slotId, p, id)
            if (s.date === a.date) fail('Selecciona un horario diferente al actual.')
            if (Date.parse(s.date) - Date.now() < 12 * hour) fail('El nuevo horario debe ser al menos 12 horas después de ahora.')
            db.prepare('UPDATE appointments SET date=?,slot_id=?,revision=revision+1 WHERE id=?').run(s.date, s.id, id)
            if (a.status === 'Pendiente') db.prepare('UPDATE appointments SET hold_until=? WHERE id=?').run(Math.min(Date.now() + 48 * hour, Date.parse(s.date)), id)
            if (a.status === 'Aceptada') confirm(get(id))
          } else if (body.status === 'Propuesta') {
            // El vendedor no cambia la hora por su cuenta: solo propone y el comprador decide.
            if (!seller) fail('Para cambiar tu horario usa «Reprogramar».', 403)
            if (a.status === 'Propuesta') fail('Responde primero a la propuesta pendiente.', 409)
            const s = slot(body.slotId, p, id)
            if (s.date === a.date) fail('Selecciona un horario diferente al actual.')
            db.prepare("UPDATE appointments SET status='Propuesta',previous_status=?,proposed_slot_id=?,proposed_date=?,proposed_by=?,hold_until=?,revision=revision+1 WHERE id=?").run(a.status, s.id, s.date, user.id, Math.min(Date.now()+48*hour, Date.parse(s.date), Date.parse(a.date)), id)
          } else if (body.status === 'Aceptada') {
            if (a.status === 'Propuesta') {
              if (user.id === a.proposed_by) fail('La otra persona debe aceptar el nuevo horario.', 403)
              const s = slot(a.proposed_slot_id, p, id)
              db.prepare('UPDATE appointments SET date=?,slot_id=? WHERE id=?').run(s.date, s.id, id)
            } else if (a.status !== 'Pendiente') fail('La visita ya está confirmada.', 409)
            else if (!seller) fail('El vendedor debe confirmar la solicitud.', 403)
            confirm(get(id))
            db.prepare("UPDATE appointments SET status='Aceptada',proposed_slot_id=NULL,proposed_date=NULL,proposed_by=NULL,hold_until=NULL,revision=revision+1 WHERE id=?").run(id)
          } else if (body.status === 'Conservar') {
            if (a.status !== 'Propuesta' || user.id === a.proposed_by) fail('No puedes rechazar esta propuesta.', 403)
            const restored = a.previous_status === 'Aceptada' && Date.parse(a.date)>Date.now()
            db.prepare('UPDATE appointments SET status=?,proposed_slot_id=NULL,proposed_date=NULL,proposed_by=NULL,hold_until=NULL,revision=revision+1 WHERE id=?').run(restored ? 'Aceptada' : 'Rechazada', id)
          } else if (body.status === 'Cancelada' || body.status === 'Rechazada' && seller && a.status === 'Pendiente') {
            // El comprador solo cancela con 12 horas o más de anticipación (igual que para reprogramar).
            if (body.status === 'Cancelada' && buyer && !seller && Date.parse(a.date) - Date.now() < 12 * hour) fail('Solo puedes cancelar con al menos 12 horas de anticipación. Si tienes un imprevisto, responde al correo de tu cita y te ayudamos.', 409)
            db.prepare('UPDATE appointments SET status=?,proposed_slot_id=NULL,proposed_date=NULL,proposed_by=NULL,hold_until=NULL,revision=revision+1 WHERE id=?').run(body.status, id)
          } else fail('Acción no permitida para esta visita.', 409)
          const updated = get(id), action = body.status === 'Reprogramar' ? 'Reprogramada' : body.status === 'Conservar' && updated.status === 'Aceptada' ? 'Conservada' : updated.status
          event(updated, user.id, action, body.status === 'Propuesta' ? display(updated.proposed_date) : body.status === 'Reprogramar' ? `Nuevo horario: ${display(updated.date)}` : '')
          queue(updated, action, { exact: updated.status === 'Aceptada' || !!updated.confirmed_map && updated.status === 'Cancelada' })
        })
        await notifications.flush(); send({ ok: true }); return true
      }
      if (/^\/api\/visit-notifications\/[^/]+\/retry$/.test(path) && method === 'POST') {
        notifications.retry(path.split('/')[3], user.id); await notifications.flush(); send({ ok: true }); return true
      }
      fail('Ruta de visitas no encontrada.', 404)
    }
  }
}
