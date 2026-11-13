import { useMemo, useState } from 'react'
import { distanceKm, money } from './lib'
import { applyFilters, validPoint } from './search'

/* ------------------------------------------------------------------ */
/* Precio por m² y comparación con la zona                             */
/* ------------------------------------------------------------------ */

export const pricePerM2 = p => {
  const price = Number(p?.price), area = Number(p?.area)
  return price > 0 && area > 0 ? price / area : null
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Compara contra anuncios activos de la misma operación y tipo, a 15 km o menos.
// Se usa la mediana (no el promedio) para que un anuncio extremo no distorsione el resultado.
// Con menos de 3 comparables no se emite juicio: sería ruido, no información.
export function zoneComparison(property, properties, radiusKm = 15) {
  const own = pricePerM2(property)
  if (!own) return null
  const peers = properties.filter(p =>
    p.id !== property.id &&
    p.active &&
    p.operation === property.operation &&
    p.type === property.type &&
    pricePerM2(p) &&
    (!validPoint(property) || !validPoint(p) || distanceKm(property, p) <= radiusKm)
  )
  if (peers.length < 3) return { own, peers: peers.length, median: null, diff: null }
  const m = median(peers.map(pricePerM2))
  return { own, peers: peers.length, median: m, diff: (own - m) / m }
}

// Versión rápida para muchas propiedades: calcula todas las etiquetas de una vez.
// Agrupa por cuadrícula de 0.15° (~16 km) y solo compara con las celdas vecinas,
// en lugar de comparar cada propiedad contra todas (miles × miles de cálculos).
export function computeDeals(properties, radiusKm = 15) {
  const CELL = 0.15
  const cellOf = p => `${Math.floor(Number(p.lat) / CELL)}:${Math.floor(Number(p.lng) / CELL)}`
  const groups = new Map()
  for (const p of properties) {
    if (!p.active || !pricePerM2(p) || !validPoint(p)) continue
    const key = `${p.operation}|${p.type}|${cellOf(p)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }
  const result = new Map()
  for (const p of properties) {
    if (!p.active || !pricePerM2(p) || !validPoint(p)) continue
    const row = Math.floor(Number(p.lat) / CELL), col = Math.floor(Number(p.lng) / CELL)
    const peers = []
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (const q of groups.get(`${p.operation}|${p.type}|${row + dr}:${col + dc}`) || []) {
          if (q.id !== p.id && distanceKm(p, q) <= radiusKm) peers.push(pricePerM2(q))
        }
      }
    }
    if (peers.length < 3) continue
    const m = median(peers)
    const label = dealLabel({ diff: (pricePerM2(p) - m) / m })
    if (label) result.set(p.id, label)
  }
  return result
}

export function dealLabel(comparison) {
  if (!comparison || comparison.diff === null) return null
  if (comparison.diff <= -0.1) return { tone: 'good', text: 'Buen precio' }
  if (comparison.diff >= 0.15) return { tone: 'high', text: 'Sobre la zona' }
  return null
}

export function PriceInsight({ property, properties }) {
  const c = zoneComparison(property, properties)
  if (!c) return null
  const unit = property.operation === 'renta' ? '/m² al mes' : '/m²'
  const pct = c.diff === null ? null : Math.round(Math.abs(c.diff) * 100)
  // Escala visual: −40 % a +40 % alrededor de la mediana.
  const position = c.diff === null ? 50 : Math.min(100, Math.max(0, 50 + c.diff * 125))
  return (
    <div className="insight-card">
      <div className="insight-row">
        <div>
          <span className="insight-label">Precio por metro cuadrado</span>
          <strong>{money(c.own)}<small> {unit}</small></strong>
        </div>
        {c.diff !== null && (
          <span className={`insight-chip ${c.diff <= -0.08 ? 'good' : c.diff >= 0.08 ? 'high' : ''}`}>
            {pct <= 3 ? 'En línea con la zona' : `${pct}% ${c.diff < 0 ? 'debajo' : 'arriba'} de la zona`}
          </span>
        )}
      </div>
      {c.diff !== null ? (
        <>
          <div className="insight-scale" aria-hidden="true">
            <span className="insight-median" />
            <span className="insight-marker" style={{ left: `${position}%` }} />
          </div>
          <div className="insight-scale-labels" aria-hidden="true"><span>Más accesible</span><span>Mediana {money(c.median)}</span><span>Más alto</span></div>
          <p className="insight-note">Comparado con {c.peers} {property.type.toLowerCase()}s en {property.operation} a 15 km o menos. Referencia orientativa basada en anuncios publicados, no es un avalúo.</p>
        </>
      ) : (
        <p className="insight-note">Aún no hay suficientes anuncios parecidos cerca para comparar el precio con la zona.</p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Calculadora de pagos                                                */
/* ------------------------------------------------------------------ */

export function monthlyPayment(principal, annualRate, years) {
  const n = years * 12, r = annualRate / 100 / 12
  if (principal <= 0) return 0
  if (r === 0) return principal / n
  return principal * r / (1 - (1 + r) ** -n)
}

function Slider({ label, value, display, ...props }) {
  return (
    <label className="calc-slider">
      <span><span>{label}</span><b>{display ?? value}</b></span>
      <input type="range" value={value} {...props} />
    </label>
  )
}

export function PaymentCalculator({ property }) {
  const [down, setDown] = useState(20)
  const [years, setYears] = useState(20)
  const [rate, setRate] = useState(10.5)
  const [deposit, setDeposit] = useState(1)
  const price = Number(property.price)

  if (property.operation === 'renta') {
    const moveIn = price * (deposit + 1)
    return (
      <details className="calculator">
        <summary>¿Cuánto necesitas para mudarte?</summary>
        <Slider label="Meses de depósito" min="0" max="3" step="1" value={deposit} display={deposit} onChange={e => setDeposit(Number(e.target.value))} />
        <div className="calc-result">
          <div><span>Para entrar</span><strong>{money(moveIn)}</strong><small>Depósito + primer mes</small></div>
          <div><span>Ingreso sugerido</span><strong>{money(price * 3)}</strong><small>Renta ≈ ⅓ del ingreso mensual</small></div>
        </div>
        <p className="insight-note">Estimación general. Las condiciones reales las define cada arrendador.</p>
      </details>
    )
  }

  const loan = price * (1 - down / 100)
  const monthly = monthlyPayment(loan, rate, years)
  const total = monthly * years * 12
  return (
    <details className="calculator">
      <summary>¿Cuánto pagarías al mes?</summary>
      <Slider label="Enganche" min="5" max="60" step="5" value={down} display={`${down}% · ${money(price * down / 100)}`} onChange={e => setDown(Number(e.target.value))} />
      <Slider label="Plazo" min="5" max="30" step="5" value={years} display={`${years} años`} onChange={e => setYears(Number(e.target.value))} />
      <Slider label="Tasa anual" min="6" max="16" step="0.25" value={rate} display={`${rate.toFixed(2)}%`} onChange={e => setRate(Number(e.target.value))} />
      <div className="calc-result">
        <div><span>Mensualidad</span><strong>{money(monthly)}</strong><small>Crédito de {money(loan)}</small></div>
        <div><span>Ingreso sugerido</span><strong>{money(monthly / 0.3)}</strong><small>Pago ≤ 30% del ingreso</small></div>
      </div>
      <p className="insight-note">Pagarías {money(total)} en total ({money(total - loan)} de intereses). Cálculo con pago fijo; no incluye seguros, comisiones ni gastos notariales y no es una oferta de crédito.</p>
    </details>
  )
}

/* ------------------------------------------------------------------ */
/* Comparador de favoritos                                             */
/* ------------------------------------------------------------------ */

export function CompareFavorites({ properties, all, onOpen }) {
  const [picked, setPicked] = useState(() => properties.slice(0, 3).map(p => p.id))
  const chosen = properties.filter(p => picked.includes(p.id))
  if (properties.length < 2) return null

  const toggle = id => setPicked(list =>
    list.includes(id) ? list.filter(x => x !== id) : list.length >= 3 ? [...list.slice(1), id] : [...list, id]
  )
  // Cada fila declara cómo leer el dato y si «mejor» significa menor o mayor.
  const rows = [
    ['Precio', p => Number(p.price), v => money(v), 'min'],
    ['Precio por m²', pricePerM2, v => v ? money(v) : '—', 'min'],
    ['Superficie', p => Number(p.area), v => `${v} m²`, 'max'],
    ['Recámaras', p => Number(p.bedrooms), v => v, 'max'],
    ['Baños', p => Number(p.bathrooms), v => v, 'max'],
    ['Frente a la zona', p => zoneComparison(p, all)?.diff ?? null, v => v === null ? 'Sin datos' : `${v < 0 ? '−' : '+'}${Math.round(Math.abs(v) * 100)}%`, 'min'],
    ['Vendedor verificado', p => p.sellerVerified ? 1 : 0, v => v ? '✓ Sí' : 'No', 'max'],
    ['Calificación del vendedor', p => p.sellerRating?.avg ?? null, v => v === null ? 'Sin calificaciones' : `★ ${Number(v).toFixed(1)}`, 'max']
  ]
  const sameOperation = new Set(chosen.map(p => p.operation)).size === 1

  return (
    <section className="compare">
      <div className="compare-heading">
        <div>
          <h2>Compara lado a lado</h2>
          <p>Elige hasta tres favoritos. Resaltamos el mejor valor de cada fila.</p>
        </div>
      </div>
      <div className="compare-picker" role="group" aria-label="Propiedades para comparar">
        {properties.map(p => (
          <button key={p.id} type="button" aria-pressed={picked.includes(p.id)} className={picked.includes(p.id) ? 'selected' : ''} onClick={() => toggle(p.id)}>
            <img src={p.images?.[0]} alt="" />{p.title}
          </button>
        ))}
      </div>
      {chosen.length >= 2 && (
        <div className="compare-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Característica</span></th>
                {chosen.map(p => (
                  <th scope="col" key={p.id}>
                    <button type="button" onClick={() => onOpen(p)}>
                      <img src={p.images?.[0]} alt="" />
                      <span>{p.title}</span>
                      <small>{p.operation === 'venta' ? 'Venta' : 'Renta'} · {p.location}</small>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, read, format, better]) => {
                const values = chosen.map(read)
                const valid = values.filter(v => v !== null && Number.isFinite(v))
                // Comparar precios de venta contra renta no tiene sentido: no se resalta.
                const comparable = !['Precio', 'Precio por m²'].includes(label) || sameOperation
                const best = comparable && valid.length > 1 && new Set(valid).size > 1 ? (better === 'min' ? Math.min(...valid) : Math.max(...valid)) : null
                return (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {chosen.map((p, i) => <td key={p.id} className={values[i] === best ? 'best' : ''}>{format(values[i])}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!sameOperation && <p className="insight-note">Estás comparando venta con renta: los precios no se resaltan entre sí.</p>}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Búsquedas guardadas                                                 */
/* ------------------------------------------------------------------ */

export function SavedSearches({ user, searches, properties, centerFor, onApply, onDelete, onLogin, busy }) {
  const items = useMemo(() => searches.map(s => {
    const matches = applyFilters(properties, s.filters, centerFor(s.filters))
    const fresh = matches.filter(p => String(p.created) > s.lastSeen)
    return { ...s, total: matches.length, fresh: fresh.length }
  }), [searches, properties, centerFor])

  return (
    <div className="casafast-discover-action saved-searches">
      <span className="casafast-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg></span>
      <strong>Búsquedas guardadas</strong>
      {!user ? (
        <>
          <span>Guarda tus filtros y te avisamos aquí cuando aparezcan propiedades nuevas que coincidan.</span>
          <button type="button" className="text-button" onClick={onLogin}>Inicia sesión para empezar ↗</button>
        </>
      ) : items.length === 0 ? (
        <span>Ajusta los filtros del mapa y pulsa «Guardar búsqueda». Aquí verás cuántas propiedades nuevas aparecen desde tu última visita.</span>
      ) : (
        <ul>
          {items.map(s => (
            <li key={s.id}>
              <button type="button" className="saved-search-open" onClick={() => onApply(s)} disabled={busy}>
                <span>{s.name}</span>
                <small>{s.total} {s.total === 1 ? 'coincidencia' : 'coincidencias'}</small>
                {s.fresh > 0 && <em>{s.fresh} {s.fresh === 1 ? 'nueva' : 'nuevas'}</em>}
              </button>
              <button type="button" className="saved-search-delete" aria-label={`Eliminar búsqueda ${s.name}`} onClick={() => onDelete(s)} disabled={busy}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Compartir                                                           */
/* ------------------------------------------------------------------ */

export function ShareButton({ property, onNotice }) {
  async function share() {
    const url = `${window.location.origin}${window.location.pathname}?propiedad=${encodeURIComponent(property.id)}`
    const data = { title: property.title, text: `${property.title} · ${money(property.price)} en CasaFast`, url }
    try {
      if (navigator.share) { await navigator.share(data); return }
      await navigator.clipboard.writeText(url)
      onNotice('Enlace copiado. Pégalo donde quieras compartirlo.')
    } catch (e) {
      if (e?.name !== 'AbortError') onNotice(`Copia este enlace: ${url}`)
    }
  }
  return (
    <button type="button" className="secondary" onClick={share}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" /></svg>
      Compartir
    </button>
  )
}
