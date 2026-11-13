// Genera publicaciones de DEMOSTRACIÓN en los 32 estados de México.
//
//   npm.cmd run demo:mexico               → crea 100 por estado (3,200 en total)
//   npm.cmd run demo:mexico -- 50         → crea 50 por estado
//   npm.cmd run demo:mexico -- quitar     → elimina todas las publicaciones generadas
//   npm.cmd run demo:mexico -- asignar    → solo pasa TODOS los ejemplos a la cuenta responsable
//   npm.cmd run demo:mexico -- asignar otro@correo.com
//
// Cuenta responsable de los ejemplos: recibe sus solicitudes de visita en «Mi espacio».
// Por defecto alfredovidriomarketplace@gmail.com (o la variable CASAFAST_DEMO_OWNER).
// Debe ser una cuenta ya registrada; si no existe, los ejemplos quedan sin responsable y no admiten visitas.
//
// Antes de escribir crea un respaldo en server/data/backups.
// Es repetible: cada ejecución reemplaza las publicaciones generadas anteriormente
// (identificadores «demo-mx-…») y no toca publicaciones reales ni los 20 ejemplos de Culiacán.
// Todas quedan marcadas como ejemplo (demo: true): no admiten visitas.

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = fileURLToPath(new URL('./data', import.meta.url))
const dbPath = join(dataDir, 'casafast.sqlite')
const arg = (process.argv[2] || '').toLowerCase()
const removeOnly = ['quitar', 'eliminar', 'borrar', '--quitar'].includes(arg)
const assignOnly = arg === 'asignar'
const ownerEmail = ((assignOnly && process.argv[3]) || process.env.CASAFAST_DEMO_OWNER || 'alfredovidriomarketplace@gmail.com').trim().toLowerCase()
const perState = removeOnly || assignOnly ? 0 : Number(arg || 100)

if (!existsSync(dbPath)) {
  console.error('No se encontró server/data/casafast.sqlite. Inicia CasaFast una vez con npm.cmd run dev para crearla.')
  process.exit(1)
}
if (!removeOnly && !assignOnly && (!Number.isInteger(perState) || perState < 1 || perState > 500)) {
  console.error('Indica una cantidad por estado entre 1 y 500, o «quitar».')
  process.exit(1)
}

// --- Ciudades por estado -------------------------------------------------
// [ciudad, lat, lng, multiplicador de precio, dirección hacia tierra firme]
// La dirección evita puntos en el mar en ciudades costeras: {lat:1} = solo hacia el norte, {lng:-1} = solo hacia el oeste, etc.
const N = { lat: 1 }, S = { lat: -1 }, E = { lng: 1 }, W = { lng: -1 }
const STATES = [
  ['Aguascalientes', 1.0, [['Aguascalientes', 21.8818, -102.2916], ['Jesús María', 21.9614, -102.3436], ['Calvillo', 21.8467, -102.7186, 0.8]]],
  ['Baja California', 1.15, [['Tijuana', 32.5149, -117.0382, 1, E], ['Mexicali', 32.6245, -115.4523], ['Ensenada', 31.8667, -116.5964, 1, E], ['Playas de Rosarito', 32.3661, -117.0618, 1.1, E]]],
  ['Baja California Sur', 1.4, [['La Paz', 24.1426, -110.3128, 1, { lat: -1, lng: 1 }], ['Cabo San Lucas', 22.8905, -109.9167, 1.6, N], ['San José del Cabo', 23.0592, -109.6974, 1.5, N], ['Loreto', 26.0128, -111.3478, 1.1, W]]],
  ['Campeche', 0.85, [['San Francisco de Campeche', 19.8301, -90.5349, 1, { lat: -1, lng: 1 }], ['Escárcega', 18.6097, -90.7418, 0.8], ['Champotón', 19.35, -90.7167, 0.85, E]]],
  ['Chiapas', 0.8, [['Tuxtla Gutiérrez', 16.7531, -93.1156], ['San Cristóbal de las Casas', 16.737, -92.6376, 1.05], ['Tapachula', 14.9056, -92.2633], ['Comitán de Domínguez', 16.251, -92.1342, 0.9]]],
  ['Chihuahua', 1.0, [['Chihuahua', 28.6353, -106.0889], ['Ciudad Juárez', 31.6904, -106.4245], ['Delicias', 28.1909, -105.4717, 0.85], ['Hidalgo del Parral', 26.9318, -105.6664, 0.8]]],
  ['Ciudad de México', 1.9, [['Benito Juárez', 19.3727, -99.1586, 1.2], ['Coyoacán', 19.3467, -99.1617, 1.1], ['Miguel Hidalgo', 19.4326, -99.2, 1.4], ['Tlalpan', 19.2964, -99.1679, 0.9], ['Cuauhtémoc', 19.4326, -99.1475, 1.1]]],
  ['Coahuila', 1.0, [['Saltillo', 25.4232, -101.0053], ['Torreón', 25.5428, -103.4068], ['Monclova', 26.908, -101.4215, 0.85], ['Piedras Negras', 28.7, -100.5234, 0.85]]],
  ['Colima', 0.95, [['Colima', 19.2433, -103.725], ['Villa de Álvarez', 19.2667, -103.7372], ['Manzanillo', 19.0522, -104.3158, 1.15, { lat: 1, lng: 1 }], ['Tecomán', 18.9089, -103.8747, 0.8]]],
  ['Durango', 0.85, [['Victoria de Durango', 24.0277, -104.6532], ['Gómez Palacio', 25.5701, -103.4983], ['Lerdo', 25.5378, -103.5244, 0.9]]],
  ['Guanajuato', 1.05, [['León', 21.125, -101.686], ['Guanajuato', 21.019, -101.2574, 1.05], ['Irapuato', 20.6767, -101.3563, 0.9], ['Celaya', 20.5235, -100.8157, 0.95], ['San Miguel de Allende', 20.9144, -100.7452, 1.7]]],
  ['Guerrero', 0.9, [['Acapulco', 16.8531, -99.8237, 1.2, N], ['Chilpancingo', 17.5515, -99.5006, 0.8], ['Zihuatanejo', 17.6417, -101.551, 1.3, { lat: 1, lng: 1 }], ['Taxco', 18.556, -99.605, 0.9]]],
  ['Hidalgo', 0.9, [['Pachuca', 20.1011, -98.7591], ['Mineral de la Reforma', 20.0716, -98.6977], ['Tulancingo', 20.0833, -98.3667, 0.85], ['Tula de Allende', 20.0539, -99.342, 0.85]]],
  ['Jalisco', 1.3, [['Guadalajara', 20.6597, -103.3496], ['Zapopan', 20.7214, -103.3918, 1.2], ['Tlaquepaque', 20.6409, -103.2934, 0.9], ['Tlajomulco de Zúñiga', 20.4736, -103.4469, 0.85], ['Puerto Vallarta', 20.6534, -105.2253, 1.4, E]]],
  ['Estado de México', 1.15, [['Toluca', 19.2826, -99.6557], ['Metepec', 19.2513, -99.6047, 1.1], ['Naucalpan', 19.4785, -99.2396, 1.15], ['Huixquilucan', 19.36, -99.35, 1.6], ['Ecatepec', 19.6018, -99.0507, 0.75]]],
  ['Michoacán', 0.9, [['Morelia', 19.706, -101.195], ['Uruapan', 19.4167, -102.0566, 0.9], ['Zamora', 19.9855, -102.2839, 0.85], ['Pátzcuaro', 19.5156, -101.6091, 0.95]]],
  ['Morelos', 1.05, [['Cuernavaca', 18.9242, -99.2216, 1.15], ['Jiutepec', 18.8814, -99.1776], ['Temixco', 18.85, -99.2333, 0.9], ['Cuautla', 18.8121, -98.9548, 0.85]]],
  ['Nayarit', 1.0, [['Tepic', 21.5042, -104.8946, 0.85], ['Nuevo Vallarta', 20.6969, -105.295, 1.5, E], ['Compostela', 21.2386, -104.9008, 0.8]]],
  ['Nuevo León', 1.45, [['Monterrey', 25.6866, -100.3161], ['San Pedro Garza García', 25.6573, -100.4023, 1.8], ['Guadalupe', 25.6775, -100.2597, 0.85], ['Apodaca', 25.7817, -100.1886, 0.8], ['Santa Catarina', 25.6733, -100.4583, 0.9]]],
  ['Oaxaca', 0.85, [['Oaxaca de Juárez', 17.0732, -96.7266, 1.1], ['Puerto Escondido', 15.872, -97.0767, 1.3, N], ['Salina Cruz', 16.1667, -95.2, 0.85, N], ['Juchitán de Zaragoza', 16.4333, -95.0167, 0.8]]],
  ['Puebla', 1.0, [['Puebla', 19.0414, -98.2063], ['San Andrés Cholula', 19.0517, -98.2995, 1.4], ['Atlixco', 18.9083, -98.4364, 0.85], ['Tehuacán', 18.4617, -97.3928, 0.8]]],
  ['Querétaro', 1.25, [['Santiago de Querétaro', 20.5888, -100.3899], ['Corregidora', 20.5333, -100.4333, 1.05], ['El Marqués', 20.617, -100.3, 0.95], ['San Juan del Río', 20.388, -99.996, 0.85]]],
  ['Quintana Roo', 1.35, [['Cancún', 21.1619, -86.8515, 1.1, W], ['Playa del Carmen', 20.6296, -87.0739, 1.2, W], ['Tulum', 20.2114, -87.4654, 1.3, W], ['Chetumal', 18.5001, -88.2961, 0.75, W]]],
  ['San Luis Potosí', 0.95, [['San Luis Potosí', 22.1565, -100.9855], ['Soledad de Graciano Sánchez', 22.1833, -100.9333, 0.85], ['Ciudad Valles', 21.9833, -99.0167, 0.8], ['Matehuala', 23.65, -100.65, 0.8]]],
  ['Sinaloa', 1.0, [['Culiacán', 24.8091, -107.394], ['Mazatlán', 23.2494, -106.4111, 1.2, E], ['Los Mochis', 25.7905, -108.9859, 0.9], ['Guasave', 25.5667, -108.4667, 0.8], ['Navolato', 24.766, -107.702, 0.8]]],
  ['Sonora', 1.0, [['Hermosillo', 29.0729, -110.9559], ['Ciudad Obregón', 27.4863, -109.9408, 0.9], ['Nogales', 31.3086, -110.9422, 0.85], ['Navojoa', 27.0728, -109.4437, 0.8], ['San Carlos', 27.96, -111.04, 1.3, { lat: 1, lng: 1 }]]],
  ['Tabasco', 0.9, [['Villahermosa', 17.9895, -92.9475], ['Cárdenas', 18.001, -93.3756, 0.8], ['Comalcalco', 18.2633, -93.2242, 0.8], ['Paraíso', 18.3983, -93.2142, 0.85, S]]],
  ['Tamaulipas', 0.95, [['Tampico', 22.2331, -97.8611], ['Ciudad Victoria', 23.7369, -99.1411, 0.85], ['Reynosa', 26.0508, -98.2979], ['Matamoros', 25.869, -97.5027, 0.9], ['Nuevo Laredo', 27.4779, -99.5496, 0.9]]],
  ['Tlaxcala', 0.8, [['Tlaxcala', 19.3139, -98.2404], ['Apizaco', 19.4167, -98.1333], ['Huamantla', 19.3133, -97.9228, 0.9], ['Chiautempan', 19.3114, -98.1897, 0.9]]],
  ['Veracruz', 0.95, [['Veracruz', 19.1738, -96.1342, 1, W], ['Boca del Río', 19.1056, -96.1053, 1.25, W], ['Xalapa', 19.5438, -96.9102], ['Coatzacoalcos', 18.1345, -94.459, 0.9, S], ['Córdoba', 18.8842, -96.9256, 0.85]]],
  ['Yucatán', 1.1, [['Mérida', 20.9674, -89.5926, 1.1], ['Progreso', 21.2833, -89.6667, 0.95, S], ['Valladolid', 20.6896, -88.2011, 0.85], ['Tizimín', 21.1428, -88.1647, 0.75]]],
  ['Zacatecas', 0.8, [['Zacatecas', 22.7709, -102.5832], ['Guadalupe', 22.7475, -102.5175], ['Fresnillo', 23.1748, -102.8687, 0.85], ['Jerez de García Salinas', 22.6489, -103.0019, 0.85]]]
]

const COLONIAS = ['Centro', 'Del Valle', 'Jardines del Bosque', 'Las Fuentes', 'Residencial del Parque', 'Lomas del Sol', 'Villa Real', 'Los Pinos', 'Bosques del Lago', 'Las Palmas', 'El Mirador', 'Hacienda Real', 'Puerta del Sol', 'Valle Dorado', 'La Joya', 'Colinas del Rey', 'Altavista', 'Arboledas', 'Campestre', 'Los Álamos', 'Santa Rosa', 'Real del Bosque', 'Portales', 'Rinconada', 'Vista Hermosa', 'Las Huertas', 'San Rafael', 'Lomas Verdes', 'Jardines del Sur', 'Fraccionamiento Las Flores']
const PHOTOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 17, 18, 19, 21, 23, 24, 25].map(n => `/images/demo-catalog/photo-${n}.jpg`)
const TITLES = {
  Casa: ['Casa con jardín en {c}', 'Casa familiar en {c}', 'Casa moderna en {c}', 'Casa amplia en {c}', 'Casa con terraza en {c}', 'Casa de dos plantas en {c}', 'Casa iluminada en {c}', 'Casa en privada en {c}', 'Casa con cochera doble en {c}', 'Casa remodelada en {c}'],
  Departamento: ['Departamento en {c}', 'Departamento con balcón en {c}', 'Departamento luminoso en {c}', 'Departamento cerca de todo en {c}', 'Departamento con amenidades en {c}', 'Loft moderno en {c}', 'Departamento con vista en {c}', 'Departamento listo para habitar en {c}'],
  Terreno: ['Terreno residencial en {c}', 'Terreno plano en {c}', 'Lote en privada en {c}', 'Terreno con servicios en {c}', 'Terreno para construir en {c}']
}

// Generador pseudoaleatorio con semilla: los mismos datos en cada ejecución.
let seed = 20261111
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const between = (a, b) => a + rand() * (b - a)
const int = (a, b) => Math.floor(between(a, b + 1))
const pick = list => list[Math.floor(rand() * list.length)]
const gauss = () => { const u = Math.max(rand(), 1e-9), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
const slug = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const round = (value, step) => Math.max(step, Math.round(value / step) * step)

function listing(state, stateMult, city, index) {
  const [cityName, lat, lng, cityMult = 1, land] = city
  const mult = stateMult * cityMult
  const roll = rand()
  const type = roll < 0.55 ? 'Casa' : roll < 0.85 ? 'Departamento' : 'Terreno'
  const operation = type === 'Terreno' ? 'venta' : rand() < 0.68 ? 'venta' : 'renta'
  const colonia = pick(COLONIAS)

  // Punto cercano al centro de la ciudad (≈ 0 a 7 km), respetando la dirección hacia tierra.
  const spread = land ? 0.022 : 0.03
  let dLat = Math.max(-2.4, Math.min(2.4, gauss())) * spread
  let dLng = Math.max(-2.4, Math.min(2.4, gauss())) * spread
  if (land?.lat) dLat = Math.abs(dLat) * land.lat + 0.004 * land.lat
  if (land?.lng) dLng = Math.abs(dLng) * land.lng + 0.004 * land.lng

  let bedrooms, bathrooms, area, value
  if (type === 'Casa') {
    bedrooms = int(2, 5); bathrooms = Math.min(bedrooms, int(1, 4)); area = int(85, 120) + bedrooms * int(15, 45)
    value = area * 13500 * mult * between(0.75, 1.3)
  } else if (type === 'Departamento') {
    bedrooms = int(1, 3); bathrooms = Math.min(bedrooms + 1, int(1, 3)); area = int(48, 70) + bedrooms * int(10, 28)
    value = area * 19000 * mult * between(0.75, 1.3)
  } else {
    bedrooms = 0; bathrooms = 0; area = round(int(150, 900), 10)
    value = area * 3200 * mult * between(0.6, 1.4)
  }
  const price = operation === 'venta' ? round(value, 10000) : round(value * between(0.0038, 0.0052), 500)
  const images = Array.from({ length: type === 'Terreno' ? 2 : int(3, 5) }, () => pick(PHOTOS)).filter((p, i, all) => all.indexOf(p) === i)
  const created = new Date(Date.now() - between(0, 75) * 86400000).toISOString()
  const location = `${colonia}, ${cityName}, ${state}`
  const what = type === 'Terreno' ? `terreno de ${area} m²` : `${type.toLowerCase()} de ${bedrooms} ${bedrooms === 1 ? 'recámara' : 'recámaras'}, ${bathrooms} ${bathrooms === 1 ? 'baño' : 'baños'} y ${area} m²`

  return {
    id: `demo-mx-${slug(state)}-${String(index + 1).padStart(3, '0')}`,
    data: {
      title: pick(TITLES[type]).replace('{c}', colonia),
      operation, type, price, bedrooms, bathrooms, area,
      lat: Math.round((lat + dLat) * 1e5) / 1e5,
      lng: Math.round((lng + dLng) * 1e5) / 1e5,
      location,
      address: `Zona ilustrativa de ${location}. Punto aproximado; no corresponde a un domicilio verificado.`,
      description: `ANUNCIO DE DEMOSTRACIÓN generado para probar CasaFast en todo México: ${what}. Los datos, precio y punto del mapa son ilustrativos; la colonia es un nombre de ejemplo. Las fotografías son referencias y se repiten en otros anuncios. Esta publicación no admite solicitudes de visita.`,
      images: images.length ? images : [PHOTOS[0]],
      demo: true,
      generated: 'mexico',
      created
    }
  }
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')

// Respaldo previo
mkdirSync(join(dataDir, 'backups'), { recursive: true })
const backup = join(dataDir, 'backups', `casafast-antes-de-demo-mexico-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`)
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`)
console.log(`Respaldo creado: ${backup}`)

const existing = db.prepare("SELECT COUNT(*) AS n FROM properties WHERE id LIKE 'demo-mx-%'").get().n
const owner = db.prepare('SELECT id,name,role,active FROM users WHERE lower(email)=?').get(ownerEmail)
let assigned = 0
db.exec('BEGIN')
try {
  if (assignOnly) {
    if (!owner) throw new Error(`No existe una cuenta registrada con ${ownerEmail}. Regístrala en CasaFast y vuelve a intentarlo.`)
  } else {
  db.prepare("DELETE FROM favorites WHERE property_id LIKE 'demo-mx-%'").run()
  db.prepare("DELETE FROM appointments WHERE property_id LIKE 'demo-mx-%'").run()
  db.prepare("DELETE FROM properties WHERE id LIKE 'demo-mx-%'").run()

  if (!removeOnly) {
    const columns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name)
    const demoUser = db.prepare("SELECT id FROM users WHERE id='demo'").get()
    if (!demoUser) {
      if (columns.includes('verified')) db.prepare("INSERT INTO users(id,name,email,password,role,active,verified) VALUES('demo','CasaFast · Ejemplos','catalogo@example.invalid','','vendedor',0,0)").run()
      else db.prepare("INSERT INTO users(id,name,email,password,role,active) VALUES('demo','CasaFast · Ejemplos','catalogo@example.invalid','','vendedor',0)").run()
    }
    const insert = db.prepare("INSERT INTO properties(id,seller_id,data,active) VALUES(?, 'demo', ?, 1)")
    for (const [state, stateMult, cities] of STATES) {
      for (let i = 0; i < perState; i++) {
        const p = listing(state, stateMult, cities[i % cities.length], i)
        insert.run(p.id, JSON.stringify(p.data))
      }
    }
  }
  }

  // Todos los ejemplos (los generados y los 20 de Culiacán) pasan a la cuenta responsable.
  if (owner && !removeOnly) {
    if (owner.role === 'comprador') db.prepare("UPDATE users SET role='vendedor' WHERE id=?").run(owner.id)
    assigned = db.prepare("UPDATE properties SET seller_id=? WHERE seller_id='demo' OR json_extract(data,'$.demo')=1").run(owner.id).changes
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  db.close()
  console.error('No se pudo completar. La base de datos no cambió.', error.message)
  process.exit(1)
}

const total = db.prepare("SELECT COUNT(*) AS n FROM properties WHERE id LIKE 'demo-mx-%'").get().n
db.close()
const ownerNote = owner
  ? `\n${assigned} ejemplos asignados a ${ownerEmail}: sus solicitudes de visita llegarán a «Mi espacio» de esa cuenta.${owner.active ? '' : ' Atención: esa cuenta está desactivada; actívala para que reciba visitas.'}`
  : `\nAviso: no existe la cuenta ${ownerEmail}. Los ejemplos quedan sin responsable y no admiten visitas hasta ejecutar «npm.cmd run demo:mexico -- asignar correo».`
if (removeOnly) console.log(`Se eliminaron ${existing} publicaciones de demostración de México.`)
else if (assignOnly) console.log(ownerNote.trim())
else console.log(`Listo: ${total} publicaciones de demostración (${perState} por estado en ${STATES.length} estados).${existing ? ` Se reemplazaron ${existing} anteriores (y sus citas y favoritos).` : ''}${ownerNote}\nActualiza la página de CasaFast para verlas.`)
