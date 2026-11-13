import { useEffect, useRef, useState } from 'react'
import { api } from './lib'
import './Trust.css'

/* Vendedor verificado (documentación aprobada por CasaFast) y calificación de sus visitas. */
export function SellerTrust({ p, compact = false }) {
  if (!p?.sellerVerified && !p?.sellerRating) return null
  const r = p.sellerRating
  if (compact) return (
    <span className="trust-compact">
      {p.sellerVerified && <span className="trust-verified" title="CasaFast revisó los documentos de este vendedor">✓ Verificado</span>}
      {r && <span className="trust-stars" title={`${r.avg} de 5 en ${r.count} ${r.count === 1 ? 'visita' : 'visitas'}`}>★ {r.avg.toFixed(1)}</span>}
    </span>
  )
  return (
    <div className="trust-box">
      {p.sellerVerified && (
        <div className="trust-row">
          <span className="trust-icon ok" aria-hidden="true">✓</span>
          <div><strong>Vendedor verificado</strong><p>CasaFast revisó su identificación y los documentos de la propiedad.</p></div>
        </div>
      )}
      {r && (
        <div className="trust-row">
          <span className="trust-icon star" aria-hidden="true">★</span>
          <div><strong>{r.avg.toFixed(1)} de 5</strong><p>Calificación de {r.count} {r.count === 1 ? 'persona que ya visitó' : 'personas que ya visitaron'} sus propiedades.</p></div>
        </div>
      )}
    </div>
  )
}

/* Cuenta una vista del detalle (una por persona y día). */
export function useViewTracking(propertyId, enabled) {
  useEffect(() => {
    if (!enabled || !propertyId) return
    let visitor = ''
    try {
      visitor = localStorage.getItem('casafast_visitor') || ''
      if (!visitor) { visitor = crypto.randomUUID(); localStorage.setItem('casafast_visitor', visitor) }
    } catch { visitor = '' }
    api(`properties/${propertyId}/view`, 'POST', { visitor }).catch(() => {})
  }, [propertyId, enabled])
}

const REASONS = [
  ['fraude', 'Parece fraude o pide dinero por adelantado'],
  ['fotos', 'Las fotos no corresponden a la propiedad'],
  ['vendida', 'Ya se vendió o rentó'],
  ['datos', 'Precio o datos incorrectos'],
  ['otro', 'Otro motivo']
]

/* Reportar publicación: formulario breve en un diálogo. */
export function ReportButton({ property, user, onLogin, onNotice }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef(null)
  useEffect(() => { if (open) dialog.current?.showModal?.(); else dialog.current?.close?.() }, [open])
  if (user?.id === property.sellerId) return null

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await api('reports', 'POST', { propertyId: property.id, reason, detail })
      setOpen(false); setReason(''); setDetail('')
      onNotice?.('Gracias por avisarnos. Nuestro equipo revisará la publicación.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <>
      <button type="button" className="report-link" onClick={() => user ? setOpen(true) : onLogin?.()}>
        <span aria-hidden="true">⚑</span> Reportar publicación
      </button>
      {open && (
        <dialog ref={dialog} className="report-dialog" onClose={() => setOpen(false)} aria-labelledby="report-title">
          <form onSubmit={submit}>
            <h3 id="report-title">¿Qué ocurre con esta publicación?</h3>
            <p>Tu reporte es anónimo para el vendedor. Lo revisa el equipo de CasaFast.</p>
            <div className="report-options" role="radiogroup" aria-label="Motivo">
              {REASONS.map(([value, label]) => (
                <label key={value} className={reason === value ? 'selected' : ''}>
                  <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
                  {label}
                </label>
              ))}
            </div>
            <label className="report-detail">
              Detalles {reason === 'otro' ? '(obligatorio)' : '(opcional)'}
              <textarea value={detail} onChange={e => setDetail(e.target.value)} maxLength={600} rows={3} placeholder="Cuéntanos lo que viste" />
            </label>
            {error && <p role="alert" className="error">{error}</p>}
            <div className="report-actions">
              <button type="button" className="text-button" onClick={() => setOpen(false)}>Cancelar</button>
              <button className="primary" disabled={busy || !reason}>{busy ? 'Enviando…' : 'Enviar reporte'}</button>
            </div>
          </form>
        </dialog>
      )}
    </>
  )
}
