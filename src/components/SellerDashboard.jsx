function SellerDashboard({
  onPublishProperty,
  onShowHome,
  onDeleteProperty,
  onEditProperty,
  properties,
  appointments,
  onUpdateAppointmentStatus

}) {
  const sellerProperties = properties.filter(
    (property) => property.isSellerProperty === true
  )

  return (
    <section className="seller-dashboard">

      <div className="seller-dashboard-header">

        <div>
          <h1>
            Panel del vendedor
          </h1>

          <p>
            Administra tus propiedades publicadas.
          </p>
        </div>

        <div className="seller-dashboard-header-actions">

          <button
            className="view-properties-button"
            onClick={() => {
              window.location.href = '/'
            }}
          >
            Ver propiedades
          </button>

          <button
            className="publish-property-button"
            onClick={onPublishProperty}
          >
            + Publicar propiedad
          </button>

        </div>

      </div>

      <div className="seller-properties">

        <h2>
          Mis propiedades
        </h2>

        {sellerProperties.length === 0 ? (

          <div className="no-seller-properties">

            <h3>
              Aún no tienes propiedades publicadas
            </h3>

            <p>
              Publica tu primera propiedad para comenzar.
            </p>

          </div>

        ) : (

          sellerProperties.map((property) => (

            <div
              className="seller-property-card"
              key={property.id}
            >

              <div className="seller-property-image">

               {property.photos &&
property.photos.length > 0 &&
property.photos[0] instanceof Blob ? (

  <img
    src={URL.createObjectURL(property.photos[0])}
    alt={property.title}
  />

) : (

  <span>
    Sin fotografía
  </span>

)}

              </div>

              <div className="seller-property-info">

                <h3>
                  {property.title}
                </h3>

                <p className="seller-property-price">
                  ${property.price.toLocaleString('es-MX')} MXN
                </p>

                <p>
                  {property.location}
                </p>

                <div className="seller-property-actions">

                  <button
                    type="button"
                    className="edit-property-button"
                    onClick={() => {
                      onEditProperty(property)
                    }}
                  >
                    Editar
                  </button>

                  <button
                    type="button"
                    className="delete-property-button"
                    onClick={() => {
                      onDeleteProperty(property.id)
                    }}
                  >
                    Eliminar
                  </button>

                </div>

              </div>

            </div>

          ))

        )}

      </div>

      <div className="seller-appointments">

        <h2>
          Solicitudes de citas
        </h2>

        {appointments.length === 0 ? (

          <div className="no-seller-properties">

            <h3>
              No tienes solicitudes de citas
            </h3>

            <p>
              Las solicitudes de los compradores aparecerán aquí.
            </p>

          </div>

        ) : (

          appointments.map((appointment) => (

            <div
              className="seller-appointment-card"
              key={appointment.id}
            >

              <h3>
                {appointment.propertyTitle}
              </h3>

              <p>
                <strong>Comprador:</strong> {appointment.buyerName}
              </p>

              <p>
                <strong>Fecha:</strong> {appointment.date}
              </p>

              <p>
                <strong>Hora:</strong> {appointment.time}
              </p>

              <p>
                <strong>Mensaje:</strong> {appointment.message || 'Sin mensaje'}
              </p>

              <p>
                <strong>Estado:</strong> {appointment.status}
              </p>

              <div className="appointment-actions">

  <button
    type="button"
    className="accept-appointment-button"
    onClick={() => {
      onUpdateAppointmentStatus(
        appointment.id,
        'Aceptada'
      )
    }}
  >
    Aceptar
  </button>

  <button
    type="button"
    className="reject-appointment-button"
    onClick={() => {
      onUpdateAppointmentStatus(
        appointment.id,
        'Rechazada'
      )
    }}
  >
    Rechazar
  </button>

</div>

            </div>

          ))

        )}

      </div>

    </section>
  )
}

export default SellerDashboard