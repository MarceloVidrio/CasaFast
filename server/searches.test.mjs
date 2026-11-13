import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApi } from './api.mjs'
import { MAX_SEARCHES, cleanFilters } from './searches.mjs'
import { testServices } from './test-fixtures.mjs'

test('Búsquedas guardadas: propiedad por cuenta, validación, límite y marca de revisión', async () => {
  const { options, emails } = testServices()
  const dir = mkdtempSync(join(tmpdir(), 'casafast-searches-'))
  const server = createServer(createApi(dir, options))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  async function call(path, method = 'GET', body, cookie = '') {
    const r = await fetch(base + '/api/' + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }
  }
  async function account(email) {
    const data = { name: 'Persona de prueba', email, password: 'Prueba-segura-123', role: 'comprador' }
    assert.equal((await call('register', 'POST', data)).status, 202)
    await call('email/verify', 'POST', { token: emails.findLast(e => e.email === email).token })
    return (await call('login', 'POST', data)).cookie
  }
  try {
    const ana = await account('ana@example.com')
    const beto = await account('beto@example.com')
    const filters = { operation: 'renta', type: 'Departamento', max: '15000', rooms: '2', radius: '5', city: 'Culiacán', query: 'Centro', sort: 'low', center: { lat: 24.8091, lng: -107.394 } }

    assert.equal((await call('searches')).status, 401)
    assert.equal((await call('searches', 'POST', { name: '', filters }, ana)).status, 400)
    assert.equal((await call('searches', 'POST', { name: 'Mala', filters: { ...filters, operation: 'robar' } }, ana)).status, 400)
    assert.equal((await call('searches', 'POST', { name: 'Mala', filters: { ...filters, radius: '500' } }, ana)).status, 400)

    const created = await call('searches', 'POST', { name: 'Depa cerca del centro', filters }, ana)
    assert.equal(created.status, 201)
    assert.equal(created.data.filters.max, '15000')
    assert.deepEqual(created.data.filters.center, { lat: 24.8091, lng: -107.394 })

    assert.equal((await call('searches', 'GET', undefined, ana)).data.length, 1)
    assert.equal((await call('searches', 'GET', undefined, beto)).data.length, 0)
    assert.equal((await call(`searches/${created.data.id}`, 'DELETE', {}, beto)).status, 404)
    assert.equal((await call(`searches/${created.data.id}/seen`, 'POST', {}, beto)).status, 404)

    await new Promise(r => setTimeout(r, 5))
    const seen = await call(`searches/${created.data.id}/seen`, 'POST', {}, ana)
    assert.equal(seen.status, 200)
    assert.ok(seen.data.lastSeen > created.data.lastSeen)

    for (let i = 1; i < MAX_SEARCHES; i++) assert.equal((await call('searches', 'POST', { name: `Búsqueda ${i}`, filters: {} }, ana)).status, 201)
    assert.equal((await call('searches', 'POST', { name: 'Una más', filters: {} }, ana)).status, 409)

    assert.equal((await call(`searches/${created.data.id}`, 'DELETE', {}, ana)).status, 200)
    assert.equal((await call('searches', 'GET', undefined, ana)).data.length, MAX_SEARCHES - 1)
  } finally {
    server.close()
  }
})

test('Los filtros se normalizan y descartan datos desconocidos', () => {
  const clean = cleanFilters({ operation: 'venta', max: 2000000, extra: '<script>', center: null })
  assert.equal(clean.max, '2000000')
  assert.equal(clean.extra, undefined)
  assert.equal(clean.center, null)
  assert.throws(() => cleanFilters([]))
  assert.throws(() => cleanFilters({ center: { lat: 200, lng: 0 } }))
})
