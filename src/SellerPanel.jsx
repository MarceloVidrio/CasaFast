import { useEffect, useMemo, useState } from 'react'
import { api, money, normalized } from './lib'
import './SellerPanel.css'

const PER_PAGE = 10
const zone = 'America/Mazatlan'
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const niceDay = day => new Date(`${day}T12:00:00-07:00`).toLocaleDateString('es-MX', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'long' })
const dayStart = day => Date.parse(`${day}T00:00:00-07:00`)

function Svg({ d, size = 20 }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
}
const ICONS = {
  home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z',
  check: 'M20 6 9 17l-5-5',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'
}

/* ------------------------------------------------------------------ */
/* Resumen (tarjetas de indicadores)                                   */
/* ------------------------------------------------------------------ */

export function SellerStats({ items }) {
  return (
    <div className="sp-stats">
      {items.map(({ icon, value, label, hint, tone }) => (
        <div className={`sp-stat ${tone || ''}`} key={label}>
          <span className="sp-stat-icon"><Svg d={ICONS[icon]} /></span>
          <div>
            <strong>{typeof value === 'number' ? value.toLocaleString('es-MX') : value}</strong>
            <span>{label}</span>
            {hint && <small>{hint}</small>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Paginación: 1 … 4 5 6 … 322                                         */
/* ------------------------------------------------------------------ */

function pageList(page, pages) {
  const set = new Set([1, pages, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach(n => set.add(n))
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach(n => set.add(n))
  const list = [...set].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b)
  return list.flatMap((n, i) => (i && n - list[i - 1] > 1 ? ['…', n] : [n]))
}

export function Pagination({ page, pages, onPage }) {
  if (pages <= 1) return null
  return (
    <nav className="sp-pagination" aria-label="Páginas">
      <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">‹ Anterior</button>
      <div className="sp-pages">
        {pageList(page, pages).map((n, i) => n === '…'
          ? <span key={`gap-${i}`} className="sp-gap">…</span>
          : <button type="button" key={n} className={n === page ? 'current' : ''} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>)}
      </div>
      <button type="button" disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Página siguiente">Siguiente ›</button>
    </nav>
  )
}

/* ------------------------------------------------------------------ */
/* Lista de publicaciones del vendedor                                 */
/* ------------------------------------------------------------------ */

// Estado visible de una publicación para su vendedor.
export const listingState = p => p.review?.hold ? 'suspendida' : p.closed ? 'cerrada' : !p.active ? 'retirada' : p.review?.status === 'pendiente' ? 'revision' : p.review?.status === 'rechazada' ? 'rechazada' : 'activa'
const STATE_LABEL = { activa: 'Activa', revision: 'En revisión', rechazada: 'Requiere cambios', retirada: 'Retirada', suspendida: 'Retirada por CasaFast', cerrada: 'Cerrada' }
const stateLabel = p => listingState(p) === 'cerrada' ? (p.closed.result === 'vendida' ? '🎉 Vendida' : '🎉 Rentada') : STATE_LABEL[listingState(p)]
const OFF = ['retirada', 'suspendida', 'cerrada']
const dueText = iso => iso ? new Date(iso).toLocaleString('es-MX', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''

export function SellerListings({ items, user, busy, isAdmin, onOpen, onSchedule, onEdit, onRetire, onRestore, onCloseDeal }) {
  const [stats, setStats] = useState({})
  // Estadísticas por publicación: vistas, favoritos, citas y asistencia.
  useEffect(() => {
    let alive = true
    api('seller/stats').then(data => { if (alive) setStats(data) }).catch(() => {})
    return () => { alive = false }
  }, [items])
  const [tab, setTab] = useState('todas')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('new')
  const [page, setPage] = useState(1)

  const counts = useMemo(() => ({ todas: items.length, activas: items.filter(p => listingState(p) === 'activa').length, revision: items.filter(p => ['revision', 'rechazada'].includes(listingState(p))).length, retiradas: items.filter(p => OFF.includes(listingState(p))).length }), [items])
  const filtered = useMemo(() => {
    const q = normalized(query.trim())
    return items
      .filter(p => tab === 'todas' || (tab === 'activas' ? listingState(p) === 'activa' : tab === 'revision' ? ['revision', 'rechazada'].includes(listingState(p)) : OFF.includes(listingState(p))))
      .filter(p => !q || normalized(`${p.title} ${p.location}`).includes(q))
      .sort((a, b) => sort === 'low' ? a.price - b.price : sort === 'high' ? b.price - a.price : String(b.created).localeCompare(String(a.created)))
  }, [items, tab, query, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const current = Math.min(page, pages)
  const shown = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE)
  useEffect(() => { setPage(1) }, [tab, query, sort])
  const goPage = n => { setPage(n); document.querySelector('.sp-listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return (
    <section className="sp-card sp-listings">
      <header className="sp-card-head">
        <div>
          <h2>{isAdmin ? 'Todas las publicaciones' : 'Mis publicaciones'}</h2>
          <p>{counts.activas.toLocaleString('es-MX')} activas de {counts.todas.toLocaleString('es-MX')} en total</p>
        </div>
        <label className="sp-search">
          <Svg d={ICONS.search} size={16} />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por título o zona" aria-label="Buscar en mis publicaciones" />
        </label>
      </header>

      <div className="sp-toolbar">
        <div className="sp-tabs" role="tablist" aria-label="Filtrar publicaciones">
          {[['todas', 'Todas'], ['activas', 'Activas'], ['revision', 'En revisión'], ['retiradas', 'Retiradas y cerradas']].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>
              {label}<span>{counts[value].toLocaleString('es-MX')}</span>
            </button>
          ))}
        </div>
        <label className="sp-sort">Ordenar
          <select value={sort} onChange={e => setSort(e.target.value)}>
            <option value="new">Más recientes</option>
            <option value="low">Menor precio</option>
            <option value="high">Mayor precio</option>
          </select>
        </label>
      </div>

      {shown.length ? (
        <div className="sp-table" role="table" aria-label="Publicaciones">
          <div className="sp-row sp-row-head" role="row">
            <span role="columnheader">Propiedad</span>
            <span role="columnheader">Precio</span>
            <span role="columnheader">Estado</span>
            <span role="columnheader" className="sp-right">Acciones</span>
          </div>
          {shown.map(p => (
            <div className="sp-row" role="row" key={p.id}>
              <div className="sp-prop" role="cell">
                <img src={p.images?.[0]} alt="" loading="lazy" />
                <div>
                  <button type="button" className="sp-title" onClick={() => onOpen(p)}>{p.title}</button>
                  <small>{p.type} · {p.location}</small>
                  {p.code && <small className="sp-code">{p.code}</small>}
                  <ListingStats s={stats[p.id]} />
                </div>
              </div>
              <div role="cell" className="sp-price">
                <strong>{money(p.price)}</strong>
                <small>{p.operation === 'renta' ? 'Renta mensual' : 'Venta'}</small>
              </div>
              <div role="cell">
                <span className={`sp-badge st-${listingState(p)}`}>{stateLabel(p)}</span>
                {p.demo && <span className="sp-badge demo">Ejemplo</span>}
                {listingState(p) === 'revision' && <small className="sp-state-note">Respuesta a más tardar {dueText(p.review.due)}</small>}
                {listingState(p) === 'rechazada' && <small className="sp-state-note bad" title={p.review.note}>{p.review.note}</small>}
                {listingState(p) === 'suspendida' && <small className="sp-state-note bad" title={p.review.holdNote}>{p.review.holdNote}</small>}
              </div>
              <div role="cell" className="sp-actions">
                <button type="button" className="sp-icon-btn" onClick={() => onOpen(p)} title="Ver publicación" aria-label={`Ver ${p.title}`}><Svg d={ICONS.eye} size={17} /></button>
                {['retirada', 'cerrada'].includes(listingState(p)) && <button type="button" className="sp-republish" disabled={busy} onClick={() => onRestore(p)}>Volver a publicar</button>}
                {listingState(p) === 'activa' && p.sellerId === user.id && onCloseDeal && <button type="button" className="sp-deal" disabled={busy} onClick={() => onCloseDeal(p, p.operation === 'renta' ? 'rentada' : 'vendida')} title={p.operation === 'renta' ? 'Marcar como rentada' : 'Marcar como vendida'}>{p.operation === 'renta' ? '🔑 Rentada' : '🎉 Vendida'}</button>}
                {listingState(p) === 'rechazada' && <button type="button" className="sp-republish warn" onClick={() => onEdit(p)}>Corregir</button>}
                {listingState(p) === 'activa' && p.sellerId === user.id && <button type="button" className="sp-icon-btn" onClick={() => onSchedule(p)} title="Horarios de visita" aria-label={`Horarios de visita de ${p.title}`}><Svg d={ICONS.clock} size={17} /></button>}
                {!p.demo && listingState(p) !== 'suspendida' && <button type="button" className="sp-icon-btn" onClick={() => onEdit(p)} title={p.active ? 'Editar' : 'Republicar'} aria-label={`${p.active ? 'Editar' : 'Republicar'} ${p.title}`}><Svg d={ICONS.edit} size={17} /></button>}
                {p.active && <button type="button" className="sp-icon-btn sp-danger" disabled={busy} onClick={() => onRetire(p)} title="Retirar del catálogo" aria-label={`Retirar ${p.title}`}><Svg d={ICONS.trash} size={17} /></button>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sp-empty">
          {items.length ? 'No hay publicaciones con estos filtros.' : isAdmin ? 'Todavía no hay publicaciones.' : 'Tu primera publicación empieza aquí: agrega fotos y detalles para que encuentren tu espacio.'}
        </div>
      )}

      <footer className="sp-card-foot">
        <span>{filtered.length ? `Mostrando ${((current - 1) * PER_PAGE + 1).toLocaleString('es-MX')}–${Math.min(current * PER_PAGE, filtered.length).toLocaleString('es-MX')} de ${filtered.length.toLocaleString('es-MX')}` : ''}</span>
        <Pagination page={current} pages={pages} onPage={goPage} />
      </footer>
    </section>
  )
}

/* Vistas, favoritos, citas y asistencia de una publicación. */
function ListingStats({ s }) {
  if (!s) return null
  const items = [
    ['👁', s.views, s.views === 1 ? 'vista' : 'vistas', `${s.viewsWeek} en los últimos 7 días`],
    ['♥', s.favorites, s.favorites === 1 ? 'favorito' : 'favoritos', 'Personas que la guardaron'],
    ['📅', s.visits, s.visits === 1 ? 'cita' : 'citas', s.upcoming ? `${s.upcoming} próxima${s.upcoming === 1 ? '' : 's'}` : 'Sin citas próximas'],
    ...(s.attended || s.noShows ? [['✓', s.attended, 'asistieron', s.noShows ? `${s.noShows} no se presentaron` : 'Todos llegaron']] : []),
    ...(s.rating ? [['★', s.rating.avg.toFixed(1), `(${s.rating.count})`, 'Calificación de las visitas']] : [])
  ]
  return <span className="sp-mini-stats">{items.map(([icon, value, label, title]) => <span key={label} title={title}><b aria-hidden="true">{icon}</b>{value} {label}</span>)}</span>
}

/* ------------------------------------------------------------------ */
/* Bloquear horarios puntuales                                         */
/* ------------------------------------------------------------------ */

const blockText = b => {
  const s = new Date(b.start), e = new Date(b.end)
  const day = d => d.toLocaleDateString('es-MX', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' })
  const time = d => d.toLocaleTimeString('es-MX', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
  return day(s) === day(e) ? `${day(s)}, ${time(s)} – ${time(e)}` : `${day(s)} ${time(s)} – ${day(e)} ${time(e)}`
}

export function BlockedTimesCard() {
  const [blocks, setBlocks] = useState(null)
  const [adding, setAdding] = useState(false)
  const [day, setDay] = useState(todayLocal())
  const [from, setFrom] = useState('14:00')
  const [to, setTo] = useState('18:00')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = () => api('blocks').then(setBlocks).catch(() => setBlocks([]))
  useEffect(() => { load() }, [])
  const iso = (d, t) => new Date(`${d}T${t}:00-07:00`).toISOString()

  async function add(e) {
    e.preventDefault(); setError('')
    if (to <= from) { setError('La hora final debe ser después de la inicial.'); return }
    setBusy(true)
    try { await api('blocks', 'POST', { start: iso(day, from), end: iso(day, to), note }); setAdding(false); setNote(''); await load() }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function remove(id) {
    setBusy(true); setError('')
    try { await api(`blocks/${id}`, 'DELETE'); await load() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (blocks === null) return null
  return (
    <section className="sp-card sp-blocks">
      <div className="sp-vacation-main">
        <span className="sp-vacation-icon block"><Svg d={ICONS.clock} size={22} /></span>
        <div>
          <h2>Horarios bloqueados</h2>
          <p>¿Un rato en que no puedes atender? Bloquéalo y nadie podrá agendar visitas a esa hora.</p>
        </div>
        {!adding && <div className="sp-vacation-actions"><button type="button" className="secondary" onClick={() => setAdding(true)}>Bloquear horario</button></div>}
      </div>
      {adding && (
        <form className="sp-vacation-form" onSubmit={add}>
          <label>Día<input type="date" min={todayLocal()} value={day} required onChange={e => setDay(e.target.value)} /></label>
          <label>De<input type="time" step="1800" value={from} required onChange={e => setFrom(e.target.value)} /></label>
          <label>A<input type="time" step="1800" value={to} required onChange={e => setTo(e.target.value)} /></label>
          <label className="sp-grow">Motivo <small>(opcional, solo tú lo ves)</small><input type="text" maxLength="120" value={note} onChange={e => setNote(e.target.value)} placeholder="Ej. Junta de trabajo" /></label>
          <div className="sp-form-actions">
            <button type="button" className="secondary" onClick={() => { setAdding(false); setError('') }}>Cancelar</button>
            <button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Bloquear'}</button>
          </div>
        </form>
      )}
      {!!blocks.length && <ul className="sp-block-list">{blocks.map(b => (
        <li key={b.id}><span>⛔ {blockText(b)}{b.note ? <small> · {b.note}</small> : null}</span><button type="button" className="text-button" disabled={busy} onClick={() => remove(b.id)}>Quitar</button></li>
      ))}</ul>}
      {error && <p className="sp-msg error" role="alert">{error}</p>}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Modo vacaciones                                                     */
/* ------------------------------------------------------------------ */

export function VacationCard({ user, appointments, onChanged }) {
  const [vacation, setVacation] = useState(undefined)
  const [editing, setEditing] = useState(false)
  const [start, setStart] = useState(todayLocal())
  const [end, setEnd] = useState(todayLocal())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let alive = true
    api('vacation').then(v => { if (alive) setVacation(v) }).catch(() => { if (alive) setVacation(null) })
    return () => { alive = false }
  }, [])

  // Visitas activas de sus propiedades que se cancelarían con estas fechas.
  const affected = useMemo(() => {
    if (!start || !end || start > end) return []
    const from = dayStart(start), to = dayStart(end) + 86400000
    return appointments.filter(a => a.sellerId === user.id && ['Pendiente', 'Aceptada', 'Propuesta'].includes(a.status) &&
      [a.date, a.status === 'Propuesta' ? a.proposed_date : null].filter(Boolean).some(d => Date.parse(d) < to && Date.parse(d) + 3600000 > from))
  }, [appointments, start, end, user.id])

  async function save(e) {
    e.preventDefault(); setError(''); setNotice('')
    if (start > end) { setError('La fecha de regreso debe ser igual o posterior a la de inicio.'); return }
    if (affected.length && !window.confirm(`Se cancelarán ${affected.length} ${affected.length === 1 ? 'visita' : 'visitas'} en esas fechas y se avisará a los compradores. ¿Continuar?`)) return
    setBusy(true)
    try {
      const result = await api('vacation', 'PUT', { start, end, note })
      setVacation(result.vacation); setEditing(false)
      setNotice(result.cancelled ? `Modo vacaciones activado. Se cancelaron ${result.cancelled} ${result.cancelled === 1 ? 'visita' : 'visitas'} y se avisó a los compradores.` : 'Modo vacaciones activado. No recibirás citas en esas fechas.')
      await onChanged?.()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function stop() {
    if (!window.confirm('¿Terminar el modo vacaciones? Volverás a recibir solicitudes de visita.')) return
    setBusy(true); setError('')
    try { await api('vacation', 'DELETE', {}); setVacation(null); setNotice('Modo vacaciones desactivado. Ya puedes recibir citas de nuevo.') } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (vacation === undefined) return null
  return (
    <section className={`sp-card sp-vacation ${vacation ? 'is-on' : ''}`}>
      <div className="sp-vacation-main">
        <span className="sp-vacation-icon"><Svg d={ICONS.sun} size={22} /></span>
        <div>
          <h2>Modo vacaciones {vacation && <span className="sp-badge vac">{vacation.active ? 'Activo' : 'Programado'}</span>}</h2>
          {vacation ? (
            <p>No recibirás citas del <strong>{niceDay(vacation.start)}</strong> al <strong>{niceDay(vacation.end)}</strong>.{vacation.note ? ` Nota: ${vacation.note.replace(/[.\s]+$/, '')}.` : ''} Los compradores verán que esos días no hay horarios.</p>
          ) : (
            <p>¿Te vas de viaje? Pausa las citas en todas tus propiedades. Las visitas que ya tengas en esas fechas se cancelan y se avisa a los compradores.</p>
          )}
        </div>
        <div className="sp-vacation-actions">
          {vacation && !editing && <button type="button" className="secondary" onClick={() => { setStart(vacation.start); setEnd(vacation.end); setNote(vacation.note); setEditing(true) }}>Cambiar fechas</button>}
          {vacation && !editing && <button type="button" className="secondary" disabled={busy} onClick={stop}>Terminar</button>}
          {!vacation && !editing && <button type="button" className="primary" onClick={() => setEditing(true)}>Programar vacaciones</button>}
        </div>
      </div>
      {editing && (
        <form className="sp-vacation-form" onSubmit={save}>
          <label>Desde<input type="date" min={todayLocal()} value={start} required onChange={e => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value) }} /></label>
          <label>Hasta (incluido)<input type="date" min={start || todayLocal()} value={end} required onChange={e => setEnd(e.target.value)} /></label>
          <label className="sp-grow">Nota para ti <small>(opcional)</small><input type="text" maxLength="140" value={note} onChange={e => setNote(e.target.value)} placeholder="Ej. Viaje familiar" /></label>
          <div className={`sp-affected ${affected.length ? 'warn' : ''}`}>
            {affected.length ? `Se cancelarán ${affected.length} ${affected.length === 1 ? 'visita' : 'visitas'} que caen en estas fechas.` : 'No tienes visitas en estas fechas.'}
          </div>
          <div className="sp-form-actions">
            <button type="button" className="secondary" onClick={() => { setEditing(false); setError('') }}>Cancelar</button>
            <button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Activar modo vacaciones'}</button>
          </div>
        </form>
      )}
      {error && <p className="sp-msg error" role="alert">{error}</p>}
      {notice && <p className="sp-msg success" role="status">{notice}</p>}
    </section>
  )
}
