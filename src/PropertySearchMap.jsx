
import { useEffect, useRef, useState } from 'react'
import {
  MapContainer,
  TileLayer,
  Circle,
  Marker,
  Popup,
  useMap,
  useMapEvents
} from 'react-leaflet'
import L from 'leaflet'
import { distanceKm, money } from './lib'

const DEFAULT_CENTER = { lat: 24.8091, lng: -107.394 }
const MIN_RADIUS = 0.5
const MAX_RADIUS = 50

function validPoint(p) {
  return Boolean(
    p &&
    p.lat !== null &&
    p.lng !== null &&
    p.lat !== undefined &&
    p.lng !== undefined &&
    p.lat !== '' &&
    p.lng !== '' &&
    Number.isFinite(Number(p.lat)) &&
    Number.isFinite(Number(p.lng)) &&
    Math.abs(Number(p.lat)) <= 90 &&
    Math.abs(Number(p.lng)) <= 180
  )
}

function clampRadius(value) {
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, value))
}

function makeIcon(className, innerClass, size) {
  return L.divIcon({
    className,
    html: `<div class="${innerClass}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  })
}

const centerIcon = makeIcon(
  'casafast-center-icon',
  'casafast-center-dot',
  22
)

const edgeIcon = makeIcon(
  'casafast-edge-icon',
  'casafast-edge-dot',
  20
)

const propertyIcon = L.divIcon({
  className: 'casafast-property-icon',
  html: '<div class="casafast-property-dot">⌂</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
})

function radiusHandlePosition(center, radiusKm) {
  const angular = radiusKm / 6371
  const lat = center.lat * Math.PI / 180
  const lng = center.lng * Math.PI / 180

  const newLat = Math.asin(
    Math.sin(lat) * Math.cos(angular)
  )

  const newLng = lng + Math.atan2(
    Math.sin(angular) * Math.cos(lat),
    Math.cos(angular)
  )

  return [
    newLat * 180 / Math.PI,
    newLng * 180 / Math.PI
  ]
}

function MapViewport({ center }) {
  const map = useMap()

  useEffect(() => {
    if (!validPoint(center)) return

    map.panTo(
      [Number(center.lat), Number(center.lng)],
      { animate: false }
    )
  }, [map, center.lat, center.lng])

  return null
}

function MapClickHandler({ onCenterChange, correcting }) {
  const map = useMap()

  useEffect(() => {
    map.getContainer().style.cursor =
      correcting ? 'crosshair' : ''

    return () => {
      map.getContainer().style.cursor = ''
    }
  }, [map, correcting])

  useMapEvents({
    click(event) {
      onCenterChange?.({
        lat: event.latlng.lat,
        lng: event.latlng.lng
      })
    }
  })

  return null
}

// Marcadores de propiedades. Solo se dibujan los que caen en la parte visible del mapa
// y, si son muchos, se agrupan en burbujas con el número de propiedades (clic = acercar).
const CLUSTER_PIXELS = 64
const CLUSTER_FROM = 60
const clusterIcons = new Map()
function clusterIcon(count) {
  const size = count < 10 ? 36 : count < 100 ? 44 : 52
  const key = `${size}:${count}`
  if (!clusterIcons.has(key)) {
    clusterIcons.set(key, L.divIcon({
      className: 'casafast-cluster-icon',
      html: `<div class="casafast-cluster" style="width:${size}px;height:${size}px">${count}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    }))
  }
  return clusterIcons.get(key)
}

function PropertyMarkers({ properties, onOpen }) {
  const map = useMap()
  const [view, setView] = useState(() => ({ bounds: map.getBounds(), zoom: map.getZoom() }))
  useMapEvents({
    moveend: () => setView({ bounds: map.getBounds(), zoom: map.getZoom() })
  })

  const padded = view.bounds.pad(0.25)
  const inView = properties.filter(p => padded.contains([Number(p.lat), Number(p.lng)]))

  let groups
  if (inView.length < CLUSTER_FROM || view.zoom >= 17) {
    groups = inView.map(p => [p])
  } else {
    const cells = new Map()
    for (const p of inView) {
      const point = map.project([Number(p.lat), Number(p.lng)], view.zoom)
      const key = `${Math.floor(point.x / CLUSTER_PIXELS)}:${Math.floor(point.y / CLUSTER_PIXELS)}`
      if (!cells.has(key)) cells.set(key, [])
      cells.get(key).push(p)
    }
    groups = [...cells.values()]
  }

  return groups.map(group => {
    if (group.length === 1) {
      const property = group[0]
      return (
        <Marker key={property.id} position={[Number(property.lat), Number(property.lng)]} icon={propertyIcon}>
          <Popup>
            <div style={{ minWidth: 180 }}>
              {property.images?.[0] && (
                <img
                  src={property.images[0]}
                  alt={property.title}
                  style={{
                    width: '100%',
                    height: 105,
                    objectFit: 'cover',
                    borderRadius: 8
                  }}
                />
              )}

              <h4 style={{ margin: '8px 0' }}>
                {property.title}
              </h4>

              <p>{property.location}</p>

              <strong>{money(property.price)}</strong>

              <button
                type="button"
                onClick={() => onOpen?.(property)}
                style={{
                  display: 'block',
                  marginTop: 12,
                  width: '100%',
                  background: '#285a42',
                  color: 'white',
                  border: 0,
                  borderRadius: 8,
                  padding: 10,
                  cursor: 'pointer'
                }}
              >
                Ver propiedad
              </button>
            </div>
          </Popup>
        </Marker>
      )
    }
    const lat = group.reduce((sum, p) => sum + Number(p.lat), 0) / group.length
    const lng = group.reduce((sum, p) => sum + Number(p.lng), 0) / group.length
    return (
      <Marker
        key={`cluster-${group[0].id}-${group.length}`}
        position={[lat, lng]}
        icon={clusterIcon(group.length)}
        title={`${group.length} propiedades. Haz clic para acercar.`}
        eventHandlers={{
          click() {
            const bounds = L.latLngBounds(group.map(p => [Number(p.lat), Number(p.lng)]))
            map.flyToBounds(bounds.pad(0.3), { maxZoom: Math.min(view.zoom + 4, 17), duration: 0.6 })
          }
        }}
      />
    )
  })
}

export default function PropertySearchMap({
  properties = [],
  center,
  radius = '',
  onCenterChange,
  onRadiusChange,
  onOpen
}) {
  const selectedCenter = validPoint(center)
    ? {
        lat: Number(center.lat),
        lng: Number(center.lng)
      }
    : DEFAULT_CENTER

  const hasRadius =
    radius !== '' &&
    radius !== null &&
    radius !== undefined &&
    Number.isFinite(Number(radius)) &&
    Number(radius) > 0

  const selectedRadius = hasRadius
    ? clampRadius(Number(radius))
    : 5

  const [correcting, setCorrecting] = useState(false)
  const [manualLocation, setManualLocation] = useState(false)

  const [locationQuery, setLocationQuery] = useState('')
  const [locationResults, setLocationResults] = useState([])
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationError, setLocationError] = useState('')

  const [radiusDraft, setRadiusDraft] = useState(
    hasRadius ? String(selectedRadius) : ''
  )

  const searchRequest = useRef(0)

  useEffect(() => {
    setRadiusDraft(hasRadius ? String(selectedRadius) : '')
  }, [hasRadius, selectedRadius])

  const visibleProperties = properties.filter(property => {
    if (!property.active || !validPoint(property)) return false

    return (
      !hasRadius ||
      distanceKm(selectedCenter, property) <= selectedRadius
    )
  })

  const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY

  function chooseCenter(point) {
    if (!validPoint(point)) return

    onCenterChange?.({
      lat: Number(point.lat),
      lng: Number(point.lng)
    })

    if (correcting) {
      setManualLocation(true)
      setCorrecting(false)
    }
  }

  async function searchLocation(event) {
    event.preventDefault()

    const query = locationQuery.trim()

    if (query.length < 4) {
      setLocationError('Escribe al menos cuatro caracteres.')
      setLocationResults([])
      return
    }

    const requestId = ++searchRequest.current

    setLocationLoading(true)
    setLocationError('')
    setLocationResults([])

    try {
      const response = await fetch(
        '/api/locations/public-search',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query })
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data.error || 'No fue posible buscar la ubicación.'
        )
      }

      if (!Array.isArray(data)) {
        throw new Error('Respuesta de búsqueda inválida.')
      }

      if (requestId !== searchRequest.current) return

      setLocationResults(data)

      if (!data.length) {
        setLocationError(
          'No encontramos ubicaciones con ese nombre.'
        )
      }
    } catch (error) {
      if (requestId === searchRequest.current) {
        setLocationError(
          error.message || 'No fue posible realizar la búsqueda.'
        )
      }
    } finally {
      if (requestId === searchRequest.current) {
        setLocationLoading(false)
      }
    }
  }

  function selectLocation(place) {
    if (!validPoint(place)) return

    searchRequest.current += 1
    setLocationQuery(place.formatted || '')
    setLocationResults([])
    setLocationError('')
    setLocationLoading(false)
    setManualLocation(false)
    setCorrecting(false)

    chooseCenter(place)
  }

  function updateRadius(value) {
    const number = Number(value)

    if (!Number.isFinite(number) || number <= 0) return

    const adjusted = clampRadius(number)
    const rounded = Math.round(adjusted * 10) / 10

    onRadiusChange?.(String(rounded))
  }

  function commitRadiusDraft() {
    if (radiusDraft.trim() === '') {
      onRadiusChange?.('')
      return
    }

    updateRadius(radiusDraft)

    setRadiusDraft(
      String(
        Math.round(
          clampRadius(Number(radiusDraft) || MIN_RADIUS) * 10
        ) / 10
      )
    )
  }

  function changeRadiusFromHandle(event) {
    const point = event.target.getLatLng()

    const kilometers = distanceKm(selectedCenter, {
      lat: point.lat,
      lng: point.lng
    })

    updateRadius(kilometers)
  }

  return (
    <div className="casafast-map-search">
      <style>{`
        .casafast-map-search {
          min-width: 0;
          color: #203b30;
          font-family: inherit;
        }

        .casafast-compact-search,
        .casafast-radius-panel {
          background: white;
          border: 1px solid #e5ebe6;
          border-radius: 16px;
          padding: 14px 16px;
          margin-bottom: 12px;
        }

        .casafast-search-form {
          display: flex !important;
          flex-direction: row !important;
          gap: 8px !important;
          align-items: center !important;
          margin: 0 !important;
        }

        .casafast-search-form input[type="search"] {
          flex: 1 1 auto !important;
          min-width: 0 !important;
          width: 100% !important;
          height: 44px !important;
          min-height: 44px !important;
          padding: 0 12px !important;
          margin: 0 !important;
          border: 1px solid #e0e8e1 !important;
          border-radius: 10px !important;
          background: white !important;
          font: inherit !important;
          font-size: 13px !important;
          box-sizing: border-box !important;
        }

        .casafast-search-form button[type="submit"] {
          flex: 0 0 auto !important;
          height: 44px !important;
          min-height: 44px !important;
          padding: 0 16px !important;
          margin: 0 !important;
          border: 0 !important;
          border-radius: 10px !important;
          background: #285a42 !important;
          color: white !important;
          font: inherit !important;
          font-size: 13px !important;
          font-weight: 600 !important;
          cursor: pointer;
        }

        .casafast-search-form button:disabled {
          opacity: .6;
          cursor: wait;
        }

        .casafast-location-results {
          margin-top: 8px;
          border: 1px solid #e5ebe6;
          border-radius: 10px;
          overflow: hidden;
        }

        .casafast-location-result {
          display: block;
          width: 100%;
          padding: 11px 13px;
          text-align: left;
          border: 0;
          border-bottom: 1px solid #eef1ed;
          background: white;
          color: #203b30;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }

        .casafast-location-result:hover {
          background: #f4f7f2;
        }

        .casafast-location-error {
          color: #a43c36;
          font-size: 12px;
          margin: 9px 0 0;
        }

        .casafast-radius-header,
        .casafast-radius-bottom {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }

        .casafast-radius-header {
          margin-bottom: 12px;
        }

        .casafast-radius-title {
          font-size: 13px;
          font-weight: 600;
        }

        .casafast-radius-edit {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .casafast-radius-edit input {
          width: 70px !important;
          height: 36px !important;
          min-height: 36px !important;
          padding: 6px 8px !important;
          border: 1px solid #e0e8e1 !important;
          border-radius: 9px !important;
          font: inherit !important;
          font-size: 13px !important;
          text-align: right;
          box-sizing: border-box;
        }

        .casafast-radius-edit span {
          font-size: 12px;
          color: #718078;
        }

        .casafast-radius-slider {
          width: 100%;
          accent-color: #285a42;
          cursor: pointer;
        }

        .casafast-radius-ends {
          display: flex;
          justify-content: space-between;
          margin-top: 4px;
          color: #89968c;
          font-size: 11px;
        }

        .casafast-radius-bottom {
          margin-top: 10px;
        }

        .casafast-radius-bottom button {
          padding: 4px 0;
          border: 0;
          background: transparent;
          color: #285a42;
          font: inherit;
          font-size: 12px;
          cursor: pointer;
        }

        .casafast-radius-bottom p {
          margin: 0;
          color: #89968c;
          font-size: 11px;
        }

        .casafast-map-tools {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 10px;
          margin: 0 0 12px;
        }

        .casafast-correct-button {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 10px 13px;
          border: 1px solid #dce6df;
          border-radius: 10px;
          background: white;
          color: #285a42;
          font: inherit;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        .casafast-correct-button.active {
          background: #285a42;
          border-color: #285a42;
          color: white;
        }

        .casafast-map-status {
          color: #718078;
          font-size: 11px;
        }

        .casafast-map-frame {
          height: 540px;
          width: 100%;
          border: 1px solid #e1e9e3;
          border-radius: 16px;
          overflow: hidden;
          background: #f5f7f4;
        }

        .casafast-muted-tiles {
          filter: saturate(.45) brightness(1.045);
        }

        .casafast-center-dot {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #285a42;
          border: 5px solid white;
          box-shadow: 0 2px 10px #0003;
          box-sizing: border-box;
          cursor: grab;
        }

        .casafast-edge-dot {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: white;
          border: 5px solid #285a42;
          box-shadow: 0 2px 10px #0002;
          box-sizing: border-box;
          cursor: grab;
        }

        .casafast-property-dot {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border: 2px solid #285a42;
          border-radius: 50%;
          background: white;
          color: #285a42;
          font-size: 21px;
          box-shadow: 0 2px 8px #0002;
          box-sizing: border-box;
        }

        .casafast-map-hint {
          margin: 9px 2px 0;
          color: #89968c;
          font-size: 11px;
          line-height: 1.5;
        }

        @media (max-width: 650px) {
          .casafast-compact-search,
          .casafast-radius-panel {
            padding: 12px;
          }

          .casafast-map-frame {
            height: 390px;
          }

          .casafast-search-form button[type="submit"] {
            padding: 0 12px !important;
          }
        }
      `}</style>

      {/* BUSCADOR DE UBICACIÓN */}
      <div className="casafast-compact-search">
        <form
          className="casafast-search-form"
          onSubmit={searchLocation}
        >
          <input
            type="search"
            value={locationQuery}
            onChange={event => {
              searchRequest.current += 1
              setLocationQuery(event.target.value)
              setLocationResults([])
              setLocationError('')
              setLocationLoading(false)
            }}
            placeholder="Colonia, ciudad o estado..."
            aria-label="Buscar ubicación en México"
          />

          <button
            type="submit"
            disabled={locationLoading}
          >
            {locationLoading ? 'Buscando...' : 'Buscar'}
          </button>
        </form>

        {locationError && (
          <p className="casafast-location-error" role="alert">
            {locationError}
          </p>
        )}

        {locationResults.length > 0 && (
          <div className="casafast-location-results">
            {locationResults.map((place, index) => (
              <button
                key={`${place.placeId}-${index}`}
                type="button"
                className="casafast-location-result"
                onClick={() => selectLocation(place)}
              >
                📍 {place.formatted}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* RADIO DE BÚSQUEDA */}
      <div className="casafast-radius-panel">
        <div className="casafast-radius-header">
          <span className="casafast-radius-title">
            Radio de búsqueda
          </span>

          <div className="casafast-radius-edit">
            {hasRadius ? (
              <>
                <input
                  type="number"
                  min={MIN_RADIUS}
                  max={MAX_RADIUS}
                  step="0.1"
                  value={radiusDraft}
                  aria-label="Distancia exacta en kilómetros"
                  onChange={event => {
                    setRadiusDraft(event.target.value)
                  }}
                  onBlur={commitRadiusDraft}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
                />
                <span>km</span>
              </>
            ) : (
              <strong style={{ fontSize: 13 }}>
                Sin límite
              </strong>
            )}
          </div>
        </div>

        <input
          className="casafast-radius-slider"
          type="range"
          min={MIN_RADIUS}
          max={MAX_RADIUS}
          step="0.1"
          value={selectedRadius}
          aria-label="Ajustar radio de búsqueda"
          onChange={event => {
            updateRadius(event.target.value)
          }}
        />

        <div className="casafast-radius-ends">
          <span>500 m</span>
          <span>50 km</span>
        </div>

        <div className="casafast-radius-bottom">
          <button
            type="button"
            onClick={() => {
              if (hasRadius) {
                onRadiusChange?.('')
              } else {
                updateRadius(5)
              }
            }}
          >
            {hasRadius
              ? 'Sin límite'
              : 'Activar radio de 5 km'}
          </button>

          <p>Distancia en línea recta</p>
        </div>
      </div>

      {/* CORRECCIÓN MANUAL DE UBICACIÓN */}
      <div className="casafast-map-tools">
        <button
          type="button"
          className={
            'casafast-correct-button' +
            (correcting ? ' active' : '')
          }
          aria-pressed={correcting}
          onClick={() => {
            setCorrecting(value => !value)
          }}
        >
          {correcting
            ? '✕ Cancelar corrección'
            : '⌖ Corregir mi ubicación'}
        </button>

        <span
          className="casafast-map-status"
          role="status"
        >
          {correcting
            ? 'Selecciona tu posición en el mapa'
            : manualLocation
              ? 'Ubicación ajustada manualmente'
              : 'Puedes mover el centro de búsqueda'}
        </span>
      </div>

      {/* MAPA */}
      <div className="casafast-map-frame">
        <MapContainer
          center={[
            selectedCenter.lat,
            selectedCenter.lng
          ]}
          zoom={12}
          minZoom={4}
          maxZoom={20}
          scrollWheelZoom
          style={{
            height: '100%',
            width: '100%'
          }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | <a href="https://www.geoapify.com/">Geoapify</a>'
            url={`https://maps.geoapify.com/v1/tile/osm-carto/{z}/{x}/{y}.png?apiKey=${apiKey}`}
            tileSize={256}
            maxZoom={20}
            className="casafast-muted-tiles"
          />

          <MapViewport center={selectedCenter} />

          <MapClickHandler
            correcting={correcting}
            onCenterChange={chooseCenter}
          />

          {hasRadius && (
            <Circle
              center={[
                selectedCenter.lat,
                selectedCenter.lng
              ]}
              radius={selectedRadius * 1000}
              pathOptions={{
                color: '#285a42',
                fillColor: '#5a9674',
                fillOpacity: 0.10,
                weight: 2,
                interactive: false
              }}
            />
          )}

          {/* CENTRO DE BÚSQUEDA */}
          <Marker
            position={[
              selectedCenter.lat,
              selectedCenter.lng
            ]}
            icon={centerIcon}
            draggable
            eventHandlers={{
              dragend(event) {
                const point = event.target.getLatLng()
                chooseCenter(point)
              }
            }}
          >
            <Popup>Centro de búsqueda</Popup>
          </Marker>

          {/* CONTROL DE RADIO */}
          {hasRadius && (
            <Marker
              position={radiusHandlePosition(
                selectedCenter,
                selectedRadius
              )}
              icon={edgeIcon}
              draggable
              autoPan
              eventHandlers={{
                dragend: changeRadiusFromHandle
              }}
            >
              <Popup>
                Arrastra para ajustar el radio.
              </Popup>
            </Marker>
          )}

          {/* PROPIEDADES (agrupadas cuando hay muchas) */}
          <PropertyMarkers properties={visibleProperties} onOpen={onOpen} />
        </MapContainer>
      </div>

      <p className="casafast-map-hint">
        Haz clic para cambiar el centro de búsqueda o arrastra
        el marcador central. El punto del borde permite ajustar
        el radio. Las distancias se calculan en línea recta,
        no por carretera.
      </p>
    </div>
  )
}
