// Consola SQL de CasaFast: consulta y modifica la base de datos desde la terminal.
//
//   npm.cmd run db                         → modo interactivo (escribe comandos y Enter; «salir» para terminar)
//   npm.cmd run db -- "SELECT * FROM users"  → ejecuta un solo comando
//   npm.cmd run db -- cambios.sql            → ejecuta todos los comandos de un archivo .sql
//
// Antes de cualquier cambio (UPDATE, INSERT, DELETE…) guarda un respaldo en server/data/backups.
// Puede usarse con «npm.cmd run dev» abierto: los cambios se ven al recargar la página.

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'data')
const file = join(dataDir, 'casafast.sqlite')
if (!existsSync(file)) { console.error('No encontré la base de datos en server/data/casafast.sqlite. Ejecuta primero «npm.cmd run dev».'); process.exit(1) }
const db = new DatabaseSync(file)
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')

const HIDDEN = /^(password|token)$/i
const READ = /^\s*(select|pragma|with|explain)\b/i
let backedUp = false
function backup() {
  if (backedUp) return
  const folder = join(dataDir, 'backups')
  mkdirSync(folder, { recursive: true })
  const stamp = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 23).replace(/[:T.]/g, '-')
  const target = join(folder, `casafast-${stamp}-consola.sqlite`)
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  const files = readdirSync(folder).filter(f => /^casafast-.*\.sqlite$/.test(f)).sort()
  for (const f of files.slice(0, Math.max(0, files.length - 20))) { try { unlinkSync(join(folder, f)) } catch {} }
  console.log(`  (respaldo guardado: server/data/backups/${target.split(/[\\/]/).pop()})`)
  backedUp = true
}
const cut = v => { if (v === null || v === undefined) return 'NULL'; const t = String(v); return t.length > 70 ? `${t.slice(0, 70)}…` : t }

// Divide un texto en comandos separados por «;» (respetando lo que va entre comillas).
function split(sql) {
  const out = []; let cur = '', quote = ''
  for (const ch of sql) {
    if (quote) { if (ch === quote) quote = ''; cur += ch; continue }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function run(sql) {
  for (const statement of split(sql)) {
    try {
      if (READ.test(statement)) {
        const rows = db.prepare(statement).all()
        if (!rows.length) { console.log('  Sin resultados.'); continue }
        const shown = rows.slice(0, 100).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, HIDDEN.test(k) ? '(oculto)' : cut(v)])))
        console.table(shown)
        if (rows.length > 100) console.log(`  Mostrando 100 de ${rows.length} filas. Agrega LIMIT o WHERE para acotar.`)
      } else {
        if (/^\s*(drop|alter)\b/i.test(statement)) { console.log('  ⛔ DROP y ALTER no se permiten aquí: podrían romper la página.'); continue }
        if (/^\s*(update|delete)\b/i.test(statement) && !/\bwhere\b/i.test(statement)) { console.log('  ⛔ Ese comando cambiaría TODA la tabla. Agrega WHERE para indicar qué registros (o escribe «WHERE 1=1» si de verdad quieres todos).'); continue }
        backup()
        const r = db.prepare(statement).run()
        console.log(`  ✔ Listo: ${r.changes} ${r.changes === 1 ? 'registro modificado' : 'registros modificados'}.`)
      }
    } catch (e) {
      const m = e.message
      console.log(`  ✖ ${/no such table/.test(m) ? 'Esa tabla no existe. Escribe «tablas» para ver la lista.' : /no such column/.test(m) ? `Esa columna no existe (${m.split(':').pop().trim()}). Escribe «columnas NOMBRE_TABLA».` : /UNIQUE/.test(m) ? 'Ese valor ya existe y debe ser único.' : /FOREIGN KEY/.test(m) ? 'Otros registros dependen de este (o el valor no corresponde a un registro relacionado).' : /syntax error/.test(m) ? `Error de escritura en el comando: ${m}` : m}`)
    }
  }
}

function special(line) {
  const t = line.trim()
  if (/^(tablas|tables)$/i.test(t)) { run("SELECT name AS tabla FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"); return true }
  const c = /^(columnas|columns)\s+([A-Za-z0-9_]+)$/i.exec(t)
  if (c) { console.table(db.prepare(`PRAGMA table_info("${c[2]}")`).all().map(x => ({ columna: x.name, tipo: x.type, obligatoria: x.notnull ? 'sí' : '', clave: x.pk ? 'sí' : '' }))); return true }
  if (/^(ayuda|help)$/i.test(t)) { help(); return true }
  return false
}

function help() {
  console.log(`
  Comandos útiles:
    tablas                              lista las tablas
    columnas users                      columnas de una tabla
    SELECT id,name,email,role FROM users;
    UPDATE users SET name='Nuevo nombre' WHERE email='correo@ejemplo.com';
    UPDATE properties SET data=json_set(data,'$.price',2650000) WHERE code='PUB-XXXXXXXX';
    UPDATE properties SET data=json_set(data,'$.title','Nuevo título') WHERE code='PUB-XXXXXXXX';
    SELECT code,json_extract(data,'$.title') titulo,json_extract(data,'$.price') precio FROM properties WHERE code='PUB-XXXXXXXX';
    salir                               termina
  Recuerda: el texto va entre comillas simples '…' y cada comando termina en ;
`)
}

const arg = process.argv.slice(2).join(' ').trim()
if (arg) {
  if (/\.sql$/i.test(arg) && existsSync(arg)) run(readFileSync(arg, 'utf8'))
  else if (!special(arg)) run(arg)
  db.close()
} else {
  console.log('Consola de la base de datos de CasaFast. Escribe «ayuda» para ver ejemplos o «salir» para terminar.')
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'casafast> ' })
  let buffer = ''
  rl.prompt()
  rl.on('line', line => {
    if (!buffer && /^\s*(salir|exit|quit)\s*$/i.test(line)) { rl.close(); return }
    if (!buffer && special(line)) { rl.prompt(); return }
    buffer += `${line}\n`
    // Ejecuta cuando el comando termina en «;» (permite escribirlo en varias líneas).
    if (buffer.trim().endsWith(';')) { run(buffer); buffer = '' }
    rl.setPrompt(buffer ? '      ...> ' : 'casafast> '); rl.prompt()
  })
  rl.on('close', () => { db.close(); console.log('Hasta luego.') })
}
