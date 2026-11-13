import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const directory = resolve('server', 'data')
const backups = join(directory, 'backups')

mkdirSync(backups, { recursive: true })

const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')

const destination = join(
  backups,
  `casafast-${timestamp}.sqlite`
)

const db = new DatabaseSync(
  join(directory, 'casafast.sqlite')
)

try {
  const sqlPath = destination.replace(/'/g, "''")
  db.exec(`VACUUM INTO '${sqlPath}'`)
  console.log('Respaldo creado correctamente:')
  console.log(destination)
} finally {
  db.close()
}