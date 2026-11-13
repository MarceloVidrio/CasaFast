import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Visor y editor de la base de datos para el administrador.
// · Oculta contraseñas, tokens de sesión y enlaces de un solo uso (ni se ven ni se editan).
// · Antes de cada cambio guarda un respaldo en server/data/backups (como máximo uno cada 10 minutos; conserva los 20 más recientes).
// · Cada cambio queda registrado en la tabla audit.

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
// Tablas cuyo contenido completo es secreto: se muestran solo sus columnas y cuántos registros tienen.
const SECRET_TABLES = new Set(['sessions', 'email_tokens', 'location_checks'])
// Columnas que nunca se muestran.
const SECRET_COLUMN = /^(password|token|secret|hash|api_key)$/i
const DESCRIPTIONS = {
  users: 'Cuentas de compradores, vendedores y administradores',
  properties: 'Publicaciones (los detalles van en la columna data)',
  appointments: 'Citas de visita',
  visit_events: 'Historial de cada cita',
  visit_slots: 'Horarios publicados por los vendedores',
  visit_notifications: 'Correos y WhatsApp enviados o pendientes',
  visit_ratings: 'Calificaciones de las visitas',
  favorites: 'Propiedades guardadas por cada usuario',
  property_reviews: 'Revisión de documentación',
  property_documents: 'Documentos subidos (el archivo está en server/data/documents)',
  property_views: 'Vistas de cada publicación por día',
  reports: 'Publicaciones reportadas',
  seller_vacations: 'Modo vacaciones de los vendedores',
  seller_blocks: 'Horarios bloqueados por los vendedores',
  saved_searches: 'Búsquedas guardadas',
  audit: 'Acciones registradas (administración y vendedores)',
  sessions: 'Sesiones abiertas (contenido oculto por seguridad)',
  email_tokens: 'Enlaces de verificación y cambio de contraseña (contenido oculto)'
}

export function createDbViewer(db, { dataDir } = {}) {
  const info = name => db.prepare(`PRAGMA table_info("${name}")`).all()
  let lastBackup = 0
  function backup() {
    if (!dataDir || Date.now() - lastBackup < 10 * 60000) return
    const folder = join(dataDir, 'backups')
    mkdirSync(folder, { recursive: true })
    const stamp = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 19).replace(/[:T]/g, '-')
    db.exec(`VACUUM INTO '${join(folder, `casafast-${stamp}.sqlite`).replace(/'/g, "''")}'`)
    lastBackup = Date.now()
    const files = readdirSync(folder).filter(f => /^casafast-.*\.sqlite$/.test(f)).sort()
    for (const f of files.slice(0, Math.max(0, files.length - 20))) { try { unlinkSync(join(folder, f)) } catch {} }
  }
  const audit = (actor, action, target) => db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(), actor, action, target, new Date().toISOString())
  const short = v => { const t = v === null ? 'vacío' : String(v); return t.length > 80 ? `${t.slice(0, 80)}…` : t }
  // Convierte el texto escrito en el panel al tipo de la columna.
  function coerce(col, raw, old) {
    if (raw === null) { if (col.notnull) fail(`La columna ${col.name} no puede quedar vacía.`); return null }
    if (typeof raw !== 'string' && typeof raw !== 'number') fail('Valor inválido.')
    const text = String(raw)
    if (text.length > 200000) fail('El valor es demasiado largo.')
    const type = String(col.type).toUpperCase()
    if (type.includes('INT')) { if (!/^-?\d+$/.test(text.trim())) fail(`${col.name} debe ser un número entero.`); return Number(text.trim()) }
    if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) { if (!Number.isFinite(Number(text))) fail(`${col.name} debe ser un número.`); return Number(text) }
    // Si antes era JSON válido (como properties.data), el nuevo valor también debe serlo.
    if (typeof old === 'string' && /^[[{]/.test(old.trim())) {
      try { JSON.parse(old) } catch { return text }
      try { return JSON.stringify(JSON.parse(text)) } catch { fail(`${col.name} contiene JSON: revisa comas, comillas y llaves.`) }
    }
    return text
  }
  const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name)
  const columns = name => db.prepare(`PRAGMA table_info("${name}")`).all().map(c => c.name)

  async function handle({ path, method, body, auth, send, url }) {
    if (!path.startsWith('/api/admin/db')) return false

    const admin = auth(['admin'])
    const edit = /^\/api\/admin\/db\/([A-Za-z0-9_]+)\/(\d+)$/.exec(path)
    if (edit && ['PATCH', 'DELETE'].includes(method)) {
      const name = edit[1], rowid = Number(edit[2])
      if (!tables().includes(name)) fail('Tabla no encontrada.', 404)
      if (SECRET_TABLES.has(name)) fail('Esta tabla guarda datos secretos y no se puede modificar desde aquí.', 403)
      const row = db.prepare(`SELECT rowid AS __rowid, * FROM "${name}" WHERE rowid=?`).get(rowid)
      if (!row) fail('Ese registro ya no existe. Actualiza la tabla.', 404)
      const self = name === 'users' && row.id === admin.id
      if (method === 'DELETE') {
        if (self) fail('No puedes borrar tu propia cuenta de administrador.', 403)
        if (name === 'audit') fail('El registro de actividad no se puede borrar.', 403)
        backup()
        try { db.prepare(`DELETE FROM "${name}" WHERE rowid=?`).run(rowid) }
        catch (e) { if (/FOREIGN KEY/i.test(e.message)) fail('No se puede borrar: otros registros dependen de este (por ejemplo citas o favoritos). Bórralos primero o desactiva el registro.', 409); throw e }
        audit(admin.id, `base de datos: borrar registro de ${name}`, String(row.id ?? row.property_id ?? rowid))
        send({ ok: true }); return true
      }
      const col = info(name).find(c => c.name === body.column)
      if (!col || SECRET_COLUMN.test(col.name)) fail('Columna no válida.')
      if (col.pk) fail('El identificador (id) no se puede cambiar: otros registros dependen de él.', 403)
      if (name === 'audit') fail('El registro de actividad no se puede modificar.', 403)
      if (self && ['role', 'active', 'verified'].includes(col.name)) fail('No puedes cambiar el rol ni desactivar tu propia cuenta de administrador.', 403)
      const value = coerce(col, body.value, row[col.name])
      if (name === 'users' && col.name === 'role' && !['comprador', 'vendedor', 'admin'].includes(value)) fail('El rol debe ser comprador, vendedor o admin.')
      if (name === 'users' && col.name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail('Escribe un correo válido.')
      if (value === row[col.name]) { send({ ok: true, value, unchanged: true }); return true }
      backup()
      try { db.prepare(`UPDATE "${name}" SET "${col.name}"=? WHERE rowid=?`).run(value, rowid) }
      catch (e) { if (/UNIQUE/i.test(e.message)) fail('Ese valor ya existe en otro registro y debe ser único.', 409); if (/FOREIGN KEY/i.test(e.message)) fail('Ese valor no corresponde a ningún registro relacionado.', 409); throw e }
      audit(admin.id, `base de datos: ${name}.${col.name} «${short(row[col.name])}» → «${short(value)}»`, String(row.id ?? row.property_id ?? rowid))
      send({ ok: true, value }); return true
    }
    if (method !== 'GET') fail('Acción no permitida.', 405)
    if (path === '/api/admin/db') {
      send(tables().map(name => ({ name, description: DESCRIPTIONS[name] || '', rows: db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n, secret: SECRET_TABLES.has(name) })))
      return true
    }
    const m = /^\/api\/admin\/db\/([A-Za-z0-9_]+)$/.exec(path)
    if (!m || !tables().includes(m[1])) fail('Tabla no encontrada.', 404)
    const name = m[1], cols = columns(name)
    const visible = cols.filter(c => !SECRET_COLUMN.test(c))
    const hidden = cols.filter(c => SECRET_COLUMN.test(c))
    const total = db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n
    if (SECRET_TABLES.has(name)) { send({ name, columns: cols, hidden: cols, rows: [], total, filtered: total, page: 1, pages: 1, secret: true }); return true }
    const per = 50
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100)
    const where = q ? `WHERE ${visible.map(c => `CAST("${c}" AS TEXT) LIKE ?`).join(' OR ')}` : ''
    const args = q ? visible.map(() => `%${q}%`) : []
    const filtered = db.prepare(`SELECT COUNT(*) n FROM "${name}" ${where}`).get(...args).n
    const pages = Math.max(1, Math.ceil(filtered / per))
    const page = Math.min(pages, Math.max(1, Number(url.searchParams.get('page')) || 1))
    const rows = db.prepare(`SELECT rowid AS __rowid, ${visible.map(c => `"${c}"`).join(',')} FROM "${name}" ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per)
    const meta = info(name)
    send({ name, columns: visible, hidden, rows, total, filtered, page, pages, locked: meta.filter(c => c.pk).map(c => c.name), readOnly: name === 'audit' })
    return true
  }
  return { handle }
}
