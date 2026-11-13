// Folios legibles para localizar citas y publicaciones: CITA-7F3A9C21 y PUB-4B2E8D10.
// Se generan en la base de datos (disparadores), así cualquier forma de crear registros
// —la página, el script de ejemplos o una importación— recibe su folio automáticamente.
const NEW_CODE = prefix => `'${prefix}-'||upper(hex(randomblob(4)))`

export function ensureCodes(db) {
  for (const [table, prefix] of [['appointments', 'CITA'], ['properties', 'PUB']]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
    if (!columns.includes('code')) db.exec(`ALTER TABLE ${table} ADD COLUMN code TEXT`)
    // Registros anteriores: se les asigna folio uno por uno (sin repetir).
    const missing = db.prepare(`SELECT id FROM ${table} WHERE code IS NULL`).all()
    const assign = db.prepare(`UPDATE ${table} SET code=${NEW_CODE(prefix)} WHERE id=?`)
    for (const { id } of missing) assign.run(id)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_code ON ${table}(code);
      CREATE TRIGGER IF NOT EXISTS ${table}_code_insert AFTER INSERT ON ${table} WHEN NEW.code IS NULL
      BEGIN UPDATE ${table} SET code=${NEW_CODE(prefix)} WHERE id=NEW.id; END;`)
  }
}

export const isCode = text => /^(CITA|PUB)-[0-9A-F]{8}$/i.test(String(text || '').trim())
