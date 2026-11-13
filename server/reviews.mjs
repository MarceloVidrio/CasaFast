import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createMailer } from './email.mjs'

// Revisión de documentos y administración.
// Cada publicación nueva entra «pendiente» y solo es visible para el público cuando un
// administrador aprueba su documentación. Las publicaciones creadas antes de este módulo
// (y los ejemplos) se consideran aprobadas.

export const DOCUMENTS = [
  { kind: 'identificacion', label: 'Identificación oficial vigente del propietario', hint: 'INE o pasaporte, por ambos lados si aplica.', required: () => true },
  { kind: 'escritura', label: 'Escritura pública o título de propiedad', hint: 'Con los datos de inscripción en el Registro Público de la Propiedad.', required: () => true },
  { kind: 'predial', label: 'Boleta de predial del año en curso', hint: 'Pagada; demuestra que no hay adeudo de impuesto predial.', required: () => true },
  { kind: 'agua', label: 'Recibo de agua sin adeudo', hint: 'Último recibo pagado o constancia de no adeudo.', required: ({ type }) => type !== 'Terreno' },
  { kind: 'gravamen', label: 'Certificado de libertad de gravamen', hint: 'Expedido por el Registro Público hace máximo 3 meses. Demuestra que la propiedad no tiene hipotecas ni embargos.', required: ({ operation }) => operation === 'venta' },
  { kind: 'poder', label: 'Poder notarial', hint: 'Solo si quien publica no es el propietario.', required: () => false }
]
const KINDS = new Set(DOCUMENTS.map(d => d.kind))
const MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }
const MAX_BYTES = 6 * 1024 * 1024
const hour = 3600000
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }

export const requirementsFor = ({ operation, type }) =>
  DOCUMENTS.map(d => ({ kind: d.kind, label: d.label, hint: d.hint, required: d.required({ operation, type }) }))

// 24 horas hábiles: solo cuentan las horas de lunes a viernes (hora de Culiacán, UTC−7).
export function businessDeadline(fromMs, hours = 24) {
  let t = fromMs, left = hours * hour
  while (left > 0) {
    const local = new Date(t - 7 * hour)
    const day = local.getUTCDay()
    if (day === 0 || day === 6) {
      const daysToMonday = day === 6 ? 2 : 1
      const nextMonday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + daysToMonday) + 7 * hour
      t = nextMonday
      continue
    }
    const endOfDay = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) + 7 * hour
    const step = Math.min(left, endOfDay - t)
    t += step; left -= step
  }
  return t
}

const sniff = bytes =>
  bytes.subarray(0, 5).toString('ascii') === '%PDF-' ? 'application/pdf'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
      : bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png' : null

export function createReviews(db, { env = {}, dataDir, mailer: providedMailer } = {}) {
  const folder = join(dataDir, 'documents')
  mkdirSync(folder, { recursive: true })
  const fresh = !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='property_reviews'").get()
  db.exec(`CREATE TABLE IF NOT EXISTS property_reviews (
      property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
      status TEXT NOT NULL, submitted TEXT, due TEXT, reviewed TEXT, reviewer TEXT, note TEXT,
      admin_hold INTEGER NOT NULL DEFAULT 0, hold_note TEXT
    );
    CREATE TABLE IF NOT EXISTS property_documents (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, name TEXT, mime TEXT NOT NULL, size INTEGER NOT NULL, file TEXT NOT NULL, created TEXT NOT NULL
    );`)
  // Las publicaciones que ya existían quedan aprobadas.
  if (fresh) db.prepare("INSERT OR IGNORE INTO property_reviews(property_id,status,reviewed,note) SELECT id,'aprobada',?,'Publicación existente antes de la revisión de documentos' FROM properties").run(new Date().toISOString())

  let mailer = providedMailer
  const getMailer = () => (mailer ||= createMailer(env, dataDir))
  // Correos de la revisión: al vendedor y, como copia, a todas las cuentas administradoras.
  // notice: contenido del correo con diseño (encabezado, datos, botón). text: versión en texto plano.
  async function mailTo(person, subject, text, notice) {
    if (!person?.active) return
    try { const m = getMailer(); if (m.enabled) await m.send({ email: person.email, name: person.name, purpose: 'notice', subject, text: `CasaFast\n${subject}\n${text}`, notice }) }
    catch (error) { console.error('[CasaFast] No se pudo enviar el aviso de revisión:', error.message) }
  }
  const notify = (sellerId, subject, text, notice) => mailTo(db.prepare('SELECT email,name,active FROM users WHERE id=?').get(sellerId), subject, text, notice)
  const notifyAdmins = async (subject, text, notice) => { for (const a of db.prepare("SELECT email,name,active FROM users WHERE role='admin' AND active=1").all()) await mailTo(a, subject, text, notice) }
  // Botones de los correos: el vendedor va a Mi espacio y la administración a su panel oculto.
  const SELLER_CTA = { label: 'Ir a mis publicaciones', query: '?panel' }
  const ADMIN_CTA = { label: 'Abrir panel de administración', query: '?admin' }
  const SELLER_FOOTER = 'Recibes este aviso porque publicaste una propiedad en CasaFast.'
  const ADMIN_FOOTER = 'Recibes este aviso porque tu cuenta administra CasaFast.'
  const where = p => [p.title, p.location].filter(Boolean).join(' · ')
  const folio = p => p.code ? ` (folio ${p.code})` : ''

  const audit = (actor, action, target, detail = '') => db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(), actor, detail ? `${action}: ${detail}` : action, target, new Date().toISOString())
  const review = id => db.prepare('SELECT * FROM property_reviews WHERE property_id=?').get(id)
  const docsOf = id => db.prepare('SELECT id,kind,name,mime,size,created FROM property_documents WHERE property_id=? ORDER BY created').all(id)
  const property = id => {
    const r = db.prepare('SELECT * FROM properties WHERE id=?').get(id)
    if (!r) fail('Publicación no encontrada.', 404)
    return { ...JSON.parse(r.data), id: r.id, code: r.code, sellerId: r.seller_id, active: !!r.active }
  }

  // Información de revisión que se agrega a cada publicación (para su dueño y el administrador).
  function info(id) {
    const r = review(id)
    if (!r) return { status: 'aprobada', hold: false }
    return { status: r.status, submitted: r.submitted, due: r.due, reviewed: r.reviewed, note: r.note, hold: !!r.admin_hold, holdNote: r.hold_note }
  }
  const isPublic = id => { const i = info(id); return i.status === 'aprobada' && !i.hold }

  // Valida los documentos enviados con la publicación y devuelve los que se vincularán.
  function collect(list, user, { operation, type }, propertyId) {
    if (list !== undefined && !Array.isArray(list)) fail('Documentos inválidos.')
    const ids = [...new Set((list || []).filter(x => typeof x === 'string'))]
    const rows = ids.map(id => db.prepare('SELECT * FROM property_documents WHERE id=?').get(id))
    if (rows.some(r => !r || r.owner_id !== user.id || (r.property_id && r.property_id !== propertyId))) fail('Uno de los documentos no es válido. Vuelve a subirlo.')
    const have = new Set([...rows.map(r => r.kind), ...(propertyId ? docsOf(propertyId).map(d => d.kind) : [])])
    const missing = requirementsFor({ operation, type }).filter(d => d.required && !have.has(d.kind))
    if (missing.length) fail(`Faltan documentos: ${missing.map(d => d.label).join(', ')}.`)
    // Solo los documentos nuevos cuentan como cambio (los ya vinculados no reabren la revisión).
    return rows.filter(r => r.property_id !== propertyId || !propertyId)
  }

  // Envía (o reenvía) una publicación a revisión.
  function submit(propertyId, rows) {
    const now = Date.now()
    for (const r of rows) {
      db.prepare('DELETE FROM property_documents WHERE property_id=? AND kind=? AND id<>?').run(propertyId, r.kind, r.id)
      db.prepare('UPDATE property_documents SET property_id=? WHERE id=?').run(propertyId, r.id)
    }
    db.prepare(`INSERT INTO property_reviews(property_id,status,submitted,due,reviewed,reviewer,note) VALUES(?,'pendiente',?,?,NULL,NULL,NULL)
      ON CONFLICT(property_id) DO UPDATE SET status='pendiente',submitted=excluded.submitted,due=excluded.due,reviewed=NULL,reviewer=NULL,note=NULL`)
      .run(propertyId, new Date(now).toISOString(), new Date(businessDeadline(now)).toISOString())
  }

  // Decide si guardar una edición vuelve a mandar la publicación a revisión.
  function afterSave(propertyId, rows, { created }) {
    const current = review(propertyId)
    if (!(created || rows.length || !current || current.status !== 'aprobada')) return false
    submit(propertyId, rows)
    // Avisos (sin bloquear la respuesta): confirmación al vendedor y alerta a los administradores.
    const p = property(propertyId), r = review(propertyId)
    const seller = db.prepare('SELECT name,email FROM users WHERE id=?').get(p.sellerId)
    const due = new Date(r.due).toLocaleString('es-MX', { timeZone: 'America/Mazatlan', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
    Promise.resolve().then(async () => {
      await notify(p.sellerId, 'Recibimos tu documentación', `Tu publicación «${p.title}»${folio(p)} está en revisión.\nTe daremos respuesta a más tardar el ${due} (24 horas hábiles).\nMientras tanto no aparecerá en el catálogo.`, {
        tone: 'info', icon: '📄', badge: 'En revisión', heading: '¡Gracias! Ya tenemos tus documentos',
        intro: 'Nuestro equipo está revisando que todo esté en orden. En cuanto terminemos te avisamos por correo y tu casa aparecerá en el catálogo.',
        details: [['Publicación', where(p)], ['Folio', p.code], ['Tendrás respuesta a más tardar', `${due} (24 horas hábiles)`]],
        notes: ['Mientras la revisamos, tu publicación no se muestra a los compradores. No tienes que hacer nada más por ahora. 🙌'],
        cta: SELLER_CTA, footer: SELLER_FOOTER
      })
      await notifyAdmins('Nueva documentación por revisar', `«${p.title}»${folio(p)} de ${seller?.name || 'un vendedor'} (${seller?.email || ''}) espera revisión.\nPlazo: ${due}.\nRevísala en el panel de administración (/?admin).`, {
        tone: 'warning', icon: '🗂️', badge: 'Pendiente de revisión', heading: 'Hay documentos nuevos por revisar',
        intro: `${seller?.name || 'Un vendedor'} envió la documentación de una publicación. Revísala antes del plazo para que no se quede esperando.`,
        details: [['Publicación', where(p)], ['Folio', p.code], ['Vendedor', [seller?.name, seller?.email].filter(Boolean).join(' · ')], ['Plazo para responder', due]],
        cta: ADMIN_CTA, ctaHint: 'Inicia sesión con tu cuenta de administrador para aprobar o rechazar.', footer: ADMIN_FOOTER
      })
    })
    return true
  }

  async function handle({ path, method, body, auth, send, res }) {
    if (path === '/api/documents/requirements' && method === 'GET') {
      return send({ documents: requirementsFor({ operation: 'venta', type: 'Casa' }).map(({ kind, label, hint }) => ({ kind, label, hint })),
        rules: { venta: requirementsFor({ operation: 'venta', type: 'Casa' }).filter(d => d.required).map(d => d.kind), renta: requirementsFor({ operation: 'renta', type: 'Casa' }).filter(d => d.required).map(d => d.kind), terreno: requirementsFor({ operation: 'venta', type: 'Terreno' }).filter(d => d.required).map(d => d.kind) },
        maxMb: MAX_BYTES / 1024 / 1024, formats: 'PDF, JPG o PNG', reviewHours: 24 }), true
    }

    if (path === '/api/documents' && method === 'POST') {
      const user = auth(['vendedor', 'admin'])
      if (!KINDS.has(body.kind)) fail('Tipo de documento inválido.')
      const match = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(body.file || '')
      if (!match || !MIME[match[1]]) fail('Sube el documento en PDF, JPG o PNG.')
      const bytes = Buffer.from(match[2], 'base64')
      if (bytes.length > MAX_BYTES) fail(`Cada documento debe pesar máximo ${MAX_BYTES / 1024 / 1024} MB.`)
      if (sniff(bytes) !== match[1]) fail('El archivo no corresponde a un PDF o imagen válida.')
      const id = randomUUID(), file = `${id}.${MIME[match[1]]}`
      writeFileSync(join(folder, file), bytes, { mode: 0o600 })
      const name = typeof body.name === 'string' ? body.name.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 120) : ''
      db.prepare('INSERT INTO property_documents(id,owner_id,property_id,kind,name,mime,size,file,created) VALUES(?,?,NULL,?,?,?,?,?,?)').run(id, user.id, body.kind, name, match[1], bytes.length, file, new Date().toISOString())
      return send({ id, kind: body.kind, name, size: bytes.length }, 201), true
    }

    const doc = /^\/api\/documents\/([a-f0-9-]{36})$/.exec(path)
    if (doc && method === 'GET') {
      const user = auth()
      const row = db.prepare('SELECT d.*,p.seller_id FROM property_documents d LEFT JOIN properties p ON p.id=d.property_id WHERE d.id=?').get(doc[1])
      if (!row || (row.owner_id !== user.id && row.seller_id !== user.id && user.role !== 'admin')) fail('Documento no encontrado.', 404)
      const file = join(folder, row.file)
      if (!existsSync(file)) fail('Documento no encontrado.', 404)
      if (user.role === 'admin') audit(user.id, 'ver documento', row.property_id || row.id, row.kind)
      res.writeHead(200, { 'Content-Type': row.mime, 'Content-Disposition': `inline; filename="${row.kind}.${row.file.split('.').pop()}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'; plugin-types application/pdf", 'X-Frame-Options': 'SAMEORIGIN' })
      res.end(readFileSync(file)); return true
    }

    const own = /^\/api\/properties\/([^/]+)\/documents$/.exec(path)
    if (own && method === 'GET') {
      const user = auth()
      const p = property(own[1])
      if (p.sellerId !== user.id && user.role !== 'admin') fail('No puedes ver estos documentos.', 403)
      return send({ review: info(p.id), documents: docsOf(p.id), requirements: requirementsFor(p) }), true
    }

    if (!path.startsWith('/api/admin/')) return false
    const admin = auth(['admin'])

    if (path === '/api/admin/summary' && method === 'GET') {
      const count = sql => db.prepare(sql).get().n
      return send({
        pending: count("SELECT COUNT(*) n FROM property_reviews WHERE status='pendiente'"),
        overdue: db.prepare("SELECT COUNT(*) n FROM property_reviews WHERE status='pendiente' AND due<?").get(new Date().toISOString()).n,
        soon: db.prepare("SELECT COUNT(*) n FROM property_reviews WHERE status='pendiente' AND due>=? AND due<?").get(new Date().toISOString(), new Date(Date.now() + 4 * hour).toISOString()).n,
        listings: count('SELECT COUNT(*) n FROM properties WHERE active=1'),
        held: count('SELECT COUNT(*) n FROM property_reviews WHERE admin_hold=1'),
        users: count("SELECT COUNT(*) n FROM users WHERE id<>'demo'"),
        suspended: count("SELECT COUNT(*) n FROM users WHERE active=0 AND id<>'demo'")
      }), true
    }

    if (path === '/api/admin/reviews' && method === 'GET') {
      const rows = db.prepare(`SELECT r.*,p.data,p.code,p.seller_id,p.active,u.name seller_name,u.email seller_email FROM property_reviews r
        JOIN properties p ON p.id=r.property_id JOIN users u ON u.id=p.seller_id
        WHERE r.status='pendiente' OR (r.reviewed>? AND r.status IN ('aprobada','rechazada') AND r.submitted IS NOT NULL)
        ORDER BY CASE r.status WHEN 'pendiente' THEN 0 ELSE 1 END, r.due ASC, r.reviewed DESC LIMIT 200`).all(new Date(Date.now() - 30 * 86400000).toISOString())
      return send(rows.map(r => {
        const d = JSON.parse(r.data)
        return { propertyId: r.property_id, code: r.code, title: d.title, location: d.location, address: d.address, operation: d.operation, type: d.type, price: d.price, image: d.images?.[0],
          seller: { id: r.seller_id, name: r.seller_name, email: r.seller_email }, status: r.status, submitted: r.submitted, due: r.due, reviewed: r.reviewed, note: r.note,
          duplicates: r.status === 'pendiente' ? duplicatesOf(r.property_id) : [],
          documents: docsOf(r.property_id), requirements: requirementsFor(d) }
      })), true
    }

    const decide = /^\/api\/admin\/reviews\/([^/]+)$/.exec(path)
    if (decide && method === 'POST') {
      const p = property(decide[1]), r = review(p.id)
      if (!r || r.status !== 'pendiente') fail('Esta publicación no está pendiente de revisión.', 409)
      if (!['aprobar', 'rechazar'].includes(body.decision)) fail('Decisión inválida.')
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 600) : ''
      if (body.decision === 'rechazar' && note.length < 5) fail('Explica al vendedor qué debe corregir.')
      const status = body.decision === 'aprobar' ? 'aprobada' : 'rechazada'
      db.prepare('UPDATE property_reviews SET status=?,reviewed=?,reviewer=?,note=? WHERE property_id=?').run(status, new Date().toISOString(), admin.id, note || null, p.id)
      audit(admin.id, status === 'aprobada' ? 'aprobar documentación' : 'rechazar documentación', p.id, note)
      const ok = status === 'aprobada'
      await notify(p.sellerId, ok ? 'Tu documentación fue aprobada' : 'Tu documentación fue rechazada',
        ok ? `Revisamos la documentación de «${p.title}»${folio(p)} y todo está en orden.\nTu publicación ya está visible en CasaFast.` : `Revisamos la documentación de «${p.title}»${folio(p)} y no pudimos aprobarla.\nMotivo: ${note}\nCorrige los documentos desde Mi espacio y vuelve a enviarla.`,
        ok ? {
          tone: 'success', icon: '🎉', badge: 'Aprobada', heading: '¡Tu casa ya está publicada!',
          intro: 'Revisamos tus documentos y todo está en orden. Desde ahora tu propiedad aparece en el catálogo y los compradores ya pueden agendar visitas.',
          details: [['Publicación', where(p)], ['Folio', p.code]],
          notes: ['Consejo: mantén tu agenda de visitas al día para no perder ningún interesado. ¡Mucho éxito con tu venta!'],
          cta: SELLER_CTA, footer: SELLER_FOOTER
        } : {
          tone: 'danger', icon: '📝', badge: 'Necesita cambios', heading: 'Falta un detalle en tus documentos',
          intro: 'Revisamos tu documentación y necesitamos que corrijas algo antes de publicar. No te preocupes: en cuanto la vuelvas a enviar la revisamos de nuevo.',
          details: [['Publicación', where(p)], ['Folio', p.code], ['Qué hay que corregir', note]],
          notes: ['Entra a Mi espacio, abre la publicación, sube los documentos corregidos y guárdala. Así vuelve a revisión automáticamente.'],
          cta: SELLER_CTA, footer: SELLER_FOOTER
        })
      await notifyAdmins(ok ? 'Documentación aprobada' : 'Documentación rechazada', `«${p.title}»${folio(p)} fue ${status} por ${admin.name}.${note ? `\nMotivo: ${note}` : ''}`, {
        tone: ok ? 'success' : 'danger', icon: ok ? '✅' : '↩️', badge: ok ? 'Aprobada' : 'Rechazada',
        heading: ok ? 'Documentación aprobada' : 'Documentación rechazada',
        intro: `${admin.name} ${ok ? 'aprobó' : 'rechazó'} la documentación de esta publicación. Ya avisamos al vendedor.`,
        details: [['Publicación', where(p)], ['Folio', p.code], ['Motivo', note]],
        cta: ADMIN_CTA, footer: ADMIN_FOOTER
      })
      return send({ ok: true, status }), true
    }

    const adminProp = /^\/api\/admin\/properties\/([^/]+)\/(retire|restore)$/.exec(path)
    if (adminProp && method === 'POST') {
      const p = property(adminProp[1])
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : ''
      db.prepare("INSERT OR IGNORE INTO property_reviews(property_id,status) VALUES(?,'aprobada')").run(p.id)
      if (adminProp[2] === 'retire') {
        if (note.length < 5) fail('Indica el motivo del retiro.')
        db.prepare('UPDATE properties SET active=0 WHERE id=?').run(p.id)
        db.prepare('UPDATE property_reviews SET admin_hold=1,hold_note=? WHERE property_id=?').run(note, p.id)
        audit(admin.id, 'retirar publicación', p.id, note)
        await notify(p.sellerId, 'Tu publicación fue retirada por CasaFast', `«${p.title}»${folio(p)} se retiró del catálogo.\nMotivo: ${note}\nSi crees que es un error, responde a este correo.`, {
          tone: 'warning', icon: '⏸️', badge: 'Retirada del catálogo', heading: 'Pausamos tu publicación',
          intro: 'Por ahora tu propiedad no se muestra a los compradores. Aquí te contamos el motivo.',
          details: [['Publicación', where(p)], ['Folio', p.code], ['Motivo', note]],
          notes: ['Si crees que se trata de un error o ya lo resolviste, responde a este correo y lo revisamos contigo.'],
          cta: SELLER_CTA, footer: SELLER_FOOTER
        })
      } else {
        db.prepare('UPDATE properties SET active=1 WHERE id=?').run(p.id)
        db.prepare('UPDATE property_reviews SET admin_hold=0,hold_note=NULL WHERE property_id=?').run(p.id)
        await notify(p.sellerId, 'Tu publicación volvió al catálogo', `CasaFast restauró «${p.title}»${folio(p)}. Ya está visible de nuevo.`, {
          tone: 'success', icon: '🏡', badge: 'Visible de nuevo', heading: '¡Tu casa está de vuelta!',
          intro: 'Restauramos tu publicación y ya aparece otra vez en el catálogo. Los compradores pueden verla y agendar visitas.',
          details: [['Publicación', where(p)], ['Folio', p.code]],
          cta: SELLER_CTA, footer: SELLER_FOOTER
        })
        audit(admin.id, 'restaurar publicación', p.id)
      }
      return send({ ok: true }), true
    }

    if (path === '/api/admin/audit' && method === 'GET') {
      return send(db.prepare(`SELECT a.created,a.action,a.target,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.actor ORDER BY a.created DESC LIMIT 80`).all()), true
    }
    return false
  }

  // ---- Posibles duplicados o fraudes: misma dirección, mismo punto del mapa o la misma foto en otra publicación ----
  const imageHashes = new Map()
  const imageHash = path => {
    if (!imageHashes.has(path)) {
      let h = null
      try { if (/^\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/.test(path)) h = createHash('sha256').update(readFileSync(join(dataDir, path.slice(1)))).digest('hex') } catch {}
      imageHashes.set(path, h)
    }
    return imageHashes.get(path)
  }
  const norm = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  function duplicatesOf(propertyId) {
    const me = db.prepare('SELECT * FROM properties WHERE id=?').get(propertyId)
    if (!me) return []
    const d = JSON.parse(me.data)
    if (d.demo) return []
    const address = norm(d.address), mine = new Set((d.images || []).map(imageHash).filter(Boolean))
    const found = []
    for (const o of db.prepare('SELECT p.id,p.code,p.seller_id,p.data,u.name FROM properties p JOIN users u ON u.id=p.seller_id WHERE p.id<>?').all(propertyId)) {
      const od = JSON.parse(o.data)
      if (od.demo) continue
      const reasons = []
      if (address.length > 8 && norm(od.address) === address) reasons.push('misma dirección')
      else if (Number.isFinite(d.lat) && Number.isFinite(od.lat) && Math.abs(d.lat - od.lat) < 0.0002 && Math.abs(d.lng - od.lng) < 0.0002) reasons.push('mismo punto en el mapa')
      if (mine.size && (od.images || []).some(i => mine.has(imageHash(i)))) reasons.push('misma fotografía')
      if (reasons.length) found.push({ propertyId: o.id, code: o.code, title: od.title, seller: o.name, sameSeller: o.seller_id === me.seller_id, reasons })
      if (found.length >= 5) break
    }
    return found
  }

  // ---- Alerta al administrador: revisiones a las que les quedan menos de 4 horas de plazo ----
  if (!db.prepare('PRAGMA table_info(property_reviews)').all().some(c => c.name === 'alerted')) db.exec('ALTER TABLE property_reviews ADD COLUMN alerted TEXT')
  async function alertDeadlines() {
    const soon = db.prepare(`SELECT r.*,p.data,p.code FROM property_reviews r JOIN properties p ON p.id=r.property_id
      WHERE r.status='pendiente' AND r.due>? AND r.due<=? AND (r.alerted IS NULL OR r.alerted<>r.due)`).all(new Date().toISOString(), new Date(Date.now() + 4 * hour).toISOString())
    for (const r of soon) {
      db.prepare('UPDATE property_reviews SET alerted=due WHERE property_id=?').run(r.property_id)
      const p = { ...JSON.parse(r.data), code: r.code }
      const left = Math.max(1, Math.round((Date.parse(r.due) - Date.now()) / 60000))
      const leftText = left >= 60 ? `${Math.floor(left / 60)} h ${left % 60 ? `${left % 60} min` : ''}`.trim() : `${left} min`
      await notifyAdmins('⏰ Revisión por vencer', `«${p.title}»${folio(p)} vence en ${leftText}. Revísala en /?admin.`, {
        tone: 'warning', icon: '⏰', badge: 'Plazo por vencer', heading: `Quedan ${leftText} para revisar`,
        intro: 'Esta documentación está por superar el plazo de 24 horas hábiles que prometimos al vendedor.',
        details: [['Publicación', where(p)], ['Folio', p.code], ['Vence', new Date(r.due).toLocaleString('es-MX', { timeZone: 'America/Mazatlan', dateStyle: 'medium', timeStyle: 'short' })]],
        cta: ADMIN_CTA, footer: ADMIN_FOOTER
      })
    }
  }
  if (env.NODE_ENV !== 'test') {
    const timer = setInterval(() => { alertDeadlines().catch(error => console.error('[CasaFast] Alertas de revisión:', error.message)) }, 5 * 60000)
    timer.unref?.()
  }

  return { handle, info, isPublic, collect, afterSave, requirementsFor, alertDeadlines, duplicatesOf, notifyAdmins }
}
