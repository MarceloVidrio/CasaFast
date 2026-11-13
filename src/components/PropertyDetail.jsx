import AppointmentForm from './AppointmentForm'

function PropertyDetail({
  property,
  onRequestAppointment,
  onAddAppointment,
  showAppointmentForm,
  onCloseAppointment,
  onBack
}) {
  const hasValidUploadedPhoto =
    property.photos &&
    property.photos.length > 0 &&
    property.photos[0] instanceof Blob

  return (
    <section className="property-detail">

      <button
        className="back-button"
        onClick={onBack}
      >
        ← Volver a propiedades
      </button>

      <div className="property-detail-image">

        {hasValidUploadedPhoto ? (

          <img
            src={URL.createObjectURL(property.photos[0])}
            alt={property.title}
          />

        ) : (

          <img
            src="/images/casa1.jpg"
            alt={property.title}
          />

        )}

      </div>

      <div className="property-detail-info">

        <h1>
          {property.title}
        </h1>

        <p className="property-detail-price">
          ${property.price.toLocaleString('es-MX')} MXN
        </p>

        <p className="property-detail-location">
          📍 {property.location}
        </p>

        <div className="property-detail-features">

          <span>
            🛏️ {property.bedrooms} habitaciones
          </span>

          <span>
            🚿 {property.bathrooms} baños
          </span>

          <span>
            📐 {property.area} m²
          </span>

        </div>

        <h2>
          Descripción
        </h2>

        <p>
          {property.description ||
            'Esta propiedad cuenta con espacios amplios y cómodos, excelente ubicación y características ideales para vivir o invertir.'
          }
        </p>

        {property.address && (
          <div className="property-detail-address">

            <h2>
              Dirección
            </h2>

            <p>
              {property.address}
            </p>

          </div>
        )}

        <button
          className="appointment-button"
          onClick={onRequestAppointment}
        >
          Solicitar una cita
        </button>

      </div>

      {showAppointmentForm && (
        <AppointmentForm
          property={property}
          onAddAppointment={onAddAppointment}
          onClose={onCloseAppointment}
        />
      )}

    </section>
  )
}

export default PropertyDetail