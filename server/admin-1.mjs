// Crea o asigna la cuenta administradora desde la terminal de la computadora donde corre CasaFast.
//
//   npm.cmd run admin -- correo@ejemplo.com CONFIRMAR-ADMIN
//
// · Si la cuenta ya existe, la convierte en administradora (y marca su correo como verificado).
// · Si no existe, la crea aquí mismo: pide nombre y contraseña en la terminal.
//   No depende del envío de correos, porque solo puede hacerlo quien tiene acceso a esta computadora.

import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { randomUUID, randomBytes, scryptSync } from 'node:crypto'
import { createInterface } from 'node:readline'

const path = fileURLToPath(new URL('./data/casafast.sqlite', import.meta.url))
const email = process.argv[2]?.trim().toLowerCase()
const confirmation = process.argv[3]

if (process.env.NODE_ENV === 'production') {
  console.error('La asignación de administradores está deshabilitada en producción.')
  process.exit(1)
}
if (!email || confirmation !== 'CONFIRMAR-ADMIN') {
  console.error('Uso: npm.cmd run admin -- correo@ejemplo.com CONFIRMAR-ADMIN')
  process.exit(1)
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
  console.error('Escribe un correo válido.')
  process.exit(1)
}
if (!existsSync(path)) {
  console.error('No se encontró la base de datos de CasaFast. Inicia CasaFast una vez con npm.cmd run dev.')
  process.exit(1)
}

// Preguntas en la terminal con un solo lector; las contraseñas se muestran como asteriscos.
// Las líneas se guardan en una cola para no perder respuestas que lleguen antes de la pregunta.
let rl, muted = false
const lines = [], waiting = []
function ask(question, hidden = false) {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY })
    rl._writeToOutput = text => { if (!muted) process.stdout.write(text); else if (!/[\r\n]/.test(text)) process.stdout.write('*'.repeat(text.length)) }
    rl.on('line', line => { const next = waiting.shift(); if (next) next(line); else lines.push(line) })
    rl.on('close', () => { while (waiting.length) waiting.shift()('') })
  }
  process.stdout.write(question)
  muted = hidden
  return new Promise(resolve => {
    const done = answer => { if (hidden) process.stdout.write('\n'); muted = false; resolve(answer) }
    if (lines.length) done(lines.shift()); else waiting.push(done)
  })
}
const hashPassword = password => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}` }

const db = new DatabaseSync(path)
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
const audit = (actor, action) => db.prepare('INSERT INTO audit(id, actor, action, target, created) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), actor, action, actor, new Date().toISOString())

try {
  const account = db.prepare('SELECT id, name, email, role, active, verified FROM users WHERE email = ?').get(email)

  if (!account) {
    console.log(`No existe una cuenta con ${email}. Vamos a crearla como administradora.`)
    const name = (await ask('Nombre para mostrar: ')).trim()
    if (!name || name.length > 100) throw new Error('Escribe un nombre (máximo 100 caracteres).')
    const password = await ask('Contraseña (mínimo 10 caracteres): ', true)
    if (password.length < 10 || password.length > 128) throw new Error('La contraseña debe tener entre 10 y 128 caracteres.')
    const repeat = await ask('Repite la contraseña: ', true)
    if (repeat !== password) throw new Error('Las contraseñas no coinciden.')
    const id = randomUUID()
    db.prepare("INSERT INTO users(id,name,email,password,role,active,verified) VALUES(?,?,?,?,'admin',1,1)").run(id, name, email, hashPassword(password))
    audit(id, 'crear administrador mediante CLI')
    console.log('\nCuenta administradora creada.')
  } else {
    if (!account.active) throw new Error('La cuenta está suspendida. Reactívala antes de hacerla administradora.')
    if (account.role === 'admin' && account.verified) {
      console.log('Esta cuenta ya es administradora.')
    } else {
      db.prepare("UPDATE users SET role='admin', verified=1 WHERE id=?").run(account.id)
      audit(account.id, 'asignar administrador mediante CLI')
      console.log('Administrador configurado correctamente.')
    }
  }
  console.log(`Cuenta: ${email}`)
  console.log('Inicia sesión en CasaFast con esa cuenta y abre http://127.0.0.1:5173/?admin')
} catch (error) {
  console.error('Error:', error.message)
  process.exitCode = 1
} finally {
  rl?.close()
  db.close()
}
