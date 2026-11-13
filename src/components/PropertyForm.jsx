import { useState } from 'react'

function PropertyForm({ onAddProperty, propertyToEdit }) {

  const [title, setTitle] = useState(
    propertyToEdit ? propertyToEdit.title : ''
  )

  const [operation, setOperation] = useState(
    propertyToEdit ? propertyToEdit.operation : 'venta'
  )

  const [price, setPrice] = useState(
    propertyToEdit ? propertyToEdit.price : ''
  )

  const [city, setCity] = useState(
    propertyToEdit ? propertyToEdit.city : ''
  )

  const [address, setAddress] = useState(
    propertyToEdit ? propertyToEdit.address : ''
  )

  const [bedrooms, setBedrooms] = useState(
    propertyToEdit ? propertyToEdit.bedrooms : ''
  )

  const [bathrooms, setBathrooms] = useState(
    propertyToEdit ? propertyToEdit.bathrooms : ''
  )

  const [area, setArea] = useState(
    propertyToEdit ? propertyToEdit.area : ''
  )

  const [description, setDescription] = useState(
    propertyToEdit ? propertyToEdit.description : ''
  )

  const [photos, setPhotos] = useState(
    propertyToEdit ? propertyToEdit.photos || [] : []
  )

  const handlePhotoChange = (e) => {
    const selectedPhotos = Array.from(e.target.files)

    setPhotos(selectedPhotos)
  }

  const handleSubmit = (e) => {
    e.preventDefault()

    const updatedProperty = {
      id: propertyToEdit
        ? propertyToEdit.id
        : Date.now(),

      title,

      operation,

      price: Number(price),

      city,

      location: `${city}, Sinaloa`,

      address,

      bedrooms: Number(bedrooms),

      bathrooms: Number(bathrooms),

      area: Number(area),

      description,

      photos,

      distance: propertyToEdit
        ? propertyToEdit.distance
        : 0,

      isSellerProperty: true
    }

    onAddProperty(updatedProperty)
  }

  return (
    <section className="property-form-section">

      <div className="property-form-card">

        <h1>
          {propertyToEdit
            ? 'Editar propiedad'
            : 'Publicar propiedad'
          }
        </h1>

        <p>
          {propertyToEdit
            ? 'Modifica la información de tu propiedad.'
            : 'Agrega la información de la propiedad que deseas publicar.'
          }
        </p>

        <form onSubmit={handleSubmit}>

          <label>
            Título de la propiedad
          </label>

          <input
            type="text"
            placeholder="Ej. Casa moderna en Culiacán"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />

          <label>
            Tipo de operación
          </label>

          <select
            value={operation}
            onChange={(e) => setOperation(e.target.value)}
          >

            <option value="venta">
              Venta
            </option>

            <option value="renta">
              Renta
            </option>

          </select>

          <label>
            Precio
          </label>

          <input
            type="number"
            placeholder="Ej. 2500000"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />

          <label>
            Ciudad
          </label>

          <input
            type="text"
            placeholder="Ej. Culiacán"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            required
          />

          <label>
            Dirección
          </label>

          <input
            type="text"
            placeholder="Dirección de la propiedad"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
          />

          <label>
            Habitaciones
          </label>

          <input
            type="number"
            min="0"
            placeholder="Ej. 3"
            value={bedrooms}
            onChange={(e) => setBedrooms(e.target.value)}
            required
          />

          <label>
            Baños
          </label>

          <input
            type="number"
            min="0"
            placeholder="Ej. 2"
            value={bathrooms}
            onChange={(e) => setBathrooms(e.target.value)}
            required
          />

          <label>
            Superficie (m²)
          </label>

          <input
            type="number"
            min="0"
            placeholder="Ej. 180"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            required
          />

          <label>
            Descripción
          </label>

          <textarea
            placeholder="Describe las características de la propiedad..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />

          <label>
            Fotografías de la propiedad
          </label>

          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handlePhotoChange}
          />

          <button
            type="submit"
            className="publish-property-button"
          >
            {propertyToEdit
              ? 'Guardar cambios'
              : 'Publicar propiedad'
            }
          </button>

        </form>

      </div>

    </section>
  )
}

export default PropertyForm