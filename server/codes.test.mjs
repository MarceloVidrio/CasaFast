import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { ensureCodes, isCode } from './codes.mjs'

test('Folios: se asignan a registros existentes y nuevos, son únicos y tienen formato legible', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE properties(id TEXT PRIMARY KEY,seller_id TEXT,data TEXT,active INTEGER DEFAULT 1);
    CREATE TABLE appointments(id TEXT PRIMARY KEY,property_id TEXT,buyer_id TEXT,date TEXT)`)
  for (let i = 0; i < 300; i++) db.prepare('INSERT INTO properties(id,seller_id,data) VALUES(?,?,?)').run(`p${i}`, 's', '{}')
  db.prepare('INSERT INTO appointments(id,property_id,buyer_id,date) VALUES(?,?,?,?)').run('a1', 'p1', 'b', 'x')
  ensureCodes(db)
  ensureCodes(db) // repetible
  const codes = db.prepare('SELECT code FROM properties').all().map(r => r.code)
  assert.equal(new Set(codes).size, 300)
  assert.ok(codes.every(c => /^PUB-[0-9A-F]{8}$/.test(c)))
  assert.match(db.prepare("SELECT code FROM appointments WHERE id='a1'").get().code, /^CITA-[0-9A-F]{8}$/)
  // Registros nuevos (cualquier origen) reciben folio automáticamente
  db.prepare('INSERT INTO appointments(id,property_id,buyer_id,date) VALUES(?,?,?,?)').run('a2', 'p2', 'b', 'y')
  db.prepare('INSERT INTO properties(id,seller_id,data) VALUES(?,?,?)').run('nueva', 's', '{}')
  assert.match(db.prepare("SELECT code FROM appointments WHERE id='a2'").get().code, /^CITA-/)
  assert.match(db.prepare("SELECT code FROM properties WHERE id='nueva'").get().code, /^PUB-/)
  // Al editar no cambia
  const before = db.prepare("SELECT code FROM properties WHERE id='p5'").get().code
  db.prepare("UPDATE properties SET data='{\"x\":1}' WHERE id='p5'").run()
  assert.equal(db.prepare("SELECT code FROM properties WHERE id='p5'").get().code, before)
  assert.ok(isCode('cita-7f3a9c21')); assert.ok(!isCode('CITA-123'))
})
