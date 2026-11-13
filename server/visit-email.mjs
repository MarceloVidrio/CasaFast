import { emailLayout } from './email-layout.mjs'
const format = (date, options) => Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleString('es-MX', {timeZone:'America/Mazatlan',...options}) : ''
const safeLink = (value, map = false) => {
  try {
    const u = new URL(value)
    if (u.username || u.password) return ''
    if (map) return u.protocol === 'https:' && ((u.hostname === 'www.google.com' && u.pathname === '/maps/search/') || (u.hostname === 'maps.google.com' && u.pathname === '/' && u.searchParams.has('q'))) ? u.href : ''
    return u.protocol === 'https:' || u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname) ? u.href : ''
  } catch { return '' }
}

export function renderVisitEmail({ name, subject, text = '', visit, appUrl, logoSrc }) {
  const seller = visit?.recipientRole === 'seller'
  const event = visit?.event
  const labels = {
    Pendiente: [seller ? 'Tienes una visita por confirmar.' : 'Tu visita está por confirmar.', seller ? 'Solicitud recibida' : 'Esperando al vendedor', seller ? 'Revisa la solicitud en CasaFast para confirmar o proponer otro horario.' : 'Recibimos tu solicitud. Te avisaremos cuando el vendedor responda.'],
    Aceptada: ['Todo listo para tu visita.', 'Visita confirmada', 'La visita está confirmada. Guarda la fecha y revisa el domicilio antes de salir.'],
    Propuesta: [seller ? 'Propusiste un nuevo horario.' : 'El vendedor propone un nuevo horario.', 'Cambio por confirmar', seller ? 'El comprador debe aceptar el cambio. Mientras tanto se conserva el horario original.' : 'Acepta o rechaza el cambio desde tu cita. Si lo rechazas, se conserva tu horario original.'],
    Reprogramada: [seller ? 'El comprador reprogramó su visita.' : 'Tu visita se reprogramó.', 'Visita reprogramada', seller ? 'El comprador eligió un nuevo horario disponible. Consulta los detalles en CasaFast.' : 'Tu nuevo horario quedó registrado. Te esperamos.'],
    Cancelada: ['La visita se canceló.', 'Visita cancelada', 'Este horario ya no está reservado. Puedes consultar otras opciones en CasaFast.'],
    Rechazada: ['La solicitud no fue aceptada.', 'Solicitud rechazada', 'Puedes consultar otros horarios o explorar más propiedades en CasaFast.'],
    Vencida: ['La solicitud venció.', 'Solicitud vencida', 'El horario se liberó porque no se confirmó a tiempo. Puedes solicitar otra visita.'],
    Conservada: ['Tu horario sigue confirmado.', 'Horario conservado', 'El cambio no se aplicó. Se mantiene el horario que ya estaba confirmado.'],
    Recordatorio24: [seller ? 'Mañana tienes una visita.' : '¡Tu visita es mañana!', 'Recordatorio', seller ? 'Te recordamos la visita confirmada de mañana. Ten lista la propiedad y llega unos minutos antes.' : 'Te recordamos tu visita confirmada. Revisa el domicilio y planea tu traslado con tiempo. Hoy es el último momento para reprogramar o cancelar.'],
    Recordatorio2: [seller ? 'Tu visita es en 2 horas.' : 'Tu visita es en 2 horas.', 'Casi es hora', seller ? 'El comprador llegará pronto. ¡Mucho éxito!' : 'Ya casi es hora. Abre la ubicación exacta para llegar sin contratiempos. ¡Que te encante!']
  }
  const [heading, status, description] = labels[event] || [subject, 'Tus visitas', 'Consulta el estado de tu visita en CasaFast.']
  const pending = ['Pendiente','Propuesta'].includes(event)
  const map = visit?.confirmed && safeLink(visit.mapUrl, true)
  const app = safeLink(appUrl)
  // Enlace directo a la cita: abre CasaFast en la página de esa visita.
  const visitLink = app && visit?.appointmentId ? (() => { try { const u = new URL(app); u.search = `?cita=${encodeURIComponent(visit.appointmentId)}`; u.hash = ''; return u.href } catch { return '' } })() : ''
  const visitLabel = seller ? 'Ver solicitud' : 'Ver mi cita'
  const date = format(visit?.date, {weekday:'long',day:'numeric',month:'long',year:'numeric'})
  const time = format(visit?.date, {hour:'numeric',minute:'2-digit',hour12:true})
  const deadline = format(visit?.deadline, {dateStyle:'medium',timeStyle:'short'})
  const fallback = !visit ? String(text).split('\n').filter((line,i) => !(i === 0 && line === 'CasaFast') && line !== subject).join('\n').trim() : ''
  const tone = ['Cancelada','Rechazada','Vencida'].includes(event) ? 'danger' : pending ? 'warning' : ['Aceptada','Reprogramada','Conservada','Recordatorio24','Recordatorio2'].includes(event) ? 'success' : 'info'
  const icons = { Pendiente: seller ? '🔔' : '📅', Aceptada: '🎉', Propuesta: '🔁', Reprogramada: '🔄', Cancelada: '❌', Rechazada: '🙁', Vencida: '⌛', Conservada: '✅', Recordatorio24: '⏰', Recordatorio2: '🚗' }
  const notes = []
  if (pending && deadline) notes.push(`${event === 'Pendiente' ? 'La solicitud puede confirmarse hasta el' : 'Responde a la propuesta antes del'} ${deadline} (hora de Culiacán). ${event === 'Pendiente' ? 'Si no se confirma, se liberará el horario.' : 'Consulta en CasaFast qué horario se conservará si el cambio vence.'}`)
  if (!seller && ['Pendiente','Aceptada','Reprogramada','Conservada'].includes(event)) notes.push('Recuerda: puedes reprogramar o cancelar tu visita hasta 12 horas antes. Después de eso ya no se puede mover.')
  if (fallback) notes.push(...fallback.split('\n').filter(Boolean))
  const html = emailLayout({
    subject, logoSrc, tone, icon: icons[event] || '🏡', badge: status, heading, name,
    preheader: [status, visit?.title, date].filter(Boolean).join(' · '),
    intro: description,
    highlight: visit && date ? { label: event === 'Propuesta' ? 'Horario propuesto' : 'Fecha y hora', value: `${date[0].toUpperCase()}${date.slice(1)} · ${time}`, sub: 'Hora de Culiacán, Sinaloa · 60 minutos' } : null,
    details: visit ? [['Propiedad', visit.title], ['Domicilio', map ? visit.address : ''], ['Folio de tu cita', visit.code]] : [],
    notes,
    cta: visitLink ? { href: visitLink, label: visitLabel } : app ? { href: app, label: 'Abrir CasaFast' } : null,
    ctaHint: !visitLink ? '' : ['Cancelada','Rechazada','Vencida'].includes(event) ? 'Consulta el detalle y, si quieres, agenda otro horario en CasaFast.' : seller ? 'Confirma, propón otro horario o cancela desde ahí.' : 'Consulta el estado de tu visita y reprográmala si lo necesitas.',
    secondary: map ? { href: map, label: '📍 Ver ubicación exacta' } : null,
    footer: 'Recibes este aviso por una visita agendada en CasaFast. También puedes verla en Mi espacio → Mis visitas.'
  })
  return {html}
}
