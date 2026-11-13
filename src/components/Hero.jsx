import { useState } from 'react'

function Hero({
  onOperationChange,
  onDistanceChange,
  onLocationChange
}) {
  const [operation, setOperation] = useState('comprar')
  const [location, setLocation] = useState('')
  const [distance, setDistance] = useState('')

  const handleOperationChange = (newOperation) => {
    setOperation(newOperation)
    onOperationChange(newOperation)
  }

  const handleDistanceChange = (newDistance) => {
    setDistance(newDistance)
    onDistanceChange(newDistance)
  }

  const handleLocationChange = (newLocation) => {
    setLocation(newLocation)
    onLocationChange(newLocation)
  }

  const handleSearch = () => {
    console.log('Operación:', operation)
    console.log('Ubicación:', location)
    console.log('Distancia:', distance)
  }

  return (
    <section className="hero">
      <div className="hero-content">

        <h1>Encuentra tu próximo hogar</h1>

        <p>
          Compra o renta propiedades de manera sencilla.
        </p>

        <div className="operation-buttons">

          <button
            className={operation === 'comprar' ? 'active' : ''}
            onClick={() => handleOperationChange('comprar')}
          >
            Comprar
          </button>

          <button
            className={operation === 'rentar' ? 'active' : ''}
            onClick={() => handleOperationChange('rentar')}
          >
            Rentar
          </button>

        </div>

        <div className="search-box">

          <input
            type="text"
            placeholder="Ciudad o ubicación..."
            value={location}
            onChange={(e) => handleLocationChange(e.target.value)}
          />

          <select
            value={distance}
            onChange={(e) => handleDistanceChange(e.target.value)}
          >
            <option value="">Distancia</option>
            <option value="5">5 km</option>
            <option value="10">10 km</option>
            <option value="20">20 km</option>
            <option value="30">30 km</option>
            <option value="50">50 km</option>
          </select>

          <button onClick={handleSearch}>
            Buscar propiedades
          </button>

        </div>

      </div>
    </section>
  )
}

export default Hero