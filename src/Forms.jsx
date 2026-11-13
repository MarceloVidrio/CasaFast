import { useEffect, useState } from 'react'
import { api, readImage } from './lib'
import LocationPicker from './LocationPicker'

const MAX_DOC_MB = 6
const sizeLabel = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

// Documentación que demuestra que la propiedad está en regla.
// El servidor define qué documentos son obligatorios según la operación y el tipo, y lo vuelve a validar al guardar.
function DocumentsSection({ property, operation, type, docs, setDocs, onBusy }) {
  const [catalog, setCatalog] = useState(null)
  const [review, setReview] = useState(property?.review || null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState('')

  useEffect(() => {
    let alive = true
    api('documents/requirements').then(r => { if (alive) setCatalog(r) }).catch(e => alive && setError(e.message))
    if (property?.id) api(`properties/${property.id}/documents`).then(r => {
      if (!alive) return
      setReview(r.review)
      setDocs(Object.fromEntries(r.documents.map(d => [d.kind, { ...d, existing: true }])))
    }).catch(() => {})
    return () => { alive = false }
  }, [property?.id, setDocs])

  if (!catalog) return <p role="status">Cargando requisitos de documentación…</p>
  const { rules } = catalog
  const required = new Set(type === 'Terreno' ? (operation === 'venta' ? rules.terreno : rules.renta.filter(k => k !== 'agua')) : rules[operation] || rules.venta)

  async function upload(kind, file) {
    setError('')
    if (!file) return
    if (file.size > MAX_DOC_MB * 1048576) { setError(`Cada documento debe pesar máximo ${MAX_DOC_MB} MB.`); return }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) { setError('Sube el documento en PDF, JPG o PNG.'); return }
    setUploading(kind); onBusy(true)
    try {
      const result = await api('documents', 'POST', { kind, name: file.name, file: await readImage(file) })
      setDocs(old => ({ ...old, [kind]: { ...result, existing: false } }))
    } catch (e) { setError(e.message) } finally { setUploading(''); onBusy(false) }
  }

  const missing = catalog.documents.filter(d => required.has(d.kind) && !docs[d.kind])
  return (
    <div className="docs-section">
      <h2>04 <span>Documentación de la propiedad</span></h2>
      <p className="docs-intro">Para proteger a los compradores, revisamos que cada propiedad esté en regla antes de publicarla. Tus documentos son <strong>privados</strong>: solo los ve el equipo de revisión de CasaFast.</p>
      {review?.status === 'rechazada' && <div className="docs-alert error"><strong>Necesita correcciones:</strong> {review.note}</div>}
      {review?.status === 'pendiente' && <div className="docs-alert">Tu documentación está en revisión. Si subes un documento nuevo, se revisará de nuevo.</div>}
      <ul className="docs-list">
        {catalog.documents.map(d => {
          const have = docs[d.kind], need = required.has(d.kind)
          return (
            <li key={d.kind} className={have ? 'done' : need ? 'todo' : ''}>
              <span className="docs-check" aria-hidden="true">{have ? '✓' : need ? '!' : '+'}</span>
              <div className="docs-text">
                <strong>{d.label} {need ? <em className="docs-tag req">Obligatorio</em> : <em className="docs-tag">Opcional</em>}</strong>
                <small>{d.hint}</small>
                {have && <small className="docs-file">{have.name || 'Documento'}{have.size ? ` · ${sizeLabel(have.size)}` : ''} · {have.existing ? 'ya enviado' : 'listo para enviar'}</small>}
              </div>
              <label className="docs-upload">
                {uploading === d.kind ? 'Subiendo…' : have ? 'Reemplazar' : 'Subir archivo'}
                <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={!!uploading} onChange={e => { const file = e.target.files[0]; e.target.value = ''; upload(d.kind, file) }} />
              </label>
            </li>
          )
        })}
      </ul>
      <p className="docs-foot">{catalog.formats} · máximo {catalog.maxMb} MB por archivo. {missing.length ? `Faltan ${missing.length} ${missing.length === 1 ? 'documento obligatorio' : 'documentos obligatorios'}.` : 'Documentación completa.'}</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="docs-review-note"><strong>⏱ Revisión en máximo 24 horas hábiles.</strong> Tu publicación quedará <em>en revisión</em> y aparecerá en el catálogo en cuanto aprobemos la documentación. Te avisaremos por correo.</div>
    </div>
  )
}

export function PropertyForm({ property, onSave, onCancel }) {
  const [location, setLocation] = useState({ lat: property?.lat, lng: property?.lng, locationDetails: property?.locationDetails || {}, locationToken: '', locationValidated: property?.locationVerification?.provider === 'google' })
  const [images, setImages] = useState(property?.images || []), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState('')
  const [operation, setOperation] = useState(property?.operation || 'venta')
  const [type, setType] = useState(property?.type || 'Casa')
  const [docs, setDocs] = useState({})
  const [docsBusy, setDocsBusy] = useState(false)

  async function upload(e) { const files = Array.from(e.target.files); e.target.value = ''; setError(''); if (files.length + images.length > 8) { setError('Puedes agregar hasta 8 fotografías.'); return } setUploading(true); try { for (const file of files) { if (file.size > 5 * 1024 * 1024) throw new Error('Cada foto debe pesar menos de 5 MB.'); const result = await api('upload', 'POST', { image: await readImage(file) }); setImages(old => [...old, result.url]) } } catch (err) { setError(err.message) } finally { setUploading(false) } }
  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const documents = Object.values(docs).filter(d => !d.existing).map(d => d.id)
      const data = { ...Object.fromEntries(new FormData(e.currentTarget)), images, ...location, documents }
      const result = await api(property ? `properties/${property.id}` : 'properties', property ? 'PUT' : 'POST', data)
      await onSave(result)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const field = (name, label, inputType = 'text', extra = {}) => <label key={name}>{label}<input name={name} type={inputType} defaultValue={property?.[name] ?? ''} required {...extra} /></label>
  return <section className="page narrow"><button className="text-button" onClick={onCancel}>← Volver a mi panel</button><span className="eyebrow">ESPACIOS CON HISTORIA</span><h1>{property ? 'Edita tu publicación' : 'Abre la puerta a nuevas posibilidades.'}</h1><p>Comparte los detalles que hacen especial tu propiedad.</p>
    <form className="editor" onSubmit={submit}>
      <h2>01 <span>Lo esencial</span></h2>
      {field('title', 'Título de la publicación', 'text', { maxLength: 120, placeholder: 'Ej. Casa con jardín en Las Quintas' })}
      <div className="form-grid">
        <label>Operación<select name="operation" value={operation} onChange={e => setOperation(e.target.value)}><option value="venta">Venta</option><option value="renta">Renta</option></select></label>
        <label>Tipo de propiedad<select name="type" value={type} onChange={e => setType(e.target.value)}><option>Casa</option><option>Departamento</option><option>Terreno</option></select></label>
        {field('price', 'Precio en MXN', 'number', { min: 1, max: 1e10 })}{field('area', 'Superficie en m²', 'number', { min: 1, max: 1e7 })}{field('bedrooms', 'Recámaras', 'number', { min: 0, max: 100 })}{field('bathrooms', 'Baños', 'number', { min: 0, max: 100, step: 0.5 })}
      </div>
      <label>Descripción<textarea name="description" rows="5" required maxLength="5000" defaultValue={property?.description} placeholder="Distribución, espacios, servicios y lo que hay cerca…" /></label>
      <LocationPicker value={location} onChange={setLocation} />
      <h2>03 <span>Fotografías</span></h2>
      <label className="upload">＋ Agregar fotografías<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={upload} disabled={uploading || images.length >= 8} /><small>JPG, PNG o WebP · Hasta 8 fotos · 5 MB por foto</small></label>
      {uploading && <p role="status">Subiendo fotografías…</p>}
      <div className="photo-grid">{images.map((src, i) => <div key={`${src}-${i}`}><img src={src} alt={`Fotografía ${i + 1}`} /><button type="button" aria-label={`Eliminar fotografía ${i + 1}`} onClick={() => setImages(images.filter((_, n) => n !== i))}>×</button>{i === 0 && <small>Portada</small>}</div>)}</div>
      <DocumentsSection property={property} operation={operation} type={type} docs={docs} setDocs={setDocs} onBusy={setDocsBusy} />
      {error && <p role="alert" className="error">{error}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button className="primary" disabled={busy || uploading || docsBusy || !images.length || !location.locationValidated}>{busy ? 'Guardando…' : property ? 'Guardar cambios' : 'Enviar a revisión'} →</button></div>
    </form></section>
}
