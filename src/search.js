import { distanceKm, money, normalized } from './lib'

export const emptyFilters = {
  operation: '',
  query: '',
  max: '',
  rooms: '',
  type: '',
  radius: '',
  city: 'Culiacán',
  sort: 'new'
}

export function validPoint(p) {
  return Boolean(p) &&
    p.lat !== null &&
    p.lng !== null &&
    p.lat !== '' &&
    p.lng !== '' &&
    Number.isFinite(Number(p.lat)) &&
    Number.isFinite(Number(p.lng)) &&
    Math.abs(Number(p.lat)) <= 90 &&
    Math.abs(Number(p.lng)) <= 180
}

// Motor único de búsqueda: lo usan el catálogo, el mapa y las búsquedas guardadas.
export function applyFilters(properties, filters, center) {
  return properties
    .filter(p => p.active)
    .map(p => ({
      ...p,
      km: validPoint(center) && validPoint(p) ? distanceKm(center, p) : undefined
    }))
    .filter(p =>
      (!filters.operation || p.operation === filters.operation) &&
      (!filters.query || normalized(`${p.title} ${p.location}`).includes(normalized(filters.query))) &&
      (!filters.type || p.type === filters.type) &&
      (!filters.max || p.price <= Number(filters.max)) &&
      (!filters.rooms || p.bedrooms >= Number(filters.rooms)) &&
      (!filters.radius || (p.km !== undefined && p.km <= Number(filters.radius)))
    )
    .sort((a, b) =>
      filters.sort === 'low' ? a.price - b.price
        : filters.sort === 'high' ? b.price - a.price
          : filters.sort === 'near' ? (a.km ?? Infinity) - (b.km ?? Infinity)
            : String(b.created).localeCompare(String(a.created))
    )
}

// Nombre legible para una búsqueda: «Renta · Departamento · hasta $15,000 · 5 km de Culiacán».
export function describeFilters(f) {
  const parts = []
  parts.push(f.operation === 'venta' ? 'Compra' : f.operation === 'renta' ? 'Renta' : 'Compra o renta')
  if (f.type) parts.push(f.type)
  if (f.rooms) parts.push(`${f.rooms}+ rec.`)
  if (f.max) parts.push(`hasta ${money(Number(f.max))}`)
  if (f.query) parts.push(`«${f.query}»`)
  if (f.radius) parts.push(`${f.radius} km de ${f.city === 'Mi ubicación' ? 'mi ubicación' : f.city || 'el mapa'}`)
  return parts.join(' · ').slice(0, 60)
}

// Clasificación de visitas usada por los filtros del panel.
export const appointmentGroups = [
  ['todas', 'Todas', () => true],
  ['pendientes', 'Pendientes', a => ['Pendiente', 'Propuesta'].includes(a.status)],
  ['confirmadas', 'Confirmadas', a => a.status === 'Aceptada'],
  ['rechazadas', 'Rechazadas', a => a.status === 'Rechazada'],
  ['canceladas', 'Canceladas / vencidas', a => ['Cancelada', 'Vencida'].includes(a.status)]
]
export const inAppointmentGroup = (group, a) => (appointmentGroups.find(g => g[0] === group)?.[2] || (() => true))(a)
