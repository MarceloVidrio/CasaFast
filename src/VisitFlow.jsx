import { useEffect, useState } from 'react'
import { api } from './lib'
import './Visits.css'

const timezone = 'America/Mazatlan'
const visitDate = value => new Date(value).toLocaleString('es-MX', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' })
const localDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
const today = () => localDay(Date.now())
const time = value => new Date(value).toLocaleTimeString('es-MX', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: true })

function useSlots(propertyId) {
  const [data, setData] = useState(null), [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let alive = true
    api(`visit-slots/${propertyId}`).then(result => { if (alive) { setData(result); setError('') } }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [propertyId, version])
  return { data, error, reload: () => setVersion(n => n + 1) }
}

function SlotPicker({ slots, value, onChange, open }) {
  const [day, setDay] = useState('')
  const available = slots.filter(s => s.available)
  const days = [...new Set(available.map(s => localDay(s.date)))]
  const selectedDay = days.includes(day) ? day : days[0] || ''
  return <div className="slot-picker">
    <p className="visit-help">Horarios de Culiacán, Sinaloa · Cada visita dura 60 minutos.</p>
    {open && <p className="visit-open-note">Agenda abierta: elige la hora que te convenga (9:00 a 18:00) y el vendedor la confirmará o te propondrá otra.</p>}
    {!days.length ? <div className="visit-empty">El vendedor todavía no tiene horarios disponibles. Vuelve a consultar más tarde.</div> : <>
      <label>Día de la visita<select value={selectedDay} onChange={e => { setDay(e.target.value); onChange('') }}>{days.map(d => <option key={d} value={d}>{new Date(`${d}T12:00:00-07:00`).toLocaleDateString('es-MX', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' })}</option>)}</select></label>
      <div className="slot-grid" role="group" aria-label="Horarios disponibles">{available.filter(s => localDay(s.date) === selectedDay).map(s => <button type="button" key={s.id} className={`slot-choice ${value === s.id ? 'selected' : ''}`} aria-pressed={value === s.id} onClick={() => onChange(s.id)}>{time(s.date)}</button>)}</div>
    </>}
  </div>
}

export function AppointmentBooking({ property, onSuccess }) {
  const { data, error: loadError, reload } = useSlots(property.id)
  const [slotId, setSlotId] = useState(''), [message, setMessage] = useState('')
  const [consent, setConsent] = useState(false), [phone, setPhone] = useState('')
  const [review, setReview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const selected = data?.slots.find(s => s.id === slotId && s.available)
  async function submit(e) {
    e.preventDefault(); setError('')
    if (!selected) { setError('Selecciona un horario disponible.'); setReview(false); return }
    if (consent && !/^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s()-]/g, ''))) { setError('Revisa tu número con código de país. Ejemplo: +526671234567.'); return }
    if (!review) { setReview(true); return }
    setBusy(true)
    try { await api('appointments', 'POST', { propertyId: property.id, slotId, message, whatsappConsent: consent, phone }); await onSuccess() }
    catch (e) { setError(e.message); setReview(false); reload() }
    finally { setBusy(false) }
  }
  return <form className="visit-booking" onSubmit={submit}>
    <span className="eyebrow">{review ? '02 · REVISA TU SOLICITUD' : '01 · ELIGE TU VISITA'}</span>
    <h3>{review ? 'Todo listo para solicitarla.' : 'Conoce tu próximo hogar.'}</h3>
    {review && selected ? <div className="visit-summary"><strong>{property.title}</strong><p>{visitDate(selected.date)} · Culiacán</p><p>Duración: 60 minutos</p><p>{consent ? `Avisos de WhatsApp: ${phone}` : 'Seguimiento en Mis visitas y avisos por correo según disponibilidad del servicio.'}</p><p>El vendedor debe aceptar. La solicitud vence a las 48 horas o al comenzar la visita.</p><button type="button" className="text-button" onClick={() => setReview(false)}>Cambiar datos</button></div> : <>
      {data?.vacation && <p className="visit-vacation-note">🌴 El vendedor estará de vacaciones del {new Date(`${data.vacation.start}T12:00:00-07:00`).toLocaleDateString('es-MX', { timeZone: timezone, day: 'numeric', month: 'long' })} al {new Date(`${data.vacation.end}T12:00:00-07:00`).toLocaleDateString('es-MX', { timeZone: timezone, day: 'numeric', month: 'long' })}. Esos días no aparecen en la agenda.</p>}
      {data ? <SlotPicker slots={data.slots} open={data.open} value={slotId} onChange={setSlotId} /> : !loadError && <p role="status">Consultando disponibilidad…</p>}
      <label>¿Qué te gustaría preguntar? <small>(opcional)</small><textarea rows="3" value={message} maxLength="1500" onChange={e => setMessage(e.target.value)} placeholder="Cuéntale al vendedor qué te interesa conocer." /></label>
      <label className="visit-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>Quiero recibir por WhatsApp los avisos de esta visita y, al confirmarse, su dirección y ubicación exacta. Confirmo que el número es mío.</span></label>
      {consent && <label>Tu número de WhatsApp<input type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+526671234567" required maxLength="24" /><small>Incluye +52 y los 10 dígitos si es un número de México. Verifícalo antes de enviar.</small></label>}
      {data?.whatsapp.whatsappMode === 'preview' && <p className="visit-help">WhatsApp está en prueba local: se guarda una vista previa y no se envían mensajes reales.</p>}
      {data && !data.whatsapp.whatsappEnabled && <p className="visit-help">El envío de WhatsApp todavía no está activado. Puedes solicitar tu visita y seguirla en Mis visitas.</p>}
    </>}
    {(error || loadError) && <p role="alert" className="error">{error || loadError}</p>}
    <button className="primary" disabled={busy || !selected}>{busy ? 'Enviando…' : review ? 'Enviar solicitud de visita' : 'Revisar solicitud'} →</button>
  </form>
}

export function AvailabilityEditor({ property, onClose }) {
  const { data, error: loadError, reload } = useSlots(property.id)
  const [day, setDay] = useState(today()), [start, setStart] = useState('10'), [end, setEnd] = useState('14')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  async function act(fn, message) { setBusy(true); setError(''); setNotice(''); try { await fn(); reload(); setNotice(message) } catch (e) { setError(e.message) } finally { setBusy(false) } }
  function add(e) {
    e.preventDefault()
    if (+end <= +start) { setError('La hora final debe ser posterior a la inicial.'); return }
    const dates = Array.from({ length: +end - +start }, (_, n) => new Date(`${day}T${String(+start + n).padStart(2,'0')}:00:00-07:00`).toISOString())
    act(() => api(`visit-slots/${property.id}`, 'POST', { dates }), 'Horarios publicados. Ya pueden elegirlos los compradores.')
  }
  return <section className="page narrow visits-page"><button className="text-button" onClick={onClose}>← Volver a mi espacio</button><span className="eyebrow">TU DISPONIBILIDAD</span><h1>Abre un espacio en tu agenda.</h1><p>{property.title}</p><p>Las visitas duran una hora. Los horarios se bloquean también en tus otras propiedades para evitar cruces.</p>
    <form className="editor" onSubmit={add}><h2>Publicar horarios</h2><p>Hora de Culiacán, Sinaloa, aunque tu dispositivo esté en otra ciudad.</p><div className="form-grid"><label>Día<input type="date" min={today()} required value={day} onChange={e => setDay(e.target.value)} /></label><label>Desde<select value={start} onChange={e => setStart(e.target.value)}>{Array.from({ length: 17 }, (_, i) => i + 6).map(h => <option key={h} value={h}>{h}:00</option>)}</select></label><label>Hasta<select value={end} onChange={e => setEnd(e.target.value)}>{Array.from({ length: 17 }, (_, i) => i + 7).map(h => <option key={h} value={h}>{h}:00</option>)}</select></label></div><p>Ejemplo: de 10:00 a 13:00 publica visitas a las 10:00, 11:00 y 12:00.</p><button className="primary" disabled={busy}>Publicar horarios</button></form>
    {(error || loadError) && <p className="error" role="alert">{error || loadError}</p>}{notice && <p role="status" className="info-box">{notice}</p>}
    <h2>Horarios publicados</h2>{data && !data.slots.some(s => !s.open) && <p>No hay horarios publicados todavía. Mientras tanto la propiedad usa <strong>agenda abierta</strong>: los compradores pueden pedir cualquier hora libre de 9:00 a 18:00 y tú confirmas. Al publicar horarios, solo se ofrecerán esos.</p>}
    <div className="availability-list">{data?.slots.filter(s => !s.open).map(s => <div key={s.id}><span>{visitDate(s.date)} · {s.available ? 'Disponible' : 'Reservado o cerrado'}</span><button type="button" className="text-button" disabled={busy || !s.available} onClick={() => act(() => api(`visit-slots/${property.id}/${s.id}`, 'DELETE', {}), 'Horario retirado.')}>Retirar horario</button></div>)}</div>
  </section>
}

// Comprador: «Reprogramar» aplica el cambio al instante si el horario está libre (mín. 12 h).
// Vendedor: «Solicitar cambio» envía una propuesta que el comprador debe aceptar.
function Reschedule({ appointment, mode, onChange, onClose }) {
  const { data, error: loadError } = useSlots(appointment.property_id)
  const [slotId, setSlotId] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const direct = mode === 'buyer'
  const minTime = Date.now() + (direct ? 12 : 1) * 3600000
  const slots = data ? data.slots.filter(s => s.available && Date.parse(s.date) >= minTime && s.date !== appointment.date) : []
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { await onChange(direct ? 'Reprogramar' : 'Propuesta', { slotId }); onClose() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <form className="visit-reschedule" onSubmit={submit}>
    <h4>{direct ? 'Elige tu nuevo horario' : 'Solicitar cambio de horario'}</h4>
    <p>{direct ? 'Si el horario está libre, el cambio se aplica al instante y se avisa al vendedor. Solo se muestran horarios con al menos 12 horas de anticipación.' : `El comprador debe aceptar el cambio.${appointment.status === 'Aceptada' ? ' Mientras tanto, la visita original sigue confirmada.' : ''}`}</p>
    {data && <SlotPicker slots={slots} open={!direct && data.open} value={slotId} onChange={setSlotId} />}
    {(error || loadError) && <p role="alert" className="error">{error || loadError}</p>}
    <div className="actions"><button type="button" className="secondary" onClick={onClose}>Volver</button><button className="primary" disabled={busy || !slotId}>{busy ? 'Guardando…' : direct ? 'Confirmar nuevo horario' : 'Enviar solicitud de cambio'}</button></div>
  </form>
}

function calendar(a) {
  const stamp = date => new Date(date).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')
  const escape = s => String(s || '').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')
  const content = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CasaFast//Visitas//ES','BEGIN:VEVENT',`UID:${a.id}@casafast.local`,`DTSTAMP:${stamp(Date.now())}`,`DTSTART:${stamp(a.date)}`,`DTEND:${stamp(Date.parse(a.date)+3600000)}`,`SUMMARY:${escape('Visita · '+a.title)}`,`LOCATION:${escape(a.confirmed_address)}`,`DESCRIPTION:${escape(a.confirmed_map)}`,'END:VEVENT','END:VCALENDAR'].join('\r\n')
  const url = URL.createObjectURL(new Blob([content], { type:'text/calendar;charset=utf-8' })), link = document.createElement('a')
  link.href=url; link.download='visita-casafast.ics'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function VisitCard({ appointment: a, property, user, onRefresh }) {
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const seller = a.sellerId === user.id, participant = seller || a.buyer_id === user.id
  const canMove = Date.parse(a.date) - now >= 12 * 3600000
  const future = Date.parse(a.date) > now, active = ['Pendiente','Aceptada','Propuesta'].includes(a.status) && (future || Date.parse(a.proposed_date)>now)
  async function change(status, extra = {}) { await api(`appointments/${a.id}`, 'PATCH', { status, revision:a.revision, ...extra }); await onRefresh() }
  async function action(fn) { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e.message); await onRefresh() } finally { setBusy(false) } }
  const statusLabel = a.status === 'Pendiente' ? (seller ? 'Por confirmar' : 'Esperando al vendedor') : a.status === 'Aceptada' ? 'Visita confirmada' : a.status === 'Propuesta' ? 'Cambio por confirmar' : a.status
  const eventLabel = event => ({ Pendiente: seller ? 'Solicitud recibida' : 'Solicitud enviada', Aceptada: 'Visita confirmada', Propuesta: 'Cambio de horario solicitado', Reprogramada: 'Visita reprogramada por el comprador', Conservada: 'Horario original conservado', Rechazada: 'Solicitud rechazada', Cancelada: 'Visita cancelada', Vencida: 'Solicitud vencida', 'Asistió': 'El comprador asistió', 'No se presentó': 'El comprador no se presentó', Calificada: 'Visita calificada' })[event] || event
  const dateLabel = new Date(a.date).toLocaleDateString('es-MX', { timeZone: timezone, weekday:'long', day:'numeric', month:'long', year:'numeric' })
  return <article className="visit-card" aria-label={`Visita a ${a.title}`}>
    <div className="visit-card-head">
      <div className="visit-property-heading">
        {property?.images?.[0] ? <img className="visit-property-photo" src={property.images[0]} alt={a.title} loading="lazy" /> : <div className="visit-photo-placeholder" aria-hidden="true">⌂</div>}
        <div><span className="visit-overline">{seller ? `Solicitud de ${a.buyerName}` : future ? 'Tu próxima visita' : 'Tu visita'}</span><h3>{a.title}</h3>{property?.location && <p className="visit-neighborhood">{property.location}</p>}{a.code && <span className="folio" title="Folio de la cita">Folio {a.code}</span>}</div>
      </div>
      <span className={`visit-state ${a.status}`}><span aria-hidden="true" />{statusLabel}</span>
    </div>
    <div className="visit-overview">
      <div className="visit-date-block"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/></svg><div><span className="visit-overline">Fecha y hora</span><p className="visit-day">{dateLabel}</p><p className="visit-hour">{time(a.date)} <span>· 60 min</span></p><small>Hora de Culiacán, Sinaloa</small></div></div>
      {a.message && <div className="visit-buyer-message"><span className="visit-overline">{seller ? 'Mensaje del comprador' : 'Tu mensaje al vendedor'}</span><p>{a.message}</p></div>}
    </div>
    {a.status === 'Pendiente' && <div className="visit-pending-note"><span className="visit-note-dot" aria-hidden="true"/><div><strong>{seller ? 'Tu confirmación es el siguiente paso.' : 'El vendedor debe confirmar tu solicitud.'}</strong>{a.hold_until && <p>Si el vendedor no confirma antes del {visitDate(a.hold_until)}, se liberará el horario.</p>}</div></div>}
    {a.status === 'Propuesta' && <div className="visit-summary"><strong>Horario propuesto: {visitDate(a.proposed_date)}</strong><p>{a.proposed_by === user.id ? 'Esperando respuesta de la otra persona.' : 'Revisa y acepta o rechaza este cambio.'}{a.previous_status === 'Aceptada' ? ' El horario original sigue confirmado hasta aceptar el cambio.' : ''}</p><p>La propuesta vence: {visitDate(a.hold_until)}.</p></div>}
    {(a.status === 'Aceptada' || a.status === 'Propuesta' && a.previous_status === 'Aceptada') && a.confirmed_map && <div className="visit-location"><strong>Domicilio de la visita</strong><p>{a.confirmed_address}</p><a href={a.confirmed_map} target="_blank" rel="noreferrer">Abrir ubicación exacta en Google Maps ↗</a><button type="button" className="text-button" onClick={() => calendar(a)}>Agregar a mi calendario</button></div>}
    {error && <p role="alert" className="error">{error}</p>}
    {participant && active && <div className="actions visit-actions">
      {a.status === 'Pendiente' && seller && <><button className="primary" disabled={busy} onClick={() => action(() => change('Aceptada'))}>Confirmar visita</button><button className="secondary" disabled={busy} onClick={() => action(() => change('Rechazada'))}>Rechazar solicitud</button></>}
      {a.status === 'Propuesta' && a.proposed_by !== user.id && <><button className="primary" disabled={busy} onClick={() => action(() => change('Aceptada'))}>Aceptar nuevo horario</button><button className="secondary" disabled={busy} onClick={() => action(() => change('Conservar'))}>Rechazar cambio</button></>}
      {a.status !== 'Propuesta' && !seller && canMove && <button className="secondary" disabled={busy} onClick={() => setEditing(v => !v)}>Reprogramar</button>}
      {a.status !== 'Propuesta' && seller && <button className="secondary" disabled={busy} onClick={() => setEditing(v => !v)}>Solicitar cambio de horario</button>}
      {(seller || canMove) && <button className="text-button" disabled={busy} onClick={() => { if (window.confirm(seller ? '¿Cancelar esta visita? Se avisará al comprador y se liberará el horario.' : '¿Cancelar esta visita? Se avisará al vendedor y se liberará el horario.')) action(() => change('Cancelada')) }}>Cancelar visita</button>}
    </div>}
    {participant && active && !seller && <div className={`visit-policy${canMove ? '' : ' closed'}`} role="note">
      <span className="visit-policy-icon" aria-hidden="true">{canMove ? '🕒' : '⏰'}</span>
      <div>
        <strong>{canMove ? 'Puedes reprogramar o cancelar hasta 12 horas antes' : 'Ya no se puede reprogramar ni cancelar'}</strong>
        <p>{canMove
          ? `Tienes hasta el ${visitDate(new Date(Date.parse(a.date) - 12 * 3600000).toISOString())} para hacer cambios. Después de esa hora la visita ya no se puede mover ni cancelar desde CasaFast.`
          : 'Faltan menos de 12 horas para tu visita. Si tienes un imprevisto, responde al correo de tu cita y te ayudamos a avisarle al vendedor.'}</p>
      </div>
    </div>}
    {participant && <AfterVisit a={a} seller={seller} now={now} onDone={onRefresh} />}
    {editing && active && a.status !== 'Propuesta' && <Reschedule appointment={a} mode={seller ? 'seller' : 'buyer'} onChange={change} onClose={() => setEditing(false)} />}
    <div className="visit-card-footer">
      {!!a.history.length && <details className="visit-notices"><summary>Historial de la visita <span aria-hidden="true">＋</span></summary><ol className="visit-timeline">{a.history.map((e,i) => <li key={i}><strong>{eventLabel(e.event)}</strong><time dateTime={e.created}>{visitDate(e.created)}</time>{e.detail && <p>{e.detail}</p>}</li>)}</ol></details>}
    </div>
  </article>
}

/* Después de la visita: el vendedor registra asistencia y el comprador califica. */
function AfterVisit({ a, seller, now, onDone }) {
  const [stars, setStars] = useState(0)
  const [hover, setHover] = useState(0)
  const [sellerArrived, setSellerArrived] = useState(null)
  const [matched, setMatched] = useState(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const passed = a.status === 'Aceptada' && Date.parse(a.date) <= now
  const recent = now - Date.parse(a.date) < 30 * 86400000
  if (!passed) return null
  async function run(fn) { setBusy(true); setError(''); try { await fn(); await onDone() } catch (e) { setError(e.message) } finally { setBusy(false) } }

  if (seller) {
    if (a.attendance) return <div className={`after-visit done ${a.attendance}`}><span aria-hidden="true">{a.attendance === 'asistio' ? '✅' : '🚫'}</span><p>{a.attendance === 'asistio' ? 'Registraste que el comprador asistió.' : 'Registraste que el comprador no se presentó.'}{a.rating && ` Te calificó con ${a.rating.stars} de 5 estrellas.`}</p></div>
    if (!recent) return null
    return <div className="after-visit">
      <span className="after-visit-icon" aria-hidden="true">📋</span>
      <div>
        <strong>¿El comprador llegó a la visita?</strong>
        <p>Esto nos ayuda a cuidar tu agenda: quien falta a 3 visitas en 90 días no puede agendar por un tiempo.</p>
        <div className="after-visit-actions">
          <button className="primary" disabled={busy} onClick={() => run(() => api(`appointments/${a.id}/attendance`, 'POST', { attended: true }))}>Sí, asistió</button>
          <button className="secondary" disabled={busy} onClick={() => run(() => api(`appointments/${a.id}/attendance`, 'POST', { attended: false }))}>No se presentó</button>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </div>
  }

  if (a.rating) return <div className="after-visit done"><span aria-hidden="true">⭐</span><p>Calificaste esta visita con {a.rating.stars} de 5 estrellas. ¡Gracias por ayudar a otros compradores!</p></div>
  if (a.attendance === 'no_asistio' || !recent) return null
  return <form className="after-visit rating" onSubmit={e => { e.preventDefault(); run(() => api(`appointments/${a.id}/rating`, 'POST', { stars, sellerArrived, matched, comment })) }}>
    <span className="after-visit-icon" aria-hidden="true">⭐</span>
    <div>
      <strong>¿Qué tal estuvo tu visita?</strong>
      <p>Tu opinión ayuda a otros compradores a elegir con confianza.</p>
      <div className="rating-stars" role="radiogroup" aria-label="Calificación" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map(n => <button type="button" key={n} role="radio" aria-checked={stars === n} aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`} className={(hover || stars) >= n ? 'on' : ''} onMouseEnter={() => setHover(n)} onClick={() => setStars(n)}>★</button>)}
      </div>
      <fieldset className="rating-question"><legend>¿El vendedor llegó a tiempo?</legend>
        <button type="button" className={sellerArrived === true ? 'selected' : ''} onClick={() => setSellerArrived(true)}>Sí</button>
        <button type="button" className={sellerArrived === false ? 'selected' : ''} onClick={() => setSellerArrived(false)}>No</button>
      </fieldset>
      <fieldset className="rating-question"><legend>¿La casa coincide con las fotos?</legend>
        <button type="button" className={matched === true ? 'selected' : ''} onClick={() => setMatched(true)}>Sí</button>
        <button type="button" className={matched === false ? 'selected' : ''} onClick={() => setMatched(false)}>No</button>
      </fieldset>
      <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={500} rows={2} placeholder="Comentario opcional" aria-label="Comentario opcional" />
      {error && <p role="alert" className="error">{error}</p>}
      <button className="primary" disabled={busy || !stars || sellerArrived === null || matched === null}>{busy ? 'Enviando…' : 'Enviar calificación'}</button>
    </div>
  </form>
}
