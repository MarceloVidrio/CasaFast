import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, money, normalized } from './lib'
import { Pagination } from './SellerPanel'
import './AdminPanel.css'

// Panel de administración. No tiene enlaces en la página: se abre con /?admin
// y solo responde a cuentas con rol de administrador (el servidor valida cada acción).

const zone = 'America/Mazatlan'
const when = iso => iso ? new Date(iso).toLocaleString('es-MX', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'
const PER_PAGE = 12
// Motivos de rechazo frecuentes: un clic los agrega y se pueden editar antes de enviar.
const QUICK_REASONS = [
  ['Predial vencido', 'La boleta predial no corresponde al año en curso. Sube la boleta pagada de este año.'],
  ['Identificación ilegible', 'La identificación no se lee con claridad. Sube una foto o escaneo nítido de ambos lados.'],
  ['Nombre no coincide', 'El nombre de la identificación no coincide con el de la escritura. Si actúas en representación del propietario, agrega el poder notarial.'],
  ['Gravamen antiguo', 'El certificado de libertad de gravamen tiene más de 3 meses. Sube uno reciente.'],
  ['Recibo de agua con adeudo', 'El recibo de agua muestra un adeudo. Sube el comprobante de pago o una constancia de no adeudo.'],
  ['Documento incompleto', 'Uno de los documentos está incompleto o le faltan páginas. Súbelo completo.']
]
const DOC_LABEL = { identificacion: 'Identificación', escritura: 'Escritura', predial: 'Predial', agua: 'Recibo de agua', gravamen: 'Libertad de gravamen', poder: 'Poder notarial' }

function timeLeft(due, now) {
  const ms = Date.parse(due) - now
  if (!Number.isFinite(ms)) return { text: 'Sin plazo', tone: '' }
  if (ms <= 0) return { text: `Vencida hace ${Math.max(1, Math.round(-ms / 3600000))} h`, tone: 'late' }
  const h = Math.floor(ms / 3600000)
  const m = Math.floor(ms / 60000) % 60
  return { text: h >= 24 ? `Vence en ${Math.floor(h / 24)} d ${h % 24} h` : h < 4 ? `⏰ Vence en ${h ? `${h} h ` : ''}${m} min` : `Vence en ${h} h`, tone: h < 4 ? 'urgent' : h < 6 ? 'soon' : '' }
}

function ReviewCard({ item, onDone, now }) {
  const [mode, setMode] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const left = timeLeft(item.due, now)
  const have = new Set(item.documents.map(d => d.kind))
  const missing = item.requirements.filter(r => r.required && !have.has(r.kind))
  async function decide(decision) {
    setBusy(true); setError('')
    try { await api(`admin/reviews/${item.propertyId}`, 'POST', { decision, note }); await onDone(decision === 'aprobar' ? `«${item.title}» aprobada y publicada.` : `«${item.title}» devuelta al vendedor con observaciones.`) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <article className={`ad-review ${item.status} ${item.status === 'pendiente' ? left.tone : ''}`}>
      <div className="ad-review-head">
        {item.image ? <img src={item.image} alt="" /> : <div className="ad-thumb" />}
        <div className="ad-review-title">
          <strong>{item.title} {item.code && <code className="ad-code">{item.code}</code>}</strong>
          <small>{item.type} en {item.operation} · {money(item.price)} · {item.location}</small>
          <small>Vendedor: {item.seller.name} · {item.seller.email}</small>
        </div>
        {item.status === 'pendiente'
          ? <span className={`ad-sla ${left.tone}`}>{left.text}</span>
          : <span className={`ad-pill ${item.status}`}>{item.status === 'aprobada' ? 'Aprobada' : 'Rechazada'} · {when(item.reviewed)}</span>}
      </div>
      <div className="ad-docs">
        {item.requirements.map(r => {
          const doc = item.documents.find(d => d.kind === r.kind)
          return doc
            ? <a key={r.kind} className="ad-doc ok" href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer">📄 {DOC_LABEL[r.kind] || r.label} <span>Abrir ↗</span></a>
            : <span key={r.kind} className={`ad-doc ${r.required ? 'missing' : 'optional'}`}>{r.required ? '⚠' : '○'} {DOC_LABEL[r.kind] || r.label} <span>{r.required ? 'Falta' : 'No enviado'}</span></span>
        })}
      </div>
      {item.status === 'pendiente' && !!item.duplicates?.length && (
        <div className="ad-dupes" role="note">
          <strong>⚠ Posible duplicado o fraude</strong>
          <ul>{item.duplicates.map(d => <li key={d.propertyId}><a href={`/?propiedad=${encodeURIComponent(d.propertyId)}`} target="_blank" rel="noreferrer">{d.title}</a> {d.code && <code className="ad-code">{d.code}</code>} · {d.sameSeller ? 'del mismo vendedor' : `de ${d.seller}`} · <em>{d.reasons.join(', ')}</em></li>)}</ul>
        </div>
      )}
      {item.status === 'pendiente' && <p className="ad-meta">Enviada {when(item.submitted)} · Plazo: {when(item.due)}{missing.length ? ` · Faltan ${missing.length} obligatorios` : ''}</p>}
      {item.status === 'rechazada' && item.note && <p className="ad-meta">Motivo: {item.note}</p>}
      {item.status === 'pendiente' && (
        <div className="ad-review-actions">
          {mode === 'rechazar' ? (
            <>
              <div className="ad-quick" aria-label="Motivos frecuentes">
                {QUICK_REASONS.map(([label, text]) => <button type="button" key={label} className={note.includes(text) ? 'on' : ''} onClick={() => setNote(n => n.includes(text) ? n.replace(text, '').replace(/\n{2,}/g, '\n').trim() : [n.trim(), text].filter(Boolean).join('\n'))}>{label}</button>)}
              </div>
              <textarea rows="3" value={note} onChange={e => setNote(e.target.value)} placeholder="Explica al vendedor qué debe corregir (se le enviará por correo)." maxLength="600" />
              <div className="ad-row-btns">
                <button type="button" className="secondary" onClick={() => setMode('')}>Volver</button>
                <button type="button" className="ad-btn danger" disabled={busy || note.trim().length < 5} onClick={() => decide('rechazar')}>Enviar rechazo</button>
              </div>
            </>
          ) : (
            <div className="ad-row-btns">
              <button type="button" className="ad-btn danger-outline" disabled={busy} onClick={() => setMode('rechazar')}>Rechazar</button>
              <button type="button" className="ad-btn approve" disabled={busy || missing.length > 0} title={missing.length ? 'Faltan documentos obligatorios' : ''} onClick={() => decide('aprobar')}>Aprobar y publicar</button>
            </div>
          )}
        </div>
      )}
      {error && <p className="ad-error" role="alert">{error}</p>}
    </article>
  )
}

function ListingsAdmin({ properties, onAction, initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery)
  const [tab, setTab] = useState(initialQuery ? 'todas' : 'activas')
  const [page, setPage] = useState(1)
  const [retiring, setRetiring] = useState(null)
  const [note, setNote] = useState('')
  const state = p => p.review?.hold ? 'suspendida' : !p.active ? 'retirada' : p.review?.status === 'pendiente' ? 'revision' : p.review?.status === 'rechazada' ? 'rechazada' : 'activa'
  const label = { activa: 'Activa', revision: 'En revisión', rechazada: 'Rechazada', retirada: 'Retirada por vendedor', suspendida: 'Retirada por CasaFast' }
  const filtered = useMemo(() => {
    const q = normalized(query.trim())
    return properties.filter(p => (tab === 'todas' || (tab === 'activas' ? state(p) === 'activa' : tab === 'retiradas' ? ['retirada', 'suspendida'].includes(state(p)) : state(p) === 'revision'))
      && (!q || normalized(`${p.title} ${p.location} ${p.id} ${p.code || ''}`).includes(q)))
  }, [properties, query, tab])
  useEffect(() => setPage(1), [query, tab])
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE)), current = Math.min(page, pages)
  return (
    <section className="ad-card">
      <div className="ad-card-head">
        <h2>Publicaciones</h2>
        <input className="ad-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por folio (PUB-…), título o zona" />
      </div>
      <div className="ad-tabs">{[['activas', 'Activas'], ['revision', 'En revisión'], ['retiradas', 'Retiradas'], ['todas', 'Todas']].map(([v, l]) => <button key={v} type="button" className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}</button>)}</div>
      <div className="ad-table">
        {filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE).map(p => (
          <div className="ad-tr" key={p.id}>
            <img src={p.images?.[0]} alt="" loading="lazy" />
            <div className="ad-grow"><a href={`/?propiedad=${encodeURIComponent(p.id)}`} target="_blank" rel="noreferrer">{p.title}</a><small><code className="ad-code">{p.code}</code> {p.location} · {money(p.price)}</small>{p.review?.holdNote && <small className="ad-warn">Motivo: {p.review.holdNote}</small>}</div>
            <span className={`ad-pill ${state(p)}`}>{label[state(p)]}</span>
            <div className="ad-row-btns">
              {state(p) === 'suspendida'
                ? <button type="button" className="secondary" onClick={() => onAction(`admin/properties/${p.id}/restore`, {}, 'Publicación restaurada.')}>Restaurar</button>
                : retiring === p.id
                  ? <><input className="ad-inline" value={note} onChange={e => setNote(e.target.value)} placeholder="Motivo del retiro" maxLength="300" /><button type="button" className="ad-btn danger" disabled={note.trim().length < 5} onClick={async () => { await onAction(`admin/properties/${p.id}/retire`, { note }, 'Publicación retirada y vendedor notificado.'); setRetiring(null); setNote('') }}>Confirmar</button><button type="button" className="secondary" onClick={() => setRetiring(null)}>×</button></>
                  : <button type="button" className="ad-btn danger-outline" onClick={() => { setRetiring(p.id); setNote('') }}>Retirar</button>}
            </div>
          </div>
        ))}
        {!filtered.length && <p className="ad-empty">No hay publicaciones con estos filtros.</p>}
      </div>
      <div className="ad-foot"><span>{filtered.length.toLocaleString('es-MX')} {filtered.length === 1 ? 'publicación' : 'publicaciones'}</span><Pagination page={current} pages={pages} onPage={setPage} /></div>
    </section>
  )
}

const STATUS_LABEL = { Pendiente: 'Pendiente', Aceptada: 'Confirmada', Propuesta: 'Cambio propuesto', Rechazada: 'Rechazada', Cancelada: 'Cancelada', Vencida: 'Vencida' }
const STATUS_TONE = { Pendiente: 'revision', Aceptada: 'activa', Propuesta: 'revision', Rechazada: 'rechazada', Cancelada: 'suspendida', Vencida: '' }

// Crear una cita desde el panel: mismas reglas que la página y avisos a comprador y vendedor.
const localDay = (offset = 0) => new Date(Date.now() - 7 * 3600000 + offset * 86400000).toISOString().slice(0, 10)
function CreateAppointment({ properties, users, onCreated, onClose }) {
  const [propQuery, setPropQuery] = useState('')
  const [picked, setPicked] = useState(null)
  const [buyerEmail, setBuyerEmail] = useState('')
  const [day, setDay] = useState(localDay(1))
  const [hourValue, setHourValue] = useState('10')
  const [status, setStatus] = useState('Aceptada')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const matches = useMemo(() => {
    const q = normalized(propQuery.trim())
    if (q.length < 2 || picked) return []
    return properties.filter(p => p.active && p.review?.status !== 'pendiente' && normalized(`${p.code || ''} ${p.title} ${p.location}`).includes(q)).slice(0, 8)
  }, [properties, propQuery, picked])
  const buyers = useMemo(() => users.filter(u => u.active && u.id !== picked?.sellerId), [users, picked])
  async function submit(e) {
    e.preventDefault(); setError('')
    if (!picked) { setError('Elige la propiedad de la lista.'); return }
    setBusy(true)
    try {
      const date = new Date(`${day}T${hourValue.padStart(2, '0')}:00:00-07:00`).toISOString()
      const r = await api('appointments/admin', 'POST', { property: picked.id, buyerEmail, date, status, message })
      await onCreated(`Cita ${r.code} creada ${r.status === 'Aceptada' ? 'y confirmada' : 'como pendiente'}. Se avisó al comprador y al vendedor.`, r.code)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <form className="ad-create" onSubmit={submit}>
      <div className="ad-card-head"><h2>Nueva cita</h2><button type="button" className="secondary" onClick={onClose}>Cerrar</button></div>
      <div className="ad-create-grid">
        <label className="ad-create-prop">Propiedad
          {picked ? (
            <span className="ad-picked"><img src={picked.images?.[0]} alt="" /><span><strong>{picked.title}</strong><small><code className="ad-code">{picked.code}</code> {picked.location}</small></span><button type="button" className="text-button" onClick={() => { setPicked(null); setPropQuery('') }}>Cambiar</button></span>
          ) : (
            <>
              <input value={propQuery} onChange={e => setPropQuery(e.target.value)} placeholder="Escribe el folio PUB-… o el nombre" autoFocus />
              {!!matches.length && <span className="ad-suggest">{matches.map(p => <button type="button" key={p.id} onClick={() => setPicked(p)}><code className="ad-code">{p.code}</code> {p.title} <small>{p.location}</small></button>)}</span>}
            </>
          )}
        </label>
        <label>Comprador (correo de su cuenta)
          <input type="email" list="ad-buyers" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} placeholder="correo@ejemplo.com" required />
          <datalist id="ad-buyers">{buyers.map(u => <option key={u.id} value={u.email}>{u.name}</option>)}</datalist>
        </label>
        <label>Día<input type="date" min={localDay(0)} max={localDay(90)} value={day} onChange={e => setDay(e.target.value)} required /></label>
        <label>Hora (Culiacán)
          <select value={hourValue} onChange={e => setHourValue(e.target.value)}>
            {Array.from({ length: 14 }, (_, i) => i + 7).map(h => <option key={h} value={String(h)}>{h === 12 ? '12:00 p.m.' : h > 12 ? `${h - 12}:00 p.m.` : `${h}:00 a.m.`}</option>)}
          </select>
        </label>
        <fieldset className="ad-create-status"><legend>Estado</legend>
          <label className={status === 'Aceptada' ? 'on' : ''}><input type="radio" checked={status === 'Aceptada'} onChange={() => setStatus('Aceptada')} /> Confirmada <small>Se envía el domicilio exacto</small></label>
          <label className={status === 'Pendiente' ? 'on' : ''}><input type="radio" checked={status === 'Pendiente'} onChange={() => setStatus('Pendiente')} /> Pendiente <small>El vendedor la confirma</small></label>
        </fieldset>
        <label className="ad-create-msg">Nota para el vendedor <small>(opcional)</small><textarea rows="2" maxLength="1500" value={message} onChange={e => setMessage(e.target.value)} placeholder="Ej. El cliente llamó por teléfono" /></label>
      </div>
      {error && <p className="ad-error" role="alert">{error}</p>}
      <div className="ad-row-btns ad-create-actions"><button className="ad-btn approve" disabled={busy}>{busy ? 'Creando…' : 'Crear cita y avisar'}</button></div>
    </form>
  )
}

function AppointmentsAdmin({ appointments, properties = [], users = [], onCreated, initialQuery = '' }) {
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState(initialQuery)
  const [tab, setTab] = useState('todas')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(initialQuery ? 'auto' : '')
  const filtered = useMemo(() => {
    const q = normalized(query.trim())
    return appointments.filter(a => (tab === 'todas' || (tab === 'activas' ? ['Pendiente', 'Aceptada', 'Propuesta'].includes(a.status) : !['Pendiente', 'Aceptada', 'Propuesta'].includes(a.status)))
      && (!q || normalized(`${a.code} ${a.propertyCode} ${a.title} ${a.buyerName} ${a.buyerEmail} ${a.sellerName} ${a.sellerEmail}`).includes(q)))
  }, [appointments, query, tab])
  useEffect(() => setPage(1), [query, tab])
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE)), current = Math.min(page, pages)
  const expanded = open === 'auto' && filtered.length === 1 ? filtered[0].id : open
  return (
    <section className="ad-card">
      <div className="ad-card-head"><h2>Citas</h2><div className="ad-row-btns"><input className="ad-search" type="search" value={query} onChange={e => { setQuery(e.target.value); setOpen('') }} placeholder="Buscar por folio (CITA-…), propiedad, comprador o vendedor" />{!creating && <button type="button" className="ad-btn approve" onClick={() => setCreating(true)}>＋ Crear cita</button>}</div></div>
      {creating && <CreateAppointment properties={properties} users={users} onClose={() => setCreating(false)} onCreated={async (msg, code) => { setCreating(false); await onCreated?.(msg); setQuery(code); setOpen('auto') }} />}
      <div className="ad-tabs">{[['todas', 'Todas'], ['activas', 'Activas'], ['cerradas', 'Cerradas']].map(([v, l]) => <button key={v} type="button" className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}</button>)}</div>
      <div className="ad-table">
        {filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE).map(a => (
          <div key={a.id} className={`ad-cita ${expanded === a.id ? 'open' : ''}`}>
            <button type="button" className="ad-tr ad-cita-row" onClick={() => setOpen(expanded === a.id ? '' : a.id)} aria-expanded={expanded === a.id}>
              <code className="ad-code strong">{a.code}</code>
              <div className="ad-grow"><strong>{a.title}</strong><small>{when(a.date)} · {a.buyerName} → {a.sellerName}</small></div>
              <span className={`ad-pill ${STATUS_TONE[a.status] || ''}`}>{STATUS_LABEL[a.status] || a.status}</span>
            </button>
            {expanded === a.id && (
              <div className="ad-cita-detail">
                <dl>
                  <div><dt>Folio de la cita</dt><dd><code className="ad-code">{a.code}</code></dd></div>
                  <div><dt>Publicación</dt><dd><a href={`/?propiedad=${encodeURIComponent(a.property_id)}`} target="_blank" rel="noreferrer">{a.title}</a> <code className="ad-code">{a.propertyCode}</code></dd></div>
                  <div><dt>Fecha y hora</dt><dd>{when(a.date)}{a.status === 'Propuesta' && a.proposed_date ? ` · propuesta: ${when(a.proposed_date)}` : ''}</dd></div>
                  <div><dt>Comprador</dt><dd>{a.buyerName} · {a.buyerEmail}</dd></div>
                  <div><dt>Vendedor</dt><dd>{a.sellerName} · {a.sellerEmail}</dd></div>
                  {a.message && <div><dt>Mensaje</dt><dd>{a.message}</dd></div>}
                </dl>
                <h4>Historial</h4>
                <ol className="ad-history">{a.history.map((h, i) => <li key={i}><time>{when(h.created)}</time><span>{h.event}</span>{h.detail && <small>{h.detail}</small>}</li>)}</ol>
              </div>
            )}
          </div>
        ))}
        {!filtered.length && <p className="ad-empty">{query ? `No hay citas que coincidan con «${query}».` : 'Todavía no hay citas.'}</p>}
      </div>
      <div className="ad-foot"><span>{filtered.length.toLocaleString('es-MX')} {filtered.length === 1 ? 'cita' : 'citas'}</span><Pagination page={current} pages={pages} onPage={setPage} /></div>
    </section>
  )
}

function ReportsAdmin({ reports, onAction }) {
  const [tab, setTab] = useState('abierto')
  const [retiring, setRetiring] = useState(null)
  const [note, setNote] = useState('')
  const shown = reports.filter(r => tab === 'abierto' ? r.status === 'abierto' : r.status !== 'abierto')
  return (
    <section className="ad-card">
      <div className="ad-card-head"><h2>Reportes de usuarios</h2></div>
      <div className="ad-tabs">{[['abierto', `Abiertos (${reports.filter(r => r.status === 'abierto').length})`], ['cerrado', 'Atendidos (30 días)']].map(([v, l]) => <button key={v} type="button" className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}</button>)}</div>
      <div className="ad-table">
        {shown.map(r => (
          <div className="ad-report" key={r.id}>
            <div className="ad-tr">
              {r.image ? <img src={r.image} alt="" /> : <span className="ad-avatar">🚩</span>}
              <div className="ad-grow">
                <a href={`/?propiedad=${encodeURIComponent(r.propertyId)}`} target="_blank" rel="noreferrer">{r.title}</a>
                <small><code className="ad-code">{r.code}</code> {r.location} · Vendedor: {r.seller.name} ({r.seller.email})</small>
                <small className="ad-warn">🚩 {r.reasonLabel}{r.total > 1 ? ` · ${r.total} reportes en total` : ''}</small>
                {r.detail && <small>«{r.detail}»</small>}
                <small>Reportó {r.reporter.name} · {when(r.created)}{!r.active ? ' · La publicación ya no está activa' : ''}</small>
                {r.status !== 'abierto' && <small>{r.status === 'resuelto' ? '✓ Resuelto' : 'Descartado'} {when(r.resolved)}{r.resolution ? ` · ${r.resolution}` : ''}</small>}
              </div>
              {r.status === 'abierto' && (
                <div className="ad-row-btns ad-wrap">
                  {r.active && <button type="button" className="ad-btn danger-outline" onClick={() => { setRetiring(r.id); setNote(r.reasonLabel) }}>Retirar publicación</button>}
                  <button type="button" className="secondary" onClick={() => onAction(`admin/reports/${r.id}`, { status: 'resuelto', note: 'Revisado por CasaFast' }, 'Reporte marcado como resuelto.')}>Resuelto</button>
                  <button type="button" className="text-button" onClick={() => onAction(`admin/reports/${r.id}`, { status: 'descartado', note: 'Sin problema encontrado' }, 'Reporte descartado.')}>Descartar</button>
                </div>
              )}
            </div>
            {retiring === r.id && (
              <div className="ad-retire-inline">
                <input className="ad-inline" value={note} onChange={e => setNote(e.target.value)} placeholder="Motivo del retiro (se envía al vendedor)" maxLength="300" />
                <button type="button" className="ad-btn danger" disabled={note.trim().length < 5} onClick={async () => {
                  await onAction(`admin/properties/${r.propertyId}/retire`, { note }, 'Publicación retirada y vendedor notificado.')
                  await onAction(`admin/reports/${r.id}`, { status: 'resuelto', note: `Publicación retirada: ${note}` }, 'Publicación retirada y reporte resuelto.')
                  setRetiring(null)
                }}>Confirmar retiro</button>
                <button type="button" className="secondary" onClick={() => setRetiring(null)}>Cancelar</button>
              </div>
            )}
          </div>
        ))}
        {!shown.length && <p className="ad-empty">{tab === 'abierto' ? '✓ No hay reportes abiertos.' : 'Sin reportes atendidos en los últimos 30 días.'}</p>}
      </div>
    </section>
  )
}

function MetricsAdmin({ metrics }) {
  if (!metrics) return <section className="ad-card ad-empty">No hay métricas disponibles todavía.</section>
  const max = Math.max(1, ...metrics.weeks.flatMap(w => [w.listings, w.visits]))
  const pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : '—'
  const v = metrics.visits
  return (
    <>
      <div className="ad-metrics">
        <div><span>⏱ Tiempo promedio de revisión</span><strong>{metrics.review.avgHours === null ? '—' : `${metrics.review.avgHours} h`}</strong><small>{metrics.review.count} revisiones en 30 días · {metrics.review.onTime === null ? 'sin datos' : `${metrics.review.onTime}% a tiempo`}</small></div>
        <div><span>📅 Citas solicitadas</span><strong>{v.requested}</strong><small>Últimos 30 días · {pct(v.confirmed, v.requested)} confirmadas</small></div>
        <div><span>❌ Cancelaciones</span><strong>{pct(v.cancelled, v.requested)}</strong><small>{v.cancelled} citas canceladas en 30 días</small></div>
        <div><span>🚶 Asistencia</span><strong>{pct(v.attended, v.attended + v.noShows)}</strong><small>{v.attended} asistieron · {v.noShows} no se presentaron</small></div>
        <div><span>⭐ Calificación promedio</span><strong>{metrics.ratings.avg === null ? '—' : metrics.ratings.avg.toFixed(1)}</strong><small>{metrics.ratings.count} calificaciones{metrics.ratings.matched !== null ? ` · ${metrics.ratings.matched}% dice que coincide con las fotos` : ''}</small></div>
        <div><span>🎉 Operaciones cerradas</span><strong>{metrics.closed.vendida + metrics.closed.rentada}</strong><small>{metrics.closed.vendida} vendidas · {metrics.closed.rentada} rentadas</small></div>
        <div><span>👁 Vistas de publicaciones</span><strong>{metrics.views30.toLocaleString('es-MX')}</strong><small>Últimos 30 días (una por persona y día)</small></div>
        <div className={metrics.reports ? 'warn' : ''}><span>🚩 Reportes abiertos</span><strong>{metrics.reports}</strong><small>{metrics.reports ? 'Revísalos en la pestaña Reportes' : 'Todo en orden'}</small></div>
      </div>
      <section className="ad-card">
        <div className="ad-card-head"><h2>Actividad por semana</h2><div className="ad-legend"><span className="l1">Publicaciones nuevas</span><span className="l2">Citas solicitadas</span></div></div>
        <div className="ad-bars" role="img" aria-label="Publicaciones nuevas y citas solicitadas en las últimas 8 semanas">
          {metrics.weeks.map(w => (
            <div className="ad-bar-group" key={w.label}>
              <div className="ad-bar-pair">
                <span className="b1" style={{ height: `${w.listings / max * 100}%` }} title={`${w.listings} publicaciones`}><em>{w.listings || ''}</em></span>
                <span className="b2" style={{ height: `${w.visits / max * 100}%` }} title={`${w.visits} citas`}><em>{w.visits || ''}</em></span>
              </div>
              <small>{w.label}</small>
            </div>
          ))}
        </div>
        <p className="ad-meta">Semanas de lunes a domingo. No incluye los anuncios de ejemplo.</p>
      </section>
    </>
  )
}

// Base de datos: ver, buscar, editar y borrar registros. Clic en cualquier celda para editarla.
function DatabaseAdmin() {
  const [tables, setTables] = useState(null)
  const [table, setTable] = useState('')
  const [data, setData] = useState(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [cell, setCell] = useState(null)
  const [draft, setDraft] = useState('')
  const [empty, setEmpty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => { api('admin/db').then(list => { setTables(list); setTable(t => t || (list.find(x => x.name === 'users') || list[0])?.name || '') }).catch(e => setError(e.message)) }, [])
  useEffect(() => { setPage(1); setQuery(''); setSearch(''); setNotice('') }, [table])
  useEffect(() => {
    if (!table) return
    let alive = true
    api(`admin/db/${table}?page=${page}&q=${encodeURIComponent(search)}`).then(d => { if (alive) { setData(d); setError('') } }).catch(e => alive && setError(e.message))
    return () => { alive = false }
  }, [table, page, search, reload])
  const refreshCounts = () => api('admin/db').then(setTables).catch(() => {})
  const show = v => v === null || v === undefined ? '—' : String(v)
  const pretty = v => { if (v === null || v === undefined) return ''; try { return /^[[{]/.test(String(v).trim()) ? JSON.stringify(JSON.parse(v), null, 2) : String(v) } catch { return String(v) } }
  const editable = c => data && !data.readOnly && !data.locked?.includes(c)
  function openCell(row, column) { setCell({ row, column }); setDraft(pretty(row[column])); setEmpty(row[column] === null); setError('') }
  async function save() {
    setSaving(true); setError('')
    try {
      await api(`admin/db/${table}/${cell.row.__rowid}`, 'PATCH', { column: cell.column, value: empty ? null : draft })
      setCell(null); setNotice(`Guardado: ${table}.${cell.column}. El cambio ya se ve en CasaFast.`); setReload(n => n + 1)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }
  async function remove(row) {
    const label = row.title || row.name || row.email || row.code || row.id || `registro ${row.__rowid}`
    if (!window.confirm(`¿Borrar este registro de «${table}»?\n\n${String(label).slice(0, 120)}\n\nSe guarda un respaldo antes de borrar, pero desde aquí no se puede deshacer.`)) return
    setError('')
    try { await api(`admin/db/${table}/${row.__rowid}`, 'DELETE', {}); setNotice('Registro borrado.'); setReload(n => n + 1); refreshCounts() } catch (e) { setError(e.message) }
  }
  return (
    <div className="ad-db">
      <aside className="ad-card ad-db-tables">
        <h2>Tablas</h2>
        {tables?.map(t => (
          <button key={t.name} type="button" className={table === t.name ? 'on' : ''} onClick={() => setTable(t.name)} title={t.description}>
            <span>{t.secret ? '🔒 ' : ''}{t.name}</span><em>{t.rows.toLocaleString('es-MX')}</em>
          </button>
        ))}
      </aside>
      <section className="ad-card ad-db-view">
        <div className="ad-card-head">
          <div><h2>{table}</h2><p className="ad-meta">{tables?.find(t => t.name === table)?.description}</p></div>
          {!data?.secret && <form onSubmit={e => { e.preventDefault(); setPage(1); setSearch(query.trim()) }}><input className="ad-search" type="search" value={query} onChange={e => { setQuery(e.target.value); if (!e.target.value) setSearch('') }} placeholder="Buscar en esta tabla y presiona Enter" /></form>}
        </div>
        {error && !cell && <p className="ad-error" role="alert">{error}</p>}
        {notice && <p className="ad-notice" role="status">{notice}</p>}
        {data && !data.secret && <p className="ad-meta">{data.readOnly ? 'Esta tabla es el registro de actividad: solo se puede consultar.' : '✏️ Da clic en cualquier celda para editarla. Antes de cada cambio se guarda un respaldo en server/data/backups y el cambio queda en Actividad.'}</p>}
        {data?.secret ? <p className="ad-empty">🔒 Esta tabla guarda datos secretos (sesiones o enlaces de acceso), así que no se muestra su contenido. Tiene {data.total.toLocaleString('es-MX')} registros.</p> : data && (
          <>
            {!!data.hidden.length && <p className="ad-meta">Columnas ocultas por seguridad: {data.hidden.join(', ')}.</p>}
            <div className="ad-db-scroll">
              <table className="ad-db-table">
                <thead><tr>{!data.readOnly && <th aria-label="Acciones" />}{data.columns.map(c => <th key={c}>{c}{data.locked?.includes(c) ? ' 🔒' : ''}</th>)}</tr></thead>
                <tbody>{data.rows.map(r => <tr key={r.__rowid}>
                  {!data.readOnly && <td className="ad-db-actions"><button type="button" title="Borrar registro" aria-label="Borrar registro" onClick={() => remove(r)}>🗑</button></td>}
                  {data.columns.map(c => { const v = show(r[c]); const text = v.length > 60 ? `${v.slice(0, 60)}…` : v
                    return <td key={c}>{editable(c) ? <button type="button" className="ad-db-cell" title="Editar" onClick={() => openCell(r, c)}>{text}</button> : v.length > 60 ? <button type="button" className="ad-db-more" onClick={() => { setCell({ row: r, column: c, view: true }); setDraft(pretty(r[c])) }}>{text}</button> : text}</td> })}
                </tr>)}</tbody>
              </table>
              {!data.rows.length && <p className="ad-empty">{search ? `Nada coincide con «${search}».` : 'Esta tabla está vacía.'}</p>}
            </div>
            <div className="ad-foot"><span>{data.filtered.toLocaleString('es-MX')} {data.filtered === 1 ? 'registro' : 'registros'}{search ? ` de ${data.total.toLocaleString('es-MX')}` : ''} · más recientes primero</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></div>
          </>
        )}
      </section>
      {cell && (
        <div className="ad-db-modal" role="dialog" aria-modal="true" aria-label={`Editar ${cell.column}`} onClick={() => !saving && setCell(null)}>
          <div onClick={e => e.stopPropagation()}>
            <div className="ad-card-head"><div><h2>{cell.view ? cell.column : `Editar ${cell.column}`}</h2><p className="ad-meta">{table} · {String(cell.row.title || cell.row.name || cell.row.email || cell.row.id || `registro ${cell.row.__rowid}`).slice(0, 80)}</p></div></div>
            {cell.view ? <pre>{draft}</pre> : (
              <>
                <textarea className="ad-db-edit" value={empty ? '' : draft} disabled={empty} onChange={e => setDraft(e.target.value)} rows={Math.min(22, Math.max(3, draft.split('\n').length + 1))} spellCheck="false" autoFocus />
                <label className="ad-db-null"><input type="checkbox" checked={empty} onChange={e => setEmpty(e.target.checked)} /> Dejar vacío (NULL)</label>
                {/^[[{]/.test(String(cell.row[cell.column] || '').trim()) && <p className="ad-meta">Este campo es JSON: conserva las comillas, comas y llaves.</p>}
                {error && <p className="ad-error" role="alert">{error}</p>}
              </>
            )}
            <div className="ad-row-btns ad-db-modal-actions">
              <button type="button" className="secondary" disabled={saving} onClick={() => { setCell(null); setError('') }}>{cell.view ? 'Cerrar' : 'Cancelar'}</button>
              {!cell.view && <button type="button" className="ad-btn approve" disabled={saving} onClick={save}>{saving ? 'Guardando…' : 'Guardar cambio'}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UsersAdmin({ users, me, onAction }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const filtered = useMemo(() => { const q = normalized(query.trim()); return users.filter(u => !q || normalized(`${u.name} ${u.email} ${u.role}`).includes(q)) }, [users, query])
  useEffect(() => setPage(1), [query])
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE)), current = Math.min(page, pages)
  return (
    <section className="ad-card">
      <div className="ad-card-head"><h2>Cuentas</h2><input className="ad-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre o correo" /></div>
      <div className="ad-table">
        {filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE).map(u => (
          <div className="ad-tr" key={u.id}>
            <span className="ad-avatar">{u.name.slice(0, 1).toUpperCase()}</span>
            <div className="ad-grow"><strong>{u.name}</strong><small>{u.email} · {u.role}{u.verified ? '' : ' · correo sin verificar'}{u.listings ? ` · ${u.activeListings}/${u.listings} publicaciones activas` : ''}</small></div>
            <span className={`ad-pill ${u.active ? 'activa' : 'suspendida'}`}>{u.active ? 'Activa' : 'Suspendida'}</span>
            <div className="ad-row-btns">
              {u.id !== me.id && (u.active
                ? <button type="button" className="ad-btn danger-outline" onClick={() => { if (window.confirm(`¿Suspender la cuenta de ${u.name}? Se cerrarán sus sesiones y se retirarán sus publicaciones.`)) onAction(`admin/users/${u.id}`, { active: false }, 'Cuenta suspendida.', 'PATCH') }}>Suspender</button>
                : <button type="button" className="secondary" onClick={() => onAction(`admin/users/${u.id}`, { active: true }, 'Cuenta reactivada. Sus publicaciones siguen retiradas hasta que el vendedor las vuelva a publicar.', 'PATCH')}>Reactivar</button>)}
            </div>
          </div>
        ))}
      </div>
      <div className="ad-foot"><span>{filtered.length} cuentas</span><Pagination page={current} pages={pages} onPage={setPage} /></div>
    </section>
  )
}

export default function AdminPanel({ user, onExit }) {
  const [tab, setTab] = useState('revision')
  const [summary, setSummary] = useState(null)
  const [queue, setQueue] = useState([])
  const [properties, setProperties] = useState([])
  const [users, setUsers] = useState([])
  const [audit, setAudit] = useState([])
  const [appointments, setAppointments] = useState([])
  const [reports, setReports] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [lookup, setLookup] = useState('')
  const [jump, setJump] = useState({ tab: '', query: '', n: 0 })
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)

  const load = useCallback(async () => {
    try {
      // Cada sección carga por separado: si una falla, el resto del panel sigue funcionando.
      const paths = ['admin/summary', 'admin/reviews', 'properties', 'admin/users', 'admin/audit', 'appointments', 'admin/reports', 'admin/metrics']
      const results = await Promise.allSettled(paths.map(path => api(path)))
      const [s, q, p, u, a, c, r, m] = results.map(x => x.status === 'fulfilled' ? x.value : undefined)
      if (s) setSummary(s); if (q) setQueue(q); if (p) setProperties(p); if (u) setUsers(u); if (a) setAudit(a); if (c) setAppointments(c); if (r) setReports(r); if (m) setMetrics(m)
      setNow(Date.now())
      const failed = results.find(x => x.status === 'rejected')
      if (failed) setError(/Ruta no encontrada/.test(failed.reason?.message) ? 'El servidor sigue con la versión anterior. Cierra la terminal de «npm.cmd run dev» y vuelve a ejecutarlo para activar Métricas y Reportes.' : failed.reason?.message || 'No se pudo cargar una sección del panel.')
      else setError('')
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load(); const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t) }, [load])

  async function act(path, body, message, method = 'POST') {
    setError(''); setNotice('')
    try { await api(path, method, body); setNotice(message); await load() } catch (e) { setError(e.message) }
  }
  const pending = queue.filter(i => i.status === 'pendiente')
  const decided = queue.filter(i => i.status !== 'pendiente')

  return (
    <div className="ad-shell">
      <aside className="ad-side">
        <div className="ad-brand"><span>CF</span><div><strong>CasaFast</strong><small>Administración</small></div></div>
        <nav>
          {[['metricas', 'Métricas'], ['revision', 'Documentación', pending.length], ['reportes', 'Reportes', reports.filter(r => r.status === 'abierto').length], ['citas', 'Citas'], ['publicaciones', 'Publicaciones'], ['cuentas', 'Cuentas'], ['actividad', 'Actividad'], ['basedatos', 'Base de datos']].map(([v, l, n]) => (
            <button key={v} type="button" className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}{n ? <em>{n}</em> : null}</button>
          ))}
        </nav>
        <div className="ad-me"><small>Sesión de</small><strong>{user.name}</strong><button type="button" className="text-button" onClick={onExit}>Salir del panel</button></div>
      </aside>
      <main className="ad-main">
        <header className="ad-top">
          <div><h1>{{ metricas: 'Métricas de CasaFast', reportes: 'Publicaciones reportadas', revision: 'Revisión de documentación', citas: 'Citas', publicaciones: 'Publicaciones', cuentas: 'Cuentas', actividad: 'Actividad reciente', basedatos: 'Base de datos' }[tab]}</h1><p>Tiempo de respuesta comprometido: 24 horas hábiles (lunes a viernes).</p></div>
          <div className="ad-top-actions">
            <form className="ad-lookup" onSubmit={e => {
              e.preventDefault()
              const q = lookup.trim().toUpperCase()
              if (!q) return
              const target = q.startsWith('PUB') ? 'publicaciones' : 'citas'
              setTab(target); setJump(j => ({ tab: target, query: q, n: j.n + 1 })); setError('')
              if (target === 'citas' && !appointments.some(a => a.code === q) && /^CITA-[0-9A-F]{8}$/.test(q)) setError(`No existe ninguna cita con el folio ${q}.`)
              if (target === 'publicaciones' && !properties.some(p => p.code === q) && /^PUB-[0-9A-F]{8}$/.test(q)) setError(`No existe ninguna publicación con el folio ${q}.`)
            }}>
              <input value={lookup} onChange={e => setLookup(e.target.value)} placeholder="Buscar folio: CITA-… o PUB-…" aria-label="Buscar folio" />
              <button type="submit" className="ad-btn approve">Buscar</button>
            </form>
            <button type="button" className="secondary" onClick={load}>↻ Actualizar</button>
          </div>
        </header>
        {summary && (
          <div className="ad-kpis">
            <div><strong>{summary.pending}</strong><span>Por revisar</span></div>
            <div className={summary.overdue ? 'late' : ''}><strong>{summary.overdue}</strong><span>Fuera de plazo</span></div>
            <div className={summary.soon ? 'late' : ''}><strong>{summary.soon ?? 0}</strong><span>Vencen en menos de 4 h</span></div>
            <div><strong>{summary.listings.toLocaleString('es-MX')}</strong><span>Publicaciones activas</span></div>
            <div><strong>{summary.held}</strong><span>Retiradas por CasaFast</span></div>
            <div><strong>{summary.users}</strong><span>Cuentas</span></div>
            <div><strong>{summary.suspended}</strong><span>Suspendidas</span></div>
          </div>
        )}
        {notice && <p className="ad-notice" role="status">{notice}</p>}
        {error && <p className="ad-error" role="alert">{error}</p>}

        {tab === 'revision' && (
          <>
            {pending.length ? pending.map(i => <ReviewCard key={i.propertyId} item={i} now={now} onDone={async m => { setNotice(m); await load() }} />)
              : <div className="ad-card ad-empty">✓ No hay publicaciones pendientes de revisión.</div>}
            {!!decided.length && <><h3 className="ad-sub">Decisiones de los últimos 30 días</h3>{decided.slice(0, 20).map(i => <ReviewCard key={i.propertyId} item={i} now={now} onDone={load} />)}</>}
          </>
        )}
        {tab === 'basedatos' && <DatabaseAdmin />}
        {tab === 'metricas' && <MetricsAdmin metrics={metrics} />}
        {tab === 'reportes' && <ReportsAdmin reports={reports} onAction={act} />}
        {tab === 'citas' && <AppointmentsAdmin key={`c-${jump.n}`} appointments={appointments} properties={properties} users={users} onCreated={async m => { setNotice(m); await load() }} initialQuery={jump.tab === 'citas' ? jump.query : ''} />}
        {tab === 'publicaciones' && <ListingsAdmin key={`p-${jump.n}`} properties={properties} onAction={act} initialQuery={jump.tab === 'publicaciones' ? jump.query : ''} />}
        {tab === 'cuentas' && <UsersAdmin users={users} me={user} onAction={act} />}
        {tab === 'actividad' && (
          <section className="ad-card">
            <ol className="ad-log">{audit.map((a, i) => <li key={i}><time>{when(a.created)}</time><strong>{a.actor || 'Sistema'}</strong><span>{a.action}</span><code>{a.target}</code></li>)}</ol>
            {!audit.length && <p className="ad-empty">Sin actividad registrada.</p>}
          </section>
        )}
      </main>
    </div>
  )
}
