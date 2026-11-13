import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { createApi } from './api.mjs'
import { businessDeadline, requirementsFor, createReviews } from './reviews.mjs'
import { samplePdf, uploadDocuments } from './test-fixtures.mjs'

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'casafast-reviews-')), emails = []
  const server = createServer(createApi(dir, { env: { APP_URL: 'http://localhost:5173' }, mailer: { enabled: true, mode: 'test', async send(m) { emails.push(m) } } }))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const db = new DatabaseSync(join(dir, 'casafast.sqlite'))
  for (const [id, role] of [['seller', 'vendedor'], ['buyer', 'comprador'], ['admin', 'admin'], ['other', 'vendedor']]) {
    db.prepare('INSERT INTO users(id,name,email,password,role,active,verified) VALUES(?,?,?,?,?,1,1)').run(id, id, `${id}@example.invalid`, '', role)
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(id).digest('hex'), id, Date.now() + 86400000)
  }
  const call = async (path, method = 'GET', body, who = 'buyer') => {
    const r = await fetch(base + '/api/' + path, { method, headers: { 'Content-Type': 'application/json', Cookie: `casafast_session=${who}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const type = r.headers.get('content-type') || ''
    return { status: r.status, type, data: type.includes('json') ? await r.json() : await r.arrayBuffer() }
  }
  // Publicación insertada directamente (la ubicación ya se prueba en otros archivos).
  const listing = (id, seller = 'seller', operation = 'venta') => db.prepare('INSERT INTO properties(id,seller_id,data,active) VALUES(?,?,?,1)').run(id, seller, JSON.stringify({ title: `Casa ${id}`, operation, type: 'Casa', price: 1000000, location: 'Centro, Culiacán', address: 'Calle 1', lat: 24.8, lng: -107.4, images: [] }))
  return { dir, db, emails, call, listing, close: async () => { await new Promise(r => server.close(r)); db.close() } }
}

test('Documentos privados: solo el dueño y el administrador pueden verlos; formatos validados', async () => {
  const f = await fixture(); try {
    assert.equal((await f.call('documents', 'POST', { kind: 'predial', file: samplePdf }, 'buyer')).status, 403)
    assert.equal((await f.call('documents', 'POST', { kind: 'otro', file: samplePdf }, 'seller')).status, 400)
    assert.equal((await f.call('documents', 'POST', { kind: 'predial', file: 'data:application/pdf;base64,aG9sYQ==' }, 'seller')).status, 400)
    assert.equal((await f.call('documents', 'POST', { kind: 'predial', file: 'data:text/html;base64,PGgxPg==' }, 'seller')).status, 400)
    const up = await f.call('documents', 'POST', { kind: 'predial', file: samplePdf, name: 'predial 2026.pdf' }, 'seller')
    assert.equal(up.status, 201)
    assert.equal((await f.call(`documents/${up.data.id}`, 'GET', undefined, 'seller')).status, 200)
    assert.equal((await f.call(`documents/${up.data.id}`, 'GET', undefined, 'buyer')).status, 404)
    assert.equal((await f.call(`documents/${up.data.id}`, 'GET', undefined, 'other')).status, 404)
    const asAdmin = await f.call(`documents/${up.data.id}`, 'GET', undefined, 'admin')
    assert.equal(asAdmin.status, 200); assert.equal(asAdmin.type, 'application/pdf')
    // Los archivos no quedan en la carpeta pública de imágenes
    assert.ok(!readdirSync(join(f.dir, 'uploads')).length)
    assert.ok(readdirSync(join(f.dir, 'documents')).length === 1)
    // Requisitos según operación y tipo
    assert.ok(requirementsFor({ operation: 'venta', type: 'Casa' }).find(d => d.kind === 'gravamen').required)
    assert.ok(!requirementsFor({ operation: 'renta', type: 'Casa' }).find(d => d.kind === 'gravamen').required)
    assert.ok(!requirementsFor({ operation: 'venta', type: 'Terreno' }).find(d => d.kind === 'agua').required)
  } finally { await f.close() }
})

test('Revisión: pendiente oculta, rechazo con motivo, reenvío, aprobación y avisos al vendedor', async () => {
  const f = await fixture(); try {
    f.listing('p1')
    const docs = await uploadDocuments(f.call, 'seller')
    // Simula el envío a revisión como lo hace la API al publicar
    f.db.prepare("INSERT INTO property_reviews(property_id,status,submitted,due) VALUES('p1','pendiente',?,?)").run(new Date().toISOString(), new Date(Date.now() + 86400000).toISOString())
    for (const id of docs) f.db.prepare("UPDATE property_documents SET property_id='p1' WHERE id=?").run(id)
    assert.ok(!(await f.call('properties')).data.some(p => p.id === 'p1'))
    assert.equal((await f.call('properties', 'GET', undefined, 'seller')).data.find(p => p.id === 'p1').review.status, 'pendiente')
    assert.equal((await f.call('visit-slots/p1')).data.slots.length, 0)
    assert.equal((await f.call('admin/reviews', 'GET', undefined, 'seller')).status, 403)
    const queue = (await f.call('admin/reviews', 'GET', undefined, 'admin')).data
    assert.equal(queue[0].propertyId, 'p1'); assert.equal(queue[0].documents.length, 5)
    assert.equal((await f.call('admin/reviews/p1', 'POST', { decision: 'rechazar' }, 'admin')).status, 400)
    assert.equal((await f.call('admin/reviews/p1', 'POST', { decision: 'rechazar', note: 'El predial es del año pasado.' }, 'admin')).status, 200)
    assert.ok(f.emails.some(e => e.email === 'seller@example.invalid' && /rechazada/.test(e.subject) && /predial/.test(e.text) && /PUB-/.test(e.text)))
    assert.ok(f.emails.some(e => e.email === 'admin@example.invalid' && e.subject === 'Documentación rechazada'))
    assert.equal((await f.call('properties', 'GET', undefined, 'seller')).data.find(p => p.id === 'p1').review.note, 'El predial es del año pasado.')
    // El vendedor corrige y la publicación vuelve a revisión; luego se aprueba
    f.db.prepare("UPDATE property_reviews SET status='pendiente',note=NULL WHERE property_id='p1'").run()
    assert.equal((await f.call('admin/reviews/p1', 'POST', { decision: 'aprobar' }, 'admin')).status, 200)
    assert.ok((await f.call('properties')).data.some(p => p.id === 'p1'))
    assert.ok(f.emails.some(e => e.email === 'seller@example.invalid' && e.subject === 'Tu documentación fue aprobada'))
    assert.ok(f.emails.some(e => e.email === 'admin@example.invalid' && e.subject === 'Documentación aprobada'))
    assert.equal((await f.call('admin/reviews/p1', 'POST', { decision: 'aprobar' }, 'admin')).status, 409)
    assert.ok((await f.call('admin/audit', 'GET', undefined, 'admin')).data.some(a => /aprobar documentación/.test(a.action)))
  } finally { await f.close() }
})

test('Retiro: el vendedor vuelve a publicar con un clic; lo retirado por administración solo lo restaura el administrador', async () => {
  const f = await fixture(); try {
    f.listing('p2'); f.listing('p3', 'other')
    assert.equal((await f.call('properties/p2', 'DELETE', {}, 'seller')).status, 200)
    assert.ok(!(await f.call('properties')).data.some(p => p.id === 'p2'))
    assert.equal((await f.call('properties/p2/restore', 'POST', {}, 'other')).status, 403)
    assert.equal((await f.call('properties/p2/restore', 'POST', {}, 'seller')).status, 200)
    assert.ok((await f.call('properties')).data.some(p => p.id === 'p2'))
    // Retiro administrativo con motivo
    assert.equal((await f.call('admin/properties/p2/retire', 'POST', {}, 'admin')).status, 400)
    assert.equal((await f.call('admin/properties/p2/retire', 'POST', { note: 'Fotografías engañosas' }, 'admin')).status, 200)
    assert.ok(!(await f.call('properties')).data.some(p => p.id === 'p2'))
    const restore = await f.call('properties/p2/restore', 'POST', {}, 'seller')
    assert.equal(restore.status, 403); assert.match(restore.data.error, /CasaFast retiró/)
    assert.equal((await f.call('properties/p2', 'PUT', { title: 'x' }, 'seller')).status, 403)
    assert.equal((await f.call('admin/properties/p2/restore', 'POST', {}, 'admin')).status, 200)
    assert.ok((await f.call('properties')).data.some(p => p.id === 'p2'))
    // Suspensión de cuenta: cierra sesiones y retira publicaciones
    assert.equal((await f.call('admin/users/other', 'PATCH', { active: false }, 'admin')).status, 200)
    assert.equal((await f.call('session', 'GET', undefined, 'other')).data, null)
    assert.ok(!(await f.call('properties')).data.some(p => p.id === 'p3'))
    const summary = (await f.call('admin/summary', 'GET', undefined, 'admin')).data
    assert.equal(summary.suspended, 1)
  } finally { await f.close() }
})

test('24 horas hábiles: los fines de semana no cuentan', () => {
  const at = s => Date.parse(s)
  // Lunes 10:00 (Culiacán) → martes 10:00
  assert.equal(new Date(businessDeadline(at('2026-11-09T10:00:00-07:00'))).toISOString(), new Date(at('2026-11-10T10:00:00-07:00')).toISOString())
  // Viernes 15:00 → lunes 15:00
  assert.equal(new Date(businessDeadline(at('2026-11-13T15:00:00-07:00'))).toISOString(), new Date(at('2026-11-16T15:00:00-07:00')).toISOString())
  // Sábado 11:00 → martes 00:00 (cuenta desde el lunes a primera hora)
  assert.equal(new Date(businessDeadline(at('2026-11-14T11:00:00-07:00'))).toISOString(), new Date(at('2026-11-17T00:00:00-07:00')).toISOString())
})

test('Al enviar a revisión se avisa por correo al vendedor y a los administradores', async () => {
  const f = await fixture(); try {
    f.listing('p9')
    const sent = []
    const reviews = createReviews(f.db, { dataDir: f.dir, mailer: { enabled: true, async send(m) { sent.push(m) } } })
    assert.equal(reviews.afterSave('p9', [], { created: true }), true)
    await new Promise(r => setTimeout(r, 30))
    const seller = sent.find(e => e.email === 'seller@example.invalid'), admin = sent.find(e => e.email === 'admin@example.invalid')
    assert.equal(seller.subject, 'Recibimos tu documentación'); assert.match(seller.text, /24 horas hábiles/); assert.match(seller.text, /PUB-/)
    assert.equal(admin.subject, 'Nueva documentación por revisar'); assert.match(admin.text, /seller@example.invalid/)
    // Una edición sin documentos nuevos de una publicación aprobada no reabre la revisión ni envía correos
    f.db.prepare("UPDATE property_reviews SET status='aprobada' WHERE property_id='p9'").run()
    sent.length = 0
    assert.equal(reviews.afterSave('p9', [], { created: false }), false)
    await new Promise(r => setTimeout(r, 30)); assert.equal(sent.length, 0)
  } finally { await f.close() }
})

test('Duplicados, alerta de plazo por vencer e insignia de vendedor verificado', async () => {
  const f = await fixture(); try {
    f.listing('a1'); f.listing('a2', 'other')
    const emails = []
    const reviews = createReviews(f.db, { env: { NODE_ENV: 'test' }, dataDir: f.dir, mailer: { enabled: true, async send(m) { emails.push(m) } } })
    const due = new Date(Date.now() + 2 * 3600000).toISOString()
    f.db.prepare("INSERT OR REPLACE INTO property_reviews(property_id,status,submitted,due) VALUES('a1','pendiente',?,?)").run(new Date().toISOString(), due)
    const dupes = reviews.duplicatesOf('a1')
    assert.equal(dupes.length, 1); assert.equal(dupes[0].propertyId, 'a2'); assert.ok(dupes[0].reasons.includes('mismo punto en el mapa'))
    await reviews.alertDeadlines(); await reviews.alertDeadlines()
    const alerts = emails.filter(e => e.email === 'admin@example.invalid' && /por vencer/.test(e.subject))
    assert.equal(alerts.length, 1); assert.match(alerts[0].notice.heading, /Quedan/)
    assert.equal((await f.call('admin/summary', 'GET', undefined, 'admin')).data.soon, 1)
    assert.equal((await f.call('admin/reviews', 'GET', undefined, 'admin')).data.find(r => r.propertyId === 'a1').duplicates.length, 1)
    // Insignia: aparece cuando un administrador aprueba sus documentos.
    assert.equal((await f.call('properties', 'GET', undefined, 'admin')).data.find(p => p.id === 'a1').sellerVerified, false)
    f.db.prepare("UPDATE property_reviews SET status='aprobada',reviewer='admin',reviewed=? WHERE property_id='a1'").run(new Date().toISOString())
    assert.equal((await f.call('properties')).data.find(p => p.id === 'a1').sellerVerified, true)
  } finally { await f.close() }
})
