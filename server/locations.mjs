
import { randomBytes, createHash } from 'node:crypto'

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status })
}

const digest = value =>
  createHash('sha256').update(value).digest('hex')

const normalize = value =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const fields = [
  'street', 'number', 'neighborhood', 'city',
  'state', 'postalCode', 'unit', 'reference'
]

export function cleanLocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Selecciona y confirma la ubicación en el mapa.')
  }

  const result = {}

  for (const field of fields) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      fail('Datos de dirección inválidos.')
    }

    result[field] = (value[field] || '').trim()

    if (result[field].length > (field === 'reference' ? 300 : 120)) {
      fail('La dirección contiene un campo demasiado largo.')
    }
  }

  if (!result.street || !result.city || !result.state) {
    fail('Completa calle, ciudad y estado antes de confirmar.')
  }

  if (result.postalCode && !/^\d{5}$/.test(result.postalCode)) {
    fail('El código postal debe tener cinco dígitos.')
  }

  return result
}

const coords = value => {
  if (
    !value ||
    value.lat === '' ||
    value.lng === '' ||
    value.lat == null ||
    value.lng == null ||
    !Number.isFinite(Number(value.lat)) ||
    !Number.isFinite(Number(value.lng)) ||
    Math.abs(Number(value.lat)) > 90 ||
    Math.abs(Number(value.lng)) > 180
  ) {
    fail('Selecciona un punto válido en el mapa.')
  }

  return {
    lat: Number(value.lat),
    lng: Number(value.lng)
  }
}

export function meters(a, b) {
  const rad = x => x * Math.PI / 180
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) *
    Math.cos(rad(b.lat)) *
    Math.sin(rad(b.lng - a.lng) / 2) ** 2

  return 6371000 * 2 *
    Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}

const fingerprint = (point, address) =>
  digest(JSON.stringify([
    point.lat,
    point.lng,
    ...fields.map(key => normalize(address[key]))
  ]))

const addressText = a =>
  [
    `${a.street} ${a.number}`.trim(),
    a.neighborhood,
    a.city,
    a.state,
    a.postalCode
  ].filter(Boolean).join(', ')

// Convierte las respuestas de Nominatim al formato de CasaFast.
export function parseGeocode(result) {
  const a = result.address || {}

  return {
    placeId: String(
      result.place_id ||
      `${result.osm_type || 'osm'}:${result.osm_id || 'unknown'}`
    ),
    formatted: result.display_name || '',
    lat: Number(result.lat),
    lng: Number(result.lon),
    types: [result.type, result.addresstype].filter(Boolean),
    partial: false,
    precision: result.addresstype || result.type || 'unknown',
    country: String(a.country_code || '').toUpperCase(),
    address: {
      street:
        a.road || a.pedestrian || a.residential ||
        a.footway || a.path || '',
      number: a.house_number || '',
      neighborhood:
        a.neighbourhood || a.suburb || a.quarter ||
        a.city_district || '',
      city:
        a.city || a.town || a.village ||
        a.municipality || a.county || '',
      state: a.state || '',
      postalCode: a.postcode || '',
      unit: '',
      reference: ''
    }
  }
}

// Control compartido para respetar el límite del servicio público.
// Se aplica a las consultas de este proceso del servidor.
const cache = new Map()
let nextRequestAt = 0
let queue = Promise.resolve()

function scheduleRequest(task) {
  const run = queue.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now())

    if (wait) {
      await new Promise(resolve => setTimeout(resolve, wait))
    }

    nextRequestAt = Date.now() + 1100

    return task()
  })

  queue = run.catch(() => {})
  return run
}

export function createGeocoder(env = {}, request = fetch) {
  const email = String(env.NOMINATIM_CONTACT_EMAIL || '').trim()

  return {
    enabled: Boolean(email),

    async lookup(params) {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        fail(
          'Configura NOMINATIM_CONTACT_EMAIL en el servidor para habilitar la búsqueda.',
          503
        )
      }

      const reverse = Boolean(params.latlng)
      const url = new URL(
        reverse
          ? 'https://nominatim.openstreetmap.org/reverse'
          : 'https://nominatim.openstreetmap.org/search'
      )

      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('addressdetails', '1')
      url.searchParams.set('accept-language', 'es')
      url.searchParams.set('email', email)

      if (reverse) {
        const [lat, lng] = String(params.latlng).split(',')
        const point = coords({ lat, lng })

        url.searchParams.set('lat', String(point.lat))
        url.searchParams.set('lon', String(point.lng))
        url.searchParams.set('zoom', '18')
      } else {
        url.searchParams.set('q', String(params.address || ''))
        url.searchParams.set('countrycodes', 'mx')
        url.searchParams.set('limit', '5')
      }

      const key = url.toString()
      const saved = cache.get(key)

      if (saved && saved.expires > Date.now()) {
        return saved.results
      }

      return scheduleRequest(async () => {
        // Comprobar otra vez después de esperar en la cola.
        const cached = cache.get(key)

        if (cached && cached.expires > Date.now()) {
          return cached.results
        }

        let response
        let data

        try {
          response = await request(url, {
            headers: {
              'User-Agent': `CasaFast/1.0 (${email})`,
              'Accept': 'application/json'
            },
            signal: AbortSignal.timeout(12000)
          })

          if (!response.ok) {
            console.error(
              '[CasaFast Nominatim]',
              'HTTP',
              response.status
            )

            fail(
              'El servicio de búsqueda de direcciones no está disponible. Inténtalo más tarde.',
              503
            )
          }

          data = await response.json()
        } catch (error) {
          if (error.status) throw error

          fail(
            'No fue posible consultar OpenStreetMap. Revisa la conexión.',
            503
          )
        }

        const items = reverse
          ? (data && !data.error ? [data] : [])
          : (Array.isArray(data) ? data : [])

        const results = items
          .map(parseGeocode)
          .filter(item =>
            item.country === 'MX' &&
            Number.isFinite(item.lat) &&
            Number.isFinite(item.lng)
          )

        cache.set(key, {
          results,
          expires: Date.now() + 24 * 60 * 60 * 1000
        })

        // Evita que la memoria crezca indefinidamente.
        if (cache.size > 500) {
          cache.delete(cache.keys().next().value)
        }

        return results
      })
    }
  }
}

export function createLocations(
  db,
  { env = {}, geocoder: provided } = {}
) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS location_checks (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      place_id TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
  `)

  const geocoder = provided || createGeocoder(env)
  const limits = new Map()

  const publicLimits = new Map()

function limitPublicSearch() {
  const now = Date.now()
  const key = 'public-location-search'

  for (const [id, entry] of publicLimits) {
    if (entry.until <= now) publicLimits.delete(id)
  }

  const entry = publicLimits.get(key) || {
    count: 0,
    until: now + 60000
  }

  if (entry.count >= 20) {
    fail(
      'Demasiadas búsquedas. Espera un momento.',
      429
    )
  }

  entry.count += 1
  publicLimits.set(key, entry)
}

  const ready = () => {
    if (!geocoder.enabled) {
      fail(
        'La búsqueda de ubicaciones requiere configurar el correo de contacto de Nominatim.',
        503
      )
    }
  }

  function limit(user) {
    const now = Date.now()

    for (const [key, value] of limits) {
      if (value.until < now) limits.delete(key)
    }

    const entry = limits.get(user.id) || {
      count: 0,
      until: now + 60000
    }

    if (++entry.count > 20) {
      fail(
        'Has realizado demasiadas consultas. Espera un minuto.',
        429
      )
    }

    limits.set(user.id, entry)
  }

  function compatible(expected, actual) {
    // Si Nominatim no dispone del dato, no lo consideramos
    // una comprobación positiva ni una contradicción.
    return !actual || normalize(expected) === normalize(actual)
  }

  function matchesArea(address, found) {
    return (
      found?.country === 'MX' &&
      compatible(address.city, found.address.city) &&
      compatible(address.state, found.address.state) &&
      compatible(address.street, found.address.street)
    )
  }

  return {
    config: {
      mapsEnabled: true,
      mapsBrowserKey: '',
      mapsMapId: ''
    },

    async handle({ path, method, body, auth, send }) {
      
const routes = [
  '/api/locations/search',
  '/api/locations/reverse',
  '/api/locations/confirm',
  '/api/locations/public-search'
]

if (method !== 'POST' || !routes.includes(path)) {
  return false
}

// Búsqueda pública para compradores y visitantes.
// No genera tokens ni confirma direcciones.
if (path === '/api/locations/public-search') {
  ready()
  limitPublicSearch()

  if (
    !body ||
    typeof body.query !== 'string' ||
    body.query.trim().length < 4 ||
    body.query.length > 250
  ) {
    fail(
      'Escribe una colonia, ciudad o estado de al menos cuatro caracteres.'
    )
  }

  const results = await geocoder.lookup({
    address: body.query.trim()
  })

  send(
    results.slice(0, 5).map(result => ({
      placeId: result.placeId,
      formatted: result.formatted,
      lat: result.lat,
      lng: result.lng,
      precision: result.precision
    }))
  )

  return true
}

      const user = auth(['vendedor', 'admin'])

      ready()
      limit(user)

      if (path === '/api/locations/search') {
        if (
          typeof body.query !== 'string' ||
          body.query.trim().length < 4 ||
          body.query.length > 250
        ) {
          fail('Escribe una calle, colonia o ciudad de al menos cuatro caracteres.')
        }

        const results = await geocoder.lookup({
          address: body.query.trim(),
          components: 'country:MX'
        })

        send(results.slice(0, 5))
        return true
      }

      const point = coords(body)

      if (path === '/api/locations/reverse') {
        const results = await geocoder.lookup({
          latlng: `${point.lat},${point.lng}`
        })

        const result = results[0]

        if (!result) {
          fail(
            'No encontramos datos para ese punto. Puedes seleccionar otro lugar.',
            404
          )
        }

        send({
          ...result,
          lat: point.lat,
          lng: point.lng
        })

        return true
      }

      const address = cleanLocation(body.locationDetails)

      if (body.confirmed !== true) {
        fail(
          'Confirma que el pin corresponde a la entrada de tu inmueble.'
        )
      }

      // La comprobación se realiza sobre el punto seleccionado.
      // No afirmamos que un número exterior exista cuando
      // OpenStreetMap no dispone de esa información.
      const results = await geocoder.lookup({
        latlng: `${point.lat},${point.lng}`
      })

      const match = results.find(result =>
        matchesArea(address, result)
      )

      if (!match) {
        fail(
          'No pudimos contrastar la ubicación con los datos disponibles. Revisa la calle, ciudad y estado, o selecciona otro punto.'
        )
      }

      // Exigimos que el servicio devuelva datos geográficos
      // suficientes para contrastar la ubicación.
      if (
        !match.address.street ||
        !match.address.city ||
        !match.address.state
      ) {
        fail(
          'OpenStreetMap no dispone de información suficiente sobre esta calle. Prueba seleccionando un punto más preciso.'
        )
      }

      // Un número o código postal diferente, cuando ambos
      // están disponibles, es una contradicción.
      if (
        (address.number && match.address.number &&
          normalize(address.number) !== normalize(match.address.number)) ||
        (address.postalCode && match.address.postalCode &&
          address.postalCode !== match.address.postalCode)
      ) {
        fail(
          'El número exterior o código postal no coincide con los datos del mapa. Revisa la dirección.'
        )
      }

      const token = randomBytes(32).toString('hex')
      const expires = Date.now() + 30 * 60000

      db.prepare(
        'DELETE FROM location_checks WHERE expires<=?'
      ).run(Date.now())

      db.prepare(
        'INSERT INTO location_checks VALUES(?,?,?,?,?)'
      ).run(
        digest(token),
        user.id,
        fingerprint(point, address),
        match.placeId,
        expires
      )

      send({
        locationToken: token,
        expires,
        precision: match.precision,
        message:
          'Punto contrastado con OpenStreetMap. La existencia física y el número exterior no están garantizados.'
      })

      return true
    },

    forProperty(body, old, user) {
      const point = coords(body)
      const address = cleanLocation(body.locationDetails)
      const fp = fingerprint(point, address)

      let placeId
      let verifiedAt
      let provider = 'openstreetmap'

      const oldProvider = old?.locationVerification?.provider
      const oldMatches = Boolean(
        old?.locationDetails &&
        fp === fingerprint(
          coords(old),
          cleanLocation(old.locationDetails)
        )
      )

      // Conservamos verificaciones anteriores cuando
      // la ubicación y dirección no cambiaron.
      if (
        oldMatches &&
        ['google', 'openstreetmap'].includes(oldProvider)
      ) {
        provider = oldProvider
        placeId = old.locationVerification.placeId
        verifiedAt = old.locationVerification.checkedAt
      } else {
        ready()

        if (
          typeof body.locationToken !== 'string' ||
          !/^[a-f0-9]{64}$/.test(body.locationToken)
        ) {
          fail('Valida la dirección en el mapa antes de publicar.')
        }

        const check = db.prepare(`
          SELECT *
          FROM location_checks
          WHERE token=? AND user_id=? AND expires>?
        `).get(
          digest(body.locationToken),
          user.id,
          Date.now()
        )

        if (!check || check.fingerprint !== fp) {
          fail(
            'La validación caducó o cambió la dirección. Vuelve a confirmarla.'
          )
        }

        placeId = check.place_id
        verifiedAt = new Date().toISOString()

        // El token solo puede utilizarse una vez.
        db.prepare(
          'DELETE FROM location_checks WHERE token=?'
        ).run(digest(body.locationToken))
      }

      return {
        ...point,
        location: [
          address.neighborhood,
          address.city,
          address.state
        ].filter(Boolean).join(', '),
        address:
          addressText(address) +
          (address.unit ? ` · Interior ${address.unit}` : ''),
        locationDetails: address,
        locationVerification: {
          provider,
          placeId,
          checkedAt: verifiedAt
        }
      }
    }
  }
}
