import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, money, cities } from './lib'
import { PropertyForm } from './Forms'
import { AppointmentBooking, AvailabilityEditor, VisitCard } from './VisitFlow'
import { AuthForm, readEmailAction } from './AuthScreens'
import PropertySearchMap from './PropertySearchMap'
import { emptyFilters, validPoint, applyFilters, describeFilters, appointmentGroups, inAppointmentGroup } from './search'
import { SellerStats, SellerListings, VacationCard, BlockedTimesCard } from './SellerPanel'
import AdminPanel from './AdminPanel'
import { CityExplorer, MarketSnapshot } from './Explore'
import { PriceInsight, PaymentCalculator, CompareFavorites, SavedSearches, ShareButton, computeDeals } from './Insights'
import { SellerTrust, ReportButton, useViewTracking } from './Trust'
import './CasaFast.css'
import './Insights.css'

// Enlace directo a una propiedad: /?propiedad=<id>
// La lista junto al mapa dibuja las tarjetas por bloques para no crear miles de golpe.
const PAGE = 30

const linkedPropertyId = () => new URLSearchParams(window.location.search).get('propiedad')
// Enlace directo a una cita (botón «Ver mi cita» del correo): /?cita=<id>
const linkedAppointmentId = () => new URLSearchParams(window.location.search).get('cita')
// Panel de administración oculto: no hay enlaces; se abre con /?admin y solo para administradores.
const wantsAdmin = () => new URLSearchParams(window.location.search).has('admin')
const urlFor = (id, cita = null) => {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('propiedad', id)
  else url.searchParams.delete('propiedad')
  if (cita) url.searchParams.set('cita', cita)
  else url.searchParams.delete('cita')
  return url.pathname + url.search
}

function Icon({ name, ...props }) {
  const paths = {
    home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
    pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    bed: 'M3 19V6m18 13V9H3m0 7h18M7 9V6h6v3',
    area: 'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6',
    bath: 'M4 13h16v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Zm1 0V5a3 3 0 0 1 6 0',
    bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0'
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.home} />
    </svg>
  )
}

function Features({ p }) {
  return (
    <div className="features">
      {!(p.type === 'Terreno' && !Number(p.bedrooms)) && <span><Icon name="bed" />{p.bedrooms} rec.</span>}
      {!(p.type === 'Terreno' && !Number(p.bathrooms)) && <span><Icon name="bath" />{p.bathrooms} baños</span>}
      <span><Icon name="area" />{p.area} m²</span>
    </div>
  )
}

function Card({ p, onOpen, onFavorite, saved, deal }) {
  return (
    <article className="property-card-new">
      <div className="card-image">
        <button
          className="image-link"
          onClick={() => onOpen(p)}
          aria-label={`Ver ${p.title}`}
        >
          <img src={p.images?.[0]} alt={p.title} loading="lazy" />
        </button>
        <span className="pill">
          {p.operation === 'venta' ? 'En venta' : 'En renta'}
        </span>
        <button
          className={`favorite ${saved ? 'saved' : ''}`}
          aria-label={`${saved ? 'Quitar de' : 'Guardar en'} favoritos: ${p.title}`}
          aria-pressed={saved}
          onClick={() => onFavorite(p)}
        >
          <Icon name="heart" />
        </button>
        {p.demo && <span className="demo-label">Ejemplo</span>}
        {deal && <span className={`deal-label ${deal.tone}`} title="Precio por m² comparado con anuncios parecidos cercanos">{deal.text}</span>}
      </div>

      <div className="card-info">
        <p className="card-type">
          {p.type}
          {p.km !== undefined && (
            <span> · {p.km.toFixed(1)} km</span>
          )}
        </p>
        <button className="card-title" onClick={() => onOpen(p)}>
          {p.title}
        </button>
        <p className="location"><Icon name="pin" />{p.location}</p>
        <SellerTrust p={p} compact />
        <Features p={p} />
        <div className="card-bottom">
          <strong>
            {money(p.price)}
            <small>{p.operation === 'renta' ? '/ mes' : 'MXN'}</small>
          </strong>
          <button onClick={() => onOpen(p)} aria-label={`Abrir ${p.title}`}>
            ↗
          </button>
        </div>
      </div>
    </article>
  )
}

function Empty({ title, children }) {
  return (
    <div className="empty">
      <Icon name="home" width="40" height="40" />
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export default function CasaFast() {
  const [emailAction, setEmailAction] = useState(readEmailAction)
  const [user, setUser] = useState(null)
  const [properties, setProperties] = useState([])
  const [favorites, setFavorites] = useState([])
  const [appointments, setAppointments] = useState([])
  const [view, setView] = useState(emailAction.mode)
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [availabilityProperty, setAvailabilityProperty] = useState(null)
  const [returnToProperty, setReturnToProperty] = useState(false)
  const [appointmentFilter, setAppointmentFilter] = useState('todas')
  const [filters, setFilters] = useState(emptyFilters)
  const [geo, setGeo] = useState(null)
  const [advanced, setAdvanced] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [photo, setPhoto] = useState(0)
  const [busy, setBusy] = useState(false)

  // Nuevos estados del mapa
  const [mapVisible, setMapVisible] = useState(false)
  const [mapCenter, setMapCenter] = useState(null)
  const [searches, setSearches] = useState([])
  const [focusAppointment, setFocusAppointment] = useState(linkedAppointmentId)
  const [resultsAtEnd, setResultsAtEnd] = useState(false)
  const [listLimit, setListLimit] = useState(PAGE)
  const resultsRef = useRef(null)

  // Copia siempre actual de las propiedades para los manejadores de historial.
  const propertiesRef = useRef(properties)
  propertiesRef.current = properties

  useEffect(() => {
    const clear = () => {
      if (window.location.hash) {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search
        )
      }
    }

    clear()

    const follow = () => {
      const action = readEmailAction()
      if (action.mode !== 'home') {
        setEmailAction(action)
        setView(action.mode)
        clear()
      }
    }

    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])

  useEffect(() => {
  const handleBackForward = event => {
    if (event.state?.appointmentId) setFocusAppointment(event.state.appointmentId)
    const id = event.state?.propertyId || linkedPropertyId()
    const linked = id && propertiesRef.current.find(p => p.id === id)
    const nextView = event.state?.casafastView || (linked ? 'detail' : 'home')

    if (linked) {
      setSelected(linked)
      setPhoto(0)
    }
    setView(nextView === 'detail' && !linked ? 'home' : nextView)
    setError('')
    setNotice('')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  window.addEventListener('popstate', handleBackForward)

  return () => {
    window.removeEventListener('popstate', handleBackForward)
  }
}, [])

  async function refresh(account = user) {
    const p = await api('properties')
    setProperties(p)

    if (account) {
      const [f, a, s] = await Promise.all([
        api('favorites'),
        api('appointments'),
        api('searches')
      ])
      setFavorites(f)
      setAppointments(a)
      setSearches(s)
    } else {
      setFavorites([])
      setAppointments([])
      setSearches([])
    }
    return p
  }

  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        const account = await api('session')
        if (!alive) return
        setUser(account)
        const list = await refresh(account)
        if (!alive) return
        // Abrir directamente una cita desde el correo.
        if (wantsAdmin()) {
          if (account?.role === 'admin') setView('admin')
          else if (account) window.history.replaceState(null, '', window.location.pathname)
          else setView('login')
        }
        // Botón «Ir a mis publicaciones» de los correos: /?panel abre Mi espacio.
        if (new URLSearchParams(window.location.search).has('panel')) {
          window.history.replaceState(null, '', window.location.pathname)
          setView(account ? 'dashboard' : 'login')
        }
        const cita = linkedAppointmentId()
        if (cita) {
          setFocusAppointment(cita)
          setView(account ? 'appointment' : 'login')
          window.history.replaceState({ casafastView: account ? 'appointment' : 'login', appointmentId: cita }, '', urlFor(null, cita))
        }
        // Abrir directamente una propiedad compartida por enlace.
        const id = cita ? null : linkedPropertyId()
        if (id) {
          const linked = list.find(p => p.id === id && (p.active || p.sellerId === account?.id))
          if (linked) {
            setSelected(linked)
            setView('detail')
            window.history.replaceState({ casafastView: 'detail', propertyId: id }, '', urlFor(id))
          } else {
            window.history.replaceState(null, '', urlFor(null))
            setError('Esa propiedad ya no está disponible. Te mostramos otras opciones.')
          }
        }
      } catch (e) {
        if (alive) setError(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => { alive = false }
  }, [])

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        refresh().catch(e => setError(e.message))
      }
    }

    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [user])

  function go(next, propertyId = null) {
    const cita = next === 'appointment' ? focusAppointment : null
    if (next !== view || propertyId !== (selected?.id ?? null)) {
      window.history.pushState({ casafastView: next, propertyId, appointmentId: cita }, '', urlFor(propertyId, cita))
    }

    setView(next)
    setError('')
    setNotice('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function act(fn, message, account = user) {
    setError('')
    setBusy(true)
    try {
      await fn()
      await refresh(account)
      if (message) setNotice(message)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  useViewTracking(selected?.id, view === 'detail')

  function open(p) {
    setSelected(p)
    setPhoto(0)
    go('detail', p.id)
  }

  // Galería: flechas del teclado en el detalle.
  useEffect(() => {
    if (view !== 'detail' || !(selected?.images?.length > 1)) return
    const total = selected.images.length
    const onKey = e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'ArrowRight') setPhoto(i => (i + 1) % total)
      if (e.key === 'ArrowLeft') setPhoto(i => (i - 1 + total) % total)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, selected])

  async function favorite(p) {
    if (!user) {
      go('login')
      return
    }

    await act(() =>
      api('favorites', 'POST', {
        id: p.id,
        saved: !favorites.includes(p.id)
      })
    )
  }

  async function publish() {
    if (!user) {
      go('register')
      return
    }

    if (user.role === 'comprador') {
      try {
        const account = await api('account/publishing', 'POST', {})
        setUser(account)
        await refresh(account)
      } catch (e) { setError(e.message); return }
    }

    setEditing(null)
    go('editor')
  }

  
  function location() {
    if (!navigator.geolocation) {
      setError('Tu navegador no permite obtener tu ubicación.')
      return
    }

    setError('')
    setNotice('Obteniendo tu ubicación actual...')

    navigator.geolocation.getCurrentPosition(
      position => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        const accuracy = position.coords.accuracy

        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          !Number.isFinite(accuracy)
        ) {
          setNotice('')
          setError('El navegador devolvió una ubicación inválida.')
          return
        }

        if (accuracy > 1000) {
          setNotice('')
          setError(
            `La ubicación es demasiado aproximada (${Math.round(accuracy)} metros). Inténtalo nuevamente.`
          )
          return
        }

        const newCenter = { lat, lng }

        setGeo(newCenter)
        setMapCenter(newCenter)

        setFilters(f => ({
          ...f,
          city: 'Mi ubicación',
          radius: f.radius || '10'
        }))

        setNotice(
          `Mapa centrado en tu ubicación. Precisión estimada: ${Math.round(accuracy)} metros.`
        )
      },
      error => {
        setNotice('')

        if (error.code === 1) {
          setError('Permite el acceso a tu ubicación en Chrome.')
        } else if (error.code === 2) {
          setError('No se pudo determinar tu ubicación.')
        } else {
          setError('La ubicación tardó demasiado. Inténtalo nuevamente.')
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    )
  }

  // Centro compartido entre mapa y catálogo
  const center = mapCenter || (
    filters.city === 'Mi ubicación'
      ? geo
      : cities[filters.city]
  )

  const shown = useMemo(() => applyFilters(properties, filters, center), [properties, filters, center])
  // Etiquetas «Buen precio» / «Sobre la zona»: se calculan una vez por cambio de catálogo.
  const deals = useMemo(() => computeDeals(properties), [properties])

  // Al cambiar los filtros, la lista vuelve a mostrar las primeras 3 propiedades.
  useEffect(() => {
    resultsRef.current?.scrollTo({ top: 0 })
    setResultsAtEnd(false)
    setListLimit(PAGE)
  }, [filters, mapCenter])

  // La lista mide exactamente 3 tarjetas; el resto se ve deslizando.
  // Se recalcula si cambia el ancho de la pantalla o la cantidad de resultados.
  useEffect(() => {
    const el = resultsRef.current
    if (!el) return
    const fit = () => {
      const cards = el.querySelectorAll('.property-card-new')
      if (cards.length <= 3) { el.style.height = 'auto'; return }
      const third = cards[2]
      el.style.height = `${third.offsetTop + third.offsetHeight + 2}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    el.querySelectorAll('.property-card-new').forEach(card => observer.observe(card))
    return () => observer.disconnect()
  }, [view, shown.length, loading])

  // Centro que corresponde a unos filtros guardados (para contar coincidencias).
  const centerFor = useCallback(
    f => f.center || (f.city === 'Mi ubicación' ? geo : cities[f.city]),
    [geo]
  )

  // Elegir una ciudad en «¿A dónde te quieres mudar?»: centra el mapa ahí con radio de 15 km.
  function pickCity(c) {
    setMapCenter({ lat: c.lat, lng: c.lng })
    setFilters(f => ({ ...f, radius: '15', query: '', sort: 'new' }))
    setNotice(`Mostrando propiedades a 15 km de ${c.city}, ${c.state}. Ajusta el radio o los filtros cuando quieras.`)
    document.querySelector('.casafast-explore')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function saveSearch() {
    if (!user) { go('login'); return }
    const saved = { ...filters, center: mapCenter || (filters.city === 'Mi ubicación' ? geo : null) }
    await act(() => api('searches', 'POST', { name: describeFilters(filters), filters: saved }), 'Búsqueda guardada. Verás aquí abajo cuando aparezcan propiedades nuevas.')
  }

  async function applySearch(search) {
    const { center: savedCenter, ...rest } = search.filters
    setFilters({ ...emptyFilters, ...rest })
    setMapCenter(validPoint(savedCenter) ? savedCenter : null)
    if (rest.max || rest.rooms) setAdvanced(true)
    await act(() => api(`searches/${search.id}/seen`, 'POST', {}), `Mostrando «${search.name}».`)
    document.querySelector('.casafast-explore')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function deleteSearch(search) {
    act(() => api(`searches/${search.id}`, 'DELETE', {}), 'Búsqueda eliminada.')
  }

  const own = properties.filter(p => p.sellerId === user?.id)
  const savedProperties = properties.filter(
    p => p.active && favorites.includes(p.id)
  )

  function change(key, value) {
    if (key === 'city') setMapCenter(null)
    setFilters(f => ({ ...f, [key]: value }))
  }

  function changeMapCenter(point) {
    if (validPoint(point)) {
      setMapCenter({
        lat: Number(point.lat),
        lng: Number(point.lng)
      })
    }
  }

  function resetFilters() {
    setFilters(emptyFilters)
    setMapCenter(null)
  }

  const catalog = list => (
    <div className="property-grid">
      {list.map(p => (
        <Card
          key={p.id}
          p={p}
          deal={deals.get(p.id)}
          saved={favorites.includes(p.id)}
          onOpen={open}
          onFavorite={favorite}
        />
      ))}
    </div>
  )


  if (view === 'admin' && user?.role === 'admin') {
    return <AdminPanel user={user} onExit={() => { window.history.replaceState(null, '', window.location.pathname); setView('dashboard') }} />
  }

  return (
    <>
      <header className="header">
        <button className="brand" onClick={() => go('home')}>
          <span className="brand-icon"><Icon name="home" /></span>
          casa<span>fast</span><i />
        </button>

        

        <div className="header-actions">
          {user ? (
            <>
              <button className="account" onClick={() => go('dashboard')}>
                <span>{user.name.slice(0, 1).toUpperCase()}</span>
                {' '}Mi espacio
              </button>
              <button
                className="text-button"
                onClick={() => act(async () => {
                  await api('logout', 'POST', {})
                  setUser(null)
                  setFavorites([])
                  setAppointments([])
                  go('home')
                }, 'Sesión cerrada.', null)}
              >
                Salir
              </button>
            </>
          ) : (
            <button className="text-button" onClick={() => go('login')}>
              Iniciar sesión
            </button>
          )}
          <button className="primary compact" onClick={publish}>
            Publicar <span>＋</span>
          </button>
        </div>
      </header>

      {(error || notice) && (
        <div
          className={`banner ${error ? 'error' : 'success'}`}
          role={error ? 'alert' : 'status'}
        >
          {error || notice}
          <button
            aria-label="Cerrar aviso"
            onClick={() => {
              setError('')
              setNotice('')
            }}
          >
            ×
          </button>
        </div>
      )}

      {loading ? (
        <main className="page">
          <Empty title="Preparando tu próximo hogar…" />
        </main>
      ) : (
        <main>
          {view === 'home' && (
            <>
              <section className="hero-new">
                <div className="hero-copy">
                  <span className="eyebrow">
                    <span className="dot" /> TU HOGAR, MÁS CERCA
                  </span>
                  <h1>
                    El lugar donde<br />
                    empieza <em>lo tuyo.</em>
                  </h1>
                  <p>
                    Compra o renta un espacio que vaya contigo.<br />
                    Explora propiedades, encuentra tu zona y da el siguiente paso.
                  </p>
                  <div className="hero-caption">
                    <span>01 —</span> NUEVOS ESPACIOS, NUEVAS HISTORIAS
                  </div>
                </div>
                <div className="hero-photo">
                  <img
                    src="/images/casa1.jpg"
                    alt="Casa con arquitectura contemporánea"
                  />
                  <div className="photo-note">
                    <Icon name="pin" />
                    <div>
                      Encuentra tu lugar
                      <small>Comienza por la zona que te gusta</small>
                    </div>
                    <span>↗</span>
                  </div>
                </div>
              </section>


<section
  className="page casafast-explore"
  aria-label="Buscar propiedades en el mapa"
>

  <div className="casafast-explore-toolbar">
    <div
      className="casafast-explore-filters"
      aria-label="Filtros de propiedades"
    >
      {[
        ['', 'Todo'],
        ['venta', 'Comprar'],
        ['renta', 'Rentar']
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={
            filters.operation === value ? 'is-selected' : ''
          }
          onClick={() => change('operation', value)}
        >
          {label}
        </button>
      ))}

      <select
        aria-label="Tipo de propiedad"
        value={filters.type}
        onChange={e => change('type', e.target.value)}
      >
        <option value="">Todos los espacios</option>
        <option>Casa</option>
        <option>Departamento</option>
        <option>Terreno</option>
      </select>
    </div>

    <div className="casafast-explore-filters">
      <button type="button" onClick={location}>
        <Icon name="pin" /> Usar mi ubicación
      </button>

      <button type="button" onClick={saveSearch} disabled={busy} title="Guarda estos filtros y te avisamos de propiedades nuevas">
        <Icon name="bell" /> Guardar búsqueda
      </button>

      <button
        type="button"
        onClick={() => setAdvanced(v => !v)}
      >
        {advanced ? '− Ocultar filtros' : '＋ Más filtros'}
      </button>
    </div>
  </div>

  {advanced && (
    <div className="casafast-explore-advanced">
      <label>
        Precio máximo (MXN)
        <input
          type="number"
          min="1"
          value={filters.max}
          onChange={e => change('max', e.target.value)}
          placeholder="Sin máximo"
        />
      </label>

      <label>
        Recámaras
        <select
          value={filters.rooms}
          onChange={e => change('rooms', e.target.value)}
        >
          <option value="">Cualquiera</option>
          {[1, 2, 3, 4].map(n => (
            <option value={n} key={n}>
              {n} o más
            </option>
          ))}
        </select>
      </label>

      <button
        className="text-button"
        type="button"
        onClick={resetFilters}
      >
        Limpiar filtros
      </button>
    </div>
  )}

  
<div className="casafast-map-results">

  {/* MAPA A LA IZQUIERDA */}
  <div className="casafast-map-column">
    <PropertySearchMap
      properties={shown}
      center={center}
      radius={filters.radius}
      onCenterChange={changeMapCenter}
      onRadiusChange={value => change('radius', value)}
      onOpen={open}
    />
  </div>

  {/* PROPIEDADES A LA DERECHA */}
  <aside
    className="casafast-results-column"
    aria-label="Propiedades disponibles"
  >
    <div className="casafast-results-heading">
      <div>
        <h3>Propiedades disponibles</h3>
        <p>
          {shown.length}{' '}
          {shown.length === 1
            ? 'propiedad encontrada'
            : 'propiedades encontradas'}
        </p>
      </div>

      <label className="casafast-results-sort">
        Ordenar por
        <select
          value={filters.sort}
          onChange={e => change('sort', e.target.value)}
        >
          <option value="new">Más recientes</option>
          <option value="low">Menor precio</option>
          <option value="high">Mayor precio</option>
          <option value="near">Más cercanas</option>
        </select>
      </label>
    </div>

    <div
      ref={resultsRef}
      className={`casafast-results-scroll ${resultsAtEnd || shown.length <= 3 ? 'at-end' : ''}`}
      onScroll={e => {
        const el = e.currentTarget
        const left = el.scrollHeight - el.scrollTop - el.clientHeight
        // Cerca del final: dibuja el siguiente bloque de tarjetas.
        if (left < 600 && listLimit < shown.length) setListLimit(n => n + PAGE)
        setResultsAtEnd(listLimit >= shown.length && left <= 4)
      }}
    >
      {shown.length ? (
        catalog(shown.slice(0, listLimit))
      ) : (
        <Empty title="No encontramos propiedades en esta zona.">
          <p>
            Prueba otra ubicación o amplía el radio de búsqueda.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={resetFilters}
          >
            Restablecer filtros
          </button>
        </Empty>
      )}
    </div>
    {shown.length > 3 && (
      <p className="casafast-results-hint" aria-hidden="true">
        {resultsAtEnd ? 'Llegaste al final de la lista' : `Desliza para ver ${shown.length - 3} más ↓`}
      </p>
    )}
  </aside>
</div>

</section>


              
              
              
{/* EXPLORA MÉXICO · PRECIOS DE REFERENCIA · ATAJOS */}
<section className="page casafast-discover">
  <CityExplorer properties={properties} onPick={pickCity} />
  <MarketSnapshot shown={shown} onOpen={open} />
  {(() => {
    return (
      <>
        <div className="casafast-discover-actions">
          <button
            type="button"
            className="casafast-discover-action"
            onClick={() => go('favorites')}
          >
            <span className="casafast-action-icon">♡</span>
            <strong>Tus favoritos</strong>
            <span>
              Guarda y compara los espacios que más te gusten.
            </span>
            <span className="casafast-action-arrow">↗</span>
          </button>

          <SavedSearches
            user={user}
            searches={searches}
            properties={properties}
            centerFor={centerFor}
            busy={busy}
            onApply={applySearch}
            onDelete={deleteSearch}
            onLogin={() => go('login')}
          />
        </div>
      </>
    )
  })()}
</section>

{/* QUIERO PUBLICAR — SE CONSERVA */}
<section className="seller-cta">
  <div>
    <span className="eyebrow">
      DALE UN NUEVO COMIENZO A TU PROPIEDAD
    </span>
    <h2>
      Tu espacio puede ser<br />
      el próximo hogar de alguien.
    </h2>
    <p>
      Publica, administra tus anuncios y organiza visitas
      desde un solo lugar.
    </p>
  </div>

  <button className="primary" onClick={publish}>
    Quiero publicar <span>↗</span>
  </button>
</section>

            </>
          )}



          {['login', 'register', 'forgot', 'resend', 'verify', 'reset']
            .includes(view) && (
            <AuthForm
              key={view + emailAction.token}
              mode={view}
              token={emailAction.token}
              onNavigate={go}
              onSuccess={async account => {
                setUser(account)
                await refresh(account)
                if (wantsAdmin() && account.role === 'admin') { setView('admin'); return }
                if (wantsAdmin()) window.history.replaceState(null, '', window.location.pathname)
                go(focusAppointment && linkedAppointmentId() ? 'appointment' : returnToProperty && selected ? 'detail' : 'dashboard')
                setReturnToProperty(false)
              }}
            />
          )}

          {view === 'availability' && user && availabilityProperty && <AvailabilityEditor property={availabilityProperty} onClose={() => go('dashboard')} />}

          {view === 'editor' && user && (
            <PropertyForm
              key={editing?.id || 'new'}
              property={editing}
              onCancel={() => go('dashboard')}
              onSave={async result => {
                await refresh()
                go('dashboard')
                const status = result?.review?.status
                setNotice(status === 'pendiente'
                  ? `Tu publicación se envió a revisión. La revisaremos en máximo 24 horas hábiles${result.review.due ? ` (a más tardar el ${new Date(result.review.due).toLocaleString('es-MX', { timeZone: 'America/Mazatlan', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })})` : ''} y te avisaremos por correo.`
                  : 'Tu publicación se guardó correctamente.')
              }}
            />
          )}

          {view === 'appointment' && user && (() => {
            const a = appointments.find(x => x.id === focusAppointment)
            return (
              <section className="page narrow visit-focus">
                <button className="text-button" onClick={() => go('dashboard')}>← Ir a Mi espacio</button>
                <span className="eyebrow">{a && a.sellerId === user.id ? 'SOLICITUD DE VISITA' : 'MI CITA'}</span>
                <h1>{a ? (a.sellerId === user.id ? 'Solicitud de visita' : 'Tu visita') : 'No encontramos esta cita'}</h1>
                {a ? (
                  <>
                    <p>{a.sellerId === user.id ? 'Confirma, solicita un cambio de horario o cancela.' : 'Consulta el estado de tu visita y reprográmala si lo necesitas (con al menos 12 horas de anticipación).'}</p>
                    <VisitCard appointment={a} property={properties.find(p => p.id === a.property_id)} user={user} onRefresh={() => refresh()} />
                  </>
                ) : (
                  <Empty title="Esta cita no está en tu cuenta.">
                    <p>Inicia sesión con la cuenta con la que se solicitó la visita, o revisa todas tus visitas en Mi espacio.</p>
                    <button className="primary" onClick={() => go('dashboard')}>Ver mis visitas</button>
                  </Empty>
                )}
              </section>
            )
          })()}

          {view === 'favorites' && (
            <section className="page">
              <span className="eyebrow">TUS POSIBILIDADES</span>
              <h1>Espacios que te hicieron quedarte.</h1>
              <p>
                Guarda tus favoritos y vuelve a ellos cuando quieras.
              </p>
              {savedProperties.length ? (
                <>
                  <CompareFavorites key={savedProperties.map(p => p.id).join()} properties={savedProperties} all={properties} onOpen={open} />
                  {catalog(savedProperties)}
                </>
              ) : (
                <Empty title="Tu lista empieza con un corazón.">
                  <p>
                    Explora el catálogo y guarda las propiedades que te gusten.
                  </p>
                  <button className="primary" onClick={() => go('home')}>
                    Explorar propiedades
                  </button>
                </Empty>
              )}
            </section>
          )}

          {view === 'detail' && selected && (
            <section className="page">
              {selected.sellerId === user?.id && selected.review && (selected.review.status !== 'aprobada' || selected.review.hold || !selected.active) && (
                <div className="banner owner-review" role="status">
                  {selected.review.hold ? `CasaFast retiró esta publicación: ${selected.review.holdNote || ''}` : !selected.active ? 'Esta publicación está retirada y no aparece en el catálogo.' : selected.review.status === 'pendiente' ? 'Vista previa: tu publicación está en revisión y todavía no aparece en el catálogo.' : `Tu publicación necesita correcciones: ${selected.review.note || ''}`}
                </div>
              )}
              <button
                className="text-button"
                onClick={() => go('home')}
              >
                ← Volver a explorar
              </button>

              <div className="detail-heading">
                <div>
                  <span className="eyebrow">
                    {selected.type} ·{' '}
                    {selected.operation === 'venta'
                      ? 'EN VENTA'
                      : 'EN RENTA'}
                  </span>
                  <h1>{selected.title}</h1>
                  {selected.code && <span className="folio" title="Folio de la publicación">Folio {selected.code}</span>}
                  <p className="location">
                    <Icon name="pin" />{selected.location}
                  </p>
                </div>
                <div className="detail-actions">
                  <ShareButton property={selected} onNotice={setNotice} />
                  <button
                    className={`secondary favorite-toggle ${favorites.includes(selected.id) ? 'saved' : ''}`}
                    aria-pressed={favorites.includes(selected.id)}
                    onClick={() => favorite(selected)}
                  >
                    <Icon name="heart" />
                    {favorites.includes(selected.id)
                      ? 'Guardada'
                      : 'Guardar'}
                  </button>
                </div>
              </div>

              <div className="detail-grid">
                <div>
                  <div className="detail-gallery">
                    <img
                      className="detail-cover"
                      src={selected.images?.[photo]}
                      alt={`${selected.title}, foto ${photo + 1}`}
                    />
                    {selected.images?.length > 1 && (
                      <>
                        <button type="button" className="gallery-nav prev" aria-label="Foto anterior" onClick={() => setPhoto(i => (i - 1 + selected.images.length) % selected.images.length)}>‹</button>
                        <button type="button" className="gallery-nav next" aria-label="Foto siguiente" onClick={() => setPhoto(i => (i + 1) % selected.images.length)}>›</button>
                        <span className="gallery-count" aria-live="polite">{photo + 1} / {selected.images.length}</span>
                      </>
                    )}
                  </div>

                  {selected.images?.length > 1 && (
                    <div className="thumbnails">
                      {selected.images.map((src, i) => (
                        <button
                          className={photo === i ? 'selected' : ''}
                          onClick={() => setPhoto(i)}
                          key={src}
                          aria-label={`Ver foto ${i + 1}`}
                        >
                          <img src={src} alt="" />
                        </button>
                      ))}
                    </div>
                  )}

                  <Features p={selected} />
                  <h2>Un lugar para imaginarte.</h2>
                  <p className="description">{selected.description}</p>
                  <h3>Ubicación</h3>
                  <p>{selected.address} · {selected.location}</p>

                  {validPoint(selected) && (
                    <a
                      className="text-button"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://www.google.com/maps/search/?api=1&query=${selected.lat},${selected.lng}`}
                    >
                      Ver ubicación en Google Maps ↗
                    </a>
                  )}
                </div>

                <aside className="visit-panel">
                  <span className="eyebrow">
                    {selected.operation === 'venta'
                      ? 'PRECIO DE VENTA'
                      : 'RENTA MENSUAL'}
                  </span>
                  <h2>
                    {money(selected.price)} <small>MXN</small>
                  </h2>

                  <SellerTrust p={selected} />
                  <PriceInsight property={selected} properties={properties} />
                  <PaymentCalculator key={selected.id} property={selected} />

                  {selected.demo && selected.sellerId === 'demo' ? (
                    <div className="info-box">
                      <h3>Una muestra de lo que puedes encontrar</h3>
                      <p>
                        Este anuncio de ejemplo todavía no tiene una cuenta
                        responsable, así que no admite visitas.
                      </p>
                    </div>
                  ) : !user ? (
                    <>
                      <p>
                        Inicia sesión para elegir un horario y solicitar tu visita.
                      </p>
                      <button
                        className="primary"
                        onClick={() => { setReturnToProperty(true); go('login') }}
                      >
                        Iniciar sesión
                      </button>
                    </>
                  ) : selected.sellerId !== user.id ? (
                    <>
                    {selected.demo && (
                      <p className="demo-visit-note">Anuncio de ejemplo: puedes agendar una visita de prueba y la recibirá la cuenta responsable de los ejemplos.</p>
                    )}
                    <AppointmentBooking
                      property={selected}
                      onSuccess={async () => {
                        await refresh()
                        go('dashboard')
                        setNotice('Solicitud enviada. Aquí puedes seguir su estado.')
                      }}
                    />
                    </>
                  ) : (
                    <p>
                      Esta es tu publicación. Administra sus horarios desde Mi espacio.
                    </p>
                  )}
                  <ReportButton property={selected} user={user} onNotice={setNotice} onLogin={() => { setReturnToProperty(true); go('login') }} />
                </aside>
              </div>
            </section>
          )}

          {view === 'dashboard' && user && (
            <section className="page">
              {(() => {
                const isSeller = user.role !== 'comprador'
                const myListings = own
                const now = Date.now()
                const asSeller = appointments.filter(a => a.sellerId === user.id)
                const pendingCount = (isSeller ? asSeller : appointments).filter(a => ['Pendiente', 'Propuesta'].includes(a.status)).length
                const upcoming = appointments.filter(a => a.status === 'Aceptada' && Date.parse(a.date) > now)
                const next = [...upcoming].sort((a, b) => a.date.localeCompare(b.date))[0]
                const nextText = next ? new Date(next.date).toLocaleString('es-MX', { timeZone: 'America/Mazatlan', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
                return (
                  <>
                    <div className="sp-hero">
                      <div className="sp-hero-id">
                        <span className="sp-avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
                        <div>
                          <span className="sp-role">{user.role === 'admin' ? 'Administrador' : isSeller ? 'Panel de vendedor' : 'Mi espacio'}</span>
                          <h1>Hola, {user.name.split(' ')[0]}.</h1>
                          <p>{isSeller ? 'Administra tus publicaciones, tu agenda de visitas y tu disponibilidad.' : 'Todos tus siguientes pasos, en un solo lugar.'}</p>
                        </div>
                      </div>
                      <div className="sp-hero-actions">
                        <button type="button" className="secondary" onClick={() => go('favorites')}><Icon name="heart" /> Favoritos ({favorites.length})</button>
                        {isSeller && <button type="button" className="primary" onClick={publish}>＋ Publicar propiedad</button>}
                      </div>
                    </div>

                    <SellerStats items={isSeller ? [
                      { icon: 'home', value: myListings.filter(p => p.active).length, label: 'Publicaciones activas', hint: `${myListings.length.toLocaleString('es-MX')} en total` },
                      { icon: 'inbox', value: pendingCount, label: 'Solicitudes por responder', hint: pendingCount ? 'Revísalas abajo' : 'Todo al día', tone: pendingCount ? 'warn' : '' },
                      { icon: 'check', value: upcoming.length, label: 'Visitas confirmadas', hint: next ? `Próxima: ${nextText}` : 'Sin visitas próximas' },
                      { icon: 'archive', value: myListings.filter(p => !p.active).length, label: 'Publicaciones retiradas', tone: 'muted' }
                    ] : [
                      { icon: 'home', value: favorites.length, label: 'Propiedades guardadas' },
                      { icon: 'inbox', value: pendingCount, label: 'Solicitudes pendientes', tone: pendingCount ? 'warn' : '' },
                      { icon: 'check', value: upcoming.length, label: 'Visitas confirmadas', hint: next ? `Próxima: ${nextText}` : '' },
                      { icon: 'archive', value: appointments.filter(a => ['Cancelada', 'Rechazada', 'Vencida'].includes(a.status)).length, label: 'Canceladas o vencidas', tone: 'muted' }
                    ]} />

                    {isSeller && user.role !== 'admin' && (
                      <div className="sp-availability-row">
                        <VacationCard user={user} appointments={appointments} onChanged={() => refresh()} />
                        <BlockedTimesCard />
                      </div>
                    )}

                    {isSeller && (
                      <SellerListings
                        items={myListings}
                        user={user}
                        busy={busy}
                        isAdmin={false}
                        onRestore={p => act(() => api(`properties/${p.id}/restore`, 'POST', {}), p.review?.status === 'aprobada' ? 'Tu publicación volvió al catálogo.' : 'Listo. Se mostrará en el catálogo cuando se apruebe su documentación.')}
                        onOpen={open}
                        onCloseDeal={(p, result) => {
                          if (window.confirm(`¿Marcar «${p.title}» como ${result}? Saldrá del catálogo y se cancelarán sus visitas futuras (se avisa a los compradores). Podrás volver a publicarla cuando quieras.`)) {
                            act(() => api(`properties/${p.id}/close`, 'POST', { result }), result === 'vendida' ? '¡Felicidades por la venta! 🎉' : '¡Felicidades, ya está rentada! 🎉')
                          }
                        }}
                        onSchedule={p => { setAvailabilityProperty(p); go('availability') }}
                        onEdit={p => { setEditing(p); go('editor') }}
                        onRetire={p => {
                          if (window.confirm('¿Retirar esta publicación del catálogo? Las citas se conservarán.')) {
                            act(() => api(`properties/${p.id}`, 'DELETE', {}), 'Publicación retirada.')
                          }
                        }}
                      />
                    )}
                  </>
                )
              })()}

              <div className="section-heading">
                <h2>
                  {user.role === 'comprador'
                    ? 'Mis visitas'
                    : 'Mis visitas y solicitudes recibidas'}
                </h2>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => act(
                    () => Promise.resolve(),
                    'Información actualizada.'
                  )}
                >
                  ↻ Actualizar
                </button>
              </div>

              {appointments.length > 0 && (
                <div className="dashboard-filters" role="group" aria-label="Filtrar solicitudes de visita">
                  {appointmentGroups.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`dashboard-filter ${appointmentFilter === value ? 'selected' : ''}`}
                      onClick={() => setAppointmentFilter(value)}
                      aria-pressed={appointmentFilter === value}
                    >
                      {label}
                      <span className="dashboard-filter-count">
                        {appointments.filter(a => inAppointmentGroup(value, a)).length}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {appointments.filter(a => inAppointmentGroup(appointmentFilter, a)).map(a => <VisitCard key={a.id} appointment={a} property={properties.find(p => p.id === a.property_id)} user={user} onRefresh={() => refresh()} />)}

              {appointments.length === 0 && (
                <Empty title="Aún no hay visitas en tu agenda.">
                  <p>
                    {user.role === 'comprador'
                      ? 'Encuentra una propiedad y solicita un horario para conocerla.'
                      : 'Las solicitudes de tus propiedades aparecerán aquí.'}
                  </p>
                </Empty>
              )}

              {appointments.length > 0 &&
                !appointments.some(a => inAppointmentGroup(appointmentFilter, a)) && (
                  <Empty title="No hay solicitudes en esta categoría.">
                    <p>Selecciona otro filtro para revisar tus visitas.</p>
                  </Empty>
                )}

            </section>
          )}
        </main>
      )}

      <footer>
        <button className="brand" onClick={() => go('home')}>
          <Icon name="home" /> casa<span>fast</span>
        </button>
        <p>Un espacio para cada nuevo comienzo.</p>
        <small>CasaFast · Compra y renta de propiedades</small>
      </footer>
    </>
  )
  
}
