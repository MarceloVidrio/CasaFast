import { useMemo, useState } from 'react'
import { money, normalized } from './lib'
import { pricePerM2 } from './Insights'
import './Explore.css'

const median = values => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
// Ciudades con mayor demanda de vivienda en México (orden de preferencia para mostrar).
const POPULAR = ['Monterrey', 'Guadalajara', 'Benito Juárez', 'Miguel Hidalgo', 'Coyoacán', 'Santiago de Querétaro', 'Mérida', 'Cancún', 'Puebla', 'Tijuana', 'León', 'Playa del Carmen', 'Mazatlán', 'Hermosillo', 'Chihuahua', 'Saltillo']
const compact = n => n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} M` : n >= 1e3 ? `$${Math.round(n / 1e3)} mil` : money(n)
// «Colonia, Ciudad, Estado» → { city, state }
const placeOf = location => {
  const parts = String(location || '').split(',').map(s => s.trim()).filter(Boolean)
  return parts.length >= 2 ? { city: parts[parts.length - 2], state: parts[parts.length - 1] } : null
}

/* ------------------------------------------------------------------ */
/* ¿A dónde te quieres mudar? — ciudades con más opciones              */
/* ------------------------------------------------------------------ */

export function CityExplorer({ properties, onPick, home = 'Culiacán' }) {
  const [query, setQuery] = useState('')
  const all = useMemo(() => {
    const groups = new Map()
    for (const p of properties) {
      if (!p.active) continue
      const place = placeOf(p.location)
      if (!place) continue
      const key = `${place.city}|${place.state}`
      if (!groups.has(key)) groups.set(key, { ...place, items: [] })
      groups.get(key).items.push(p)
    }
    return [...groups.values()].map(g => {
      const homes = g.items.filter(p => p.type !== 'Terreno')
      const geo = g.items.filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
      const newest = [...g.items].sort((a, b) => String(b.created).localeCompare(String(a.created)))
      return {
        ...g,
        total: g.items.length,
        sale: g.items.filter(p => p.operation === 'venta').length,
        rent: g.items.filter(p => p.operation === 'renta').length,
        saleMedian: median(homes.filter(p => p.operation === 'venta').map(p => Number(p.price))),
        rentMedian: median(homes.filter(p => p.operation === 'renta').map(p => Number(p.price))),
        image: newest.find(p => p.images?.length)?.images[0],
        lat: geo.reduce((s, p) => s + Number(p.lat), 0) / (geo.length || 1),
        lng: geo.reduce((s, p) => s + Number(p.lng), 0) / (geo.length || 1),
        hasGeo: geo.length > 0
      }
    }).filter(c => c.hasGeo).sort((a, b) => b.total - a.total || a.city.localeCompare(b.city))
  }, [properties])

  // Sin búsqueda: tu ciudad primero y luego la ciudad con más anuncios de cada estado (una por estado).
  // Con búsqueda: cualquier ciudad o estado que coincida.
  const cities = useMemo(() => {
    const q = normalized(query.trim())
    if (q) return all.filter(c => normalized(`${c.city} ${c.state}`).includes(q)).slice(0, 8)
    const seen = new Set(), list = []
    const add = c => { if (c && !seen.has(c.state)) { seen.add(c.state); list.push(c) } }
    add(all.find(c => c.city === home))
    // Después, las zonas metropolitanas más buscadas del país (si tienen anuncios) y luego el resto por número de anuncios.
    for (const name of POPULAR) add(all.find(c => c.city === name))
    for (const c of all) add(c)
    return list.slice(0, 8)
  }, [all, query, home])

  if (!all.length) return null
  return (
    <section className="ex-cities" aria-labelledby="ex-cities-title">
      <div className="ex-head">
        <div>
          <span className="ex-eyebrow">EXPLORA MÉXICO</span>
          <h2 id="ex-cities-title">¿A dónde te quieres mudar?</h2>
          <p>{all.length} ciudades con propiedades en CasaFast. Elige una y el mapa te lleva directo.</p>
        </div>
        <label className="ex-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Busca una ciudad o estado" aria-label="Buscar ciudad o estado" />
        </label>
      </div>
      {!cities.length && <p className="ex-empty">No encontramos «{query}». Prueba con otra ciudad o con el nombre del estado.</p>}
      <div className="ex-grid">
        {cities.map(c => (
          <button key={`${c.city}|${c.state}`} type="button" className="ex-city" onClick={() => onPick(c)}>
            <span className="ex-photo" style={c.image ? { backgroundImage: `url(${c.image})` } : undefined}>
              <span className="ex-count">{c.total} {c.total === 1 ? 'propiedad' : 'propiedades'}</span>
            </span>
            <span className="ex-body">
              <strong>{c.city}</strong>
              <small>{c.state}</small>
              <span className="ex-prices">
                <span><em>Venta</em>{c.saleMedian ? compact(c.saleMedian) : '—'}<i>{c.sale}</i></span>
                <span><em>Renta</em>{c.rentMedian ? `${compact(c.rentMedian)}/mes` : '—'}<i>{c.rent}</i></span>
              </span>
              <span className="ex-go">Ver en el mapa →</span>
            </span>
          </button>
        ))}
      </div>
      <p className="ex-note">Precios típicos (mediana) de casas y departamentos publicados. El número pequeño indica cuántos anuncios hay de cada tipo.</p>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Precios de referencia de la búsqueda actual (venta y renta por separado) */
/* ------------------------------------------------------------------ */

export function MarketSnapshot({ shown, onOpen }) {
  const data = useMemo(() => {
    const homes = shown.filter(p => p.type !== 'Terreno' && Number(p.price) > 0)
    const block = op => {
      const list = homes.filter(p => p.operation === op)
      const cheapest = [...list].sort((a, b) => a.price - b.price)[0]
      return { count: list.length, median: median(list.map(p => Number(p.price))), m2: median(list.map(pricePerM2).filter(Boolean)), cheapest }
    }
    return { sale: block('venta'), rent: block('renta'), land: shown.filter(p => p.type === 'Terreno').length }
  }, [shown])

  const card = (title, b, unit) => (
    <div className="ex-market-card">
      <div className="ex-market-top"><span>{title}</span><small>{b.count.toLocaleString('es-MX')} {b.count === 1 ? 'anuncio' : 'anuncios'}</small></div>
      {b.count ? (
        <>
          <strong>{money(b.median)}<small>{unit}</small></strong>
          <span className="ex-sub">Precio típico · {b.m2 ? `${money(b.m2)}/m²${unit}` : 'sin superficie'}</span>
          {b.cheapest && (
            <button type="button" className="ex-cheapest" onClick={() => onOpen(b.cheapest)}>
              <span>Lo más accesible</span>
              <b>{b.cheapest.title}</b>
              <em>{money(b.cheapest.price)}{unit}</em>
            </button>
          )}
        </>
      ) : <p className="ex-sub">No hay anuncios con estos filtros.</p>}
    </div>
  )

  return (
    <section className="ex-market" aria-labelledby="ex-market-title">
      <div className="ex-head">
        <div>
          <span className="ex-eyebrow">TU BÚSQUEDA</span>
          <h2 id="ex-market-title">Precios de referencia</h2>
          <p>Calculados con los {shown.length.toLocaleString('es-MX')} anuncios que coinciden con tus filtros. Venta y renta por separado, para que la cifra sí te sirva.</p>
        </div>
      </div>
      <div className="ex-market-grid">
        {card('Comprar', data.sale, '')}
        {card('Rentar', data.rent, ' /mes')}
      </div>
      {data.land > 0 && <p className="ex-note">También hay {data.land.toLocaleString('es-MX')} {data.land === 1 ? 'terreno' : 'terrenos'} en esta búsqueda (no se incluyen en estos precios).</p>}
    </section>
  )
}
