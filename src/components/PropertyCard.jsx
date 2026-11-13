function PropertyCard({ property, onViewProperty }) {
  return (
    <div className="property-card">

      <div className="property-image">
        <img
          src="/images/casa1.jpg"
          alt={property.title}
        />
      </div>

      <div className="property-info">

        <h2>{property.title}</h2>

        <p className="property-price">
          ${property.price.toLocaleString('es-MX')} MXN
        </p>

        <p className="property-location">
          {property.location}
        </p>

        <div className="property-features">
          <span>{property.bedrooms} habitaciones</span>
          <span>{property.bathrooms} baños</span>
          <span>{property.area} m²</span>
        </div>

        <button
          className="property-button"
          onClick={() => onViewProperty(property)}
        >
          Ver propiedad
        </button>

      </div>

    </div>
  )
}

export default PropertyCard