
import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { api } from './lib'

const DEFAULT_POINT = { lat: 24.8091, lng: -107.394 }

const blank = {
  street: '',
  number: '',
  neighborhood: '',
  city: '',
  state: '',
  postalCode: '',
  unit: '',
  reference: ''
}

const labels = {
  street: 'Calle',
  number: 'Número exterior',
  neighborhood: 'Colonia',
  city: 'Ciudad / municipio',
  state: 'Estado',
  postalCode: 'Código postal',
  unit: 'Interior / departamento',
  reference: 'Referencias adicionales'
}

const markerIcon = L.icon({
  iconUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
})

function MapClickHandler({ onSelect }) {
  useMapEvents({
    click(event) {
      onSelect({
        lat: event.latlng.lat,
        lng: event.latlng.lng
      })
    }
  })

  return null
}

function MapController({ position, zoomTarget }) {
  const map = useMap()

  useEffect(() => {
    if (position) {
      map.panTo([position.lat, position.lng])
    }
  }, [map, position?.lat, position?.lng])

  useEffect(() => {
    if (zoomTarget) {
      map.setView(
        [zoomTarget.lat, zoomTarget.lng],
        zoomTarget.zoom
      )
    }
  }, [map, zoomTarget])

  return null
}

function LocationMarker({ position, onSelect }) {
  return (
    <Marker
      position={[position.lat, position.lng]}
      icon={markerIcon}
      draggable
      eventHandlers={{
        dragend(event) {
          const point = event.target.getLatLng()

          onSelect({
            lat: point.lat,
            lng: point.lng
          })
        }
      }}
    />
  )
}

export default function LocationPicker({ value, onChange }) {
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [zoomTarget, setZoomTarget] = useState(null)

  const current = useRef(value)
  const change = useRef(onChange)
  const requestVersion = useRef(0)

  current.current = value
  change.current = onChange

  const hasPoint =
    Number.isFinite(value?.lat) &&
    Number.isFinite(value?.lng)

  const position = hasPoint
    ? { lat: value.lat, lng: value.lng }
    : DEFAULT_POINT

  const details = {
    ...blank,
    ...value?.locationDetails
  }

  useEffect(() => {
    let live = true

    api('config')
      .then(result => {
        if (live) setConfig(result)
      })
      .catch(err => {
        if (live) setError(err.message)
      })

    return () => {
      live = false
      requestVersion.current++
    }
  }, [])

  function update(next) {
    change.current(next)
  }

  function invalidate() {
    const next = {
      ...current.current,
      locationToken: '',
      locationValidated: false
    }

    update(next)
    setConfirmed(false)

    return next
  }

  async function selectPoint(point) {
    const version = ++requestVersion.current
    const previous = invalidate()

    update({
      ...previous,
      ...point
    })

    setBusy(true)
    setError('')
    setResults([])

    try {
      const result = await api(
        'locations/reverse',
        'POST',
        point
      )

      if (version !== requestVersion.current) return

      const latest = current.current

      update({
        ...latest,
        ...point,
        locationDetails: {
          ...blank,
          ...result.address,
          unit: previous.locationDetails?.unit || '',
          reference: previous.locationDetails?.reference || ''
        },
        locationToken: '',
        locationValidated: false
      })
    } catch (err) {
      if (version === requestVersion.current) {
        setError(
          err.message +
          ' Puedes introducir los datos de la dirección manualmente.'
        )
      }
    } finally {
      if (version === requestVersion.current) {
        setBusy(false)
      }
    }
  }

  async function search() {
    if (query.trim().length < 4) {
      setError('Escribe al menos cuatro caracteres.')
      return
    }

    const version = ++requestVersion.current

    setBusy(true)
    setError('')
    setResults([])

    try {
      const list = await api(
        'locations/search',
        'POST',
        { query: query.trim() }
      )

      if (version !== requestVersion.current) return

      setResults(Array.isArray(list) ? list : [])

      if (!list.length) {
        setError(
          'No encontramos esa dirección. Agrega la ciudad y el estado.'
        )
      }
    } catch (err) {
      if (version === requestVersion.current) {
        setError(err.message)
      }
    } finally {
      if (version === requestVersion.current) {
        setBusy(false)
      }
    }
  }

  function choose(result) {
    setResults([])

    const point = {
      lat: Number(result.lat),
      lng: Number(result.lng)
    }

    if (!Number.isFinite(point.lat) ||
        !Number.isFinite(point.lng)) {
      setError('La ubicación seleccionada no tiene coordenadas válidas.')
      return
    }

    setZoomTarget({
      ...point,
      zoom: result.address?.street ? 18 : 15
    })

    selectPoint(point)
  }

  function edit(field, text) {
    requestVersion.current++
    setBusy(false)

    const previous = invalidate()

    update({
      ...previous,
      locationDetails: {
        ...blank,
        ...previous.locationDetails,
        [field]: text
      }
    })
  }

  async function validate() {
    if (!hasPoint) {
      setError('Primero selecciona la ubicación en el mapa.')
      return
    }

    if (!confirmed) {
      setError('Confirma que el pin corresponde a tu inmueble.')
      return
    }

    const version = ++requestVersion.current

    setBusy(true)
    setError('')

    try {
      const receipt = await api(
        'locations/confirm',
        'POST',
        {
          lat: current.current.lat,
          lng: current.current.lng,
          locationDetails: current.current.locationDetails,
          confirmed: true
        }
      )

      if (version !== requestVersion.current) return

      update({
        ...current.current,
        ...receipt,
        locationValidated: true
      })
    } catch (err) {
      if (version === requestVersion.current) {
        setError(err.message)
      }
    } finally {
      if (version === requestVersion.current) {
        setBusy(false)
      }
    }
  }

  return (
    <section
      className="location-picker"
      aria-label="Ubicación de la propiedad"
    >
      <h2>
        02 <span>Ubica tu propiedad</span>
      </h2>

      <p className="muted">
        Busca una colonia o dirección, coloca el pin en la
        entrada de tu inmueble y revisa los datos.
        Puedes corregirlos antes de confirmar.
      </p>

      <div className="map-search">
        <label>
          Buscar dirección o colonia
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Las Quintas, Culiacán, Sinaloa"
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (!busy) search()
              }
            }}
            disabled={busy}
          />
        </label>

        <button
          type="button"
          className="secondary"
          onClick={search}
          disabled={busy}
        >
          Buscar en el mapa
        </button>
      </div>

      {results.length > 0 && (
        <ul className="map-results">
          {results.map((result, index) => (
            <li key={result.placeId || index}>
              <button
                type="button"
                onClick={() => choose(result)}
              >
                {result.formatted}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        className="map-canvas"
        style={{ minHeight: 350 }}
        aria-label="Mapa para seleccionar la entrada del inmueble"
      >
        <MapContainer
          center={[
            DEFAULT_POINT.lat,
            DEFAULT_POINT.lng
          ]}
          zoom={16}
          style={{
            width: '100%',
            height: '100%',
            minHeight: 350
          }}
          scrollWheelZoom
        >
          
<TileLayer
  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | <a href="https://www.geoapify.com/">Geoapify</a>'
  url={`https://maps.geoapify.com/v1/tile/osm-carto/{z}/{x}/{y}.png?apiKey=${import.meta.env.VITE_GEOAPIFY_API_KEY}`}
  maxZoom={20}
  tileSize={256}
/>

          <MapClickHandler onSelect={selectPoint} />

          <MapController
            position={position}
            zoomTarget={zoomTarget}
          />

          <LocationMarker
            position={position}
            onSelect={selectPoint}
          />
        </MapContainer>
      </div>

      <p className="map-attribution">
        OpenStreetMap · Acerca el mapa y haz clic o
        arrastra el marcador hasta la entrada de tu inmueble.
        La búsqueda está limitada a México.
      </p>

      <div className="form-grid">
        {Object.keys(labels).map(field => (
          <label key={field}>
            {labels[field]}

            <input
              value={details[field]}
              maxLength={
                field === 'reference' ? 300 : 120
              }
              onChange={event =>
                edit(field, event.target.value)
              }
              required={
                ['street', 'city', 'state'].includes(field)
              }
              inputMode={
                field === 'postalCode'
                  ? 'numeric'
                  : undefined
              }
              pattern={
                field === 'postalCode'
                  ? '[0-9]{5}'
                  : undefined
              }
            />
          </label>
        ))}
      </div>

      {hasPoint && (
        <p className="muted">
          Punto seleccionado:{' '}
          {value.lat.toFixed(6)},{' '}
          {value.lng.toFixed(6)}
        </p>
      )}

      <label className="check-label">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={event => {
            setConfirmed(event.target.checked)

            if (!event.target.checked) {
              update({
                ...current.current,
                locationValidated: false,
                locationToken: ''
              })
            }
          }}
        />

        Confirmo que el pin y la dirección corresponden
        a la entrada de mi inmueble.
      </label>

      <button
        type="button"
        className="secondary"
        onClick={validate}
        disabled={busy || !hasPoint || !confirmed}
      >
        {busy
          ? 'Consultando ubicación…'
          : 'Validar dirección con el mapa'}
      </button>

      {value?.locationValidated && (
        <p
          role="status"
          className="success validation-note"
        >
          ✓ Ubicación contrastada. Si cambias el pin
          o la dirección, tendrás que validarla nuevamente.
        </p>
      )}

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <small>
        El mapa ayuda a contrastar una dirección;
        no comprueba la titularidad ni la existencia
        física de una vivienda.
      </small>
    </section>
  )
}
