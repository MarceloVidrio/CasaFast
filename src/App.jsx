import { useState } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import PropertyCard from './components/PropertyCard'
import PropertyDetail from './components/PropertyDetail'
import Register from './components/Register'
import Login from './components/Login'
import PropertyForm from './components/PropertyForm'
import SellerDashboard from './components/SellerDashboard'
import properties from './properties'
import './App.css'

function App() {
  const [operation, setOperation] = useState('comprar')
  const [distance, setDistance] = useState('')
  const [location, setLocation] = useState('')

  const [allProperties, setAllProperties] = useState(() => {
    const savedProperties = localStorage.getItem(
      'casafast_properties'
    )

    if (savedProperties) {
      return JSON.parse(savedProperties)
    }

    return properties
  })

  const [appointments, setAppointments] = useState(() => {
    const savedAppointments = localStorage.getItem(
      'casafast_appointments'
    )

    if (savedAppointments) {
      return JSON.parse(savedAppointments)
    }

    return []
  })

  const [currentUser, setCurrentUser] = useState(() => {
    const savedUser = localStorage.getItem(
      'casafast_current_user'
    )

    if (savedUser) {
      return JSON.parse(savedUser)
    }

    return null
  })

  const [selectedProperty, setSelectedProperty] = useState(null)

  const [showAppointmentForm, setShowAppointmentForm] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [showPropertyForm, setShowPropertyForm] = useState(false)
  const [showSellerDashboard, setShowSellerDashboard] = useState(false)

  const [propertyToEdit, setPropertyToEdit] = useState(null)

  const filteredProperties = allProperties.filter((property) => {

    const normalizedOperation =
      property.operation === 'venta'
        ? 'comprar'
        : property.operation === 'renta'
          ? 'rentar'
          : property.operation

    const matchesOperation =
      normalizedOperation === operation

    const matchesDistance =
      distance === '' ||
      property.distance <= Number(distance)

    const matchesLocation =
      location === '' ||
      property.location
        .toLowerCase()
        .includes(location.toLowerCase())

    return (
      matchesOperation &&
      matchesDistance &&
      matchesLocation
    )
  })

  const handleRequestAppointment = () => {
    setShowAppointmentForm(true)
  }

  const handleAddAppointment = (newAppointment) => {
    setAppointments((currentAppointments) => {

      const updatedAppointments = [
        ...currentAppointments,
        newAppointment
      ]

      localStorage.setItem(
        'casafast_appointments',
        JSON.stringify(updatedAppointments)
      )

      return updatedAppointments
    })
  }

  const handleUpdateAppointmentStatus = (
    appointmentId,
    newStatus
  ) => {

    setAppointments((currentAppointments) => {

      const updatedAppointments =
        currentAppointments.map((appointment) =>
          appointment.id === appointmentId
            ? {
                ...appointment,
                status: newStatus
              }
            : appointment
        )

      localStorage.setItem(
        'casafast_appointments',
        JSON.stringify(updatedAppointments)
      )

      return updatedAppointments
    })
  }

  const handleCloseAppointment = () => {
    setShowAppointmentForm(false)
  }

  const handleBackToProperties = () => {
    setSelectedProperty(null)
    setShowAppointmentForm(false)
  }

  const handleRegister = () => {
    setShowRegister(true)
    setShowLogin(false)
    setShowSellerDashboard(false)
    setShowPropertyForm(false)
    setSelectedProperty(null)
  }

  const handleLogin = () => {
  const savedUser = localStorage.getItem(
    'casafast_current_user'
  )

  if (savedUser) {
    setCurrentUser(JSON.parse(savedUser))
  }

  setShowLogin(true)
  setShowRegister(false)
  setShowSellerDashboard(false)
  setShowPropertyForm(false)
  setSelectedProperty(null)
}

  const handleShowPropertyForm = () => {
    setPropertyToEdit(null)
    setShowPropertyForm(true)
    setShowSellerDashboard(false)
    setShowRegister(false)
    setShowLogin(false)
    setSelectedProperty(null)
  }

  const handleShowSellerDashboard = () => {
    setShowSellerDashboard(true)
    setShowPropertyForm(false)
    setShowRegister(false)
    setShowLogin(false)
    setSelectedProperty(null)
  }

  const handleShowHome = () => {
    setShowSellerDashboard(false)
    setShowPropertyForm(false)
    setShowRegister(false)
    setShowLogin(false)
    setSelectedProperty(null)
    setShowAppointmentForm(false)

    setOperation('comprar')
    setDistance('')
    setLocation('')
  }

  const handleAddProperty = (newProperty) => {

    setAllProperties((currentProperties) => {

      const updatedProperties =
        currentProperties.some(
          (property) =>
            property.id === newProperty.id
        )
          ? currentProperties.map((property) =>
              property.id === newProperty.id
                ? newProperty
                : property
            )
          : [
              ...currentProperties,
              newProperty
            ]

      localStorage.setItem(
        'casafast_properties',
        JSON.stringify(updatedProperties)
      )

      return updatedProperties
    })

    setPropertyToEdit(null)
    setShowPropertyForm(false)
    setShowSellerDashboard(true)
  }

  const handleDeleteProperty = (propertyId) => {

    const confirmed = window.confirm(
      '¿Estás seguro de que deseas eliminar esta propiedad?'
    )

    if (!confirmed) {
      return
    }

    setAllProperties((currentProperties) => {

      const updatedProperties =
        currentProperties.filter(
          (property) =>
            property.id !== propertyId
        )

      localStorage.setItem(
        'casafast_properties',
        JSON.stringify(updatedProperties)
      )

      return updatedProperties
    })
  }

  const handleEditProperty = (property) => {
    setPropertyToEdit(property)
    setShowPropertyForm(true)
    setShowSellerDashboard(false)
    setShowRegister(false)
    setShowLogin(false)
    setSelectedProperty(null)
  }

  return (
    <div>

      <Navbar
  onRegister={handleRegister}
  onLogin={handleLogin}
  onSellerDashboard={handleShowSellerDashboard}
  onShowHome={handleShowHome}
  currentUser={currentUser}
/>

      {showRegister ? (

        <Register
          onLogin={handleLogin}
        />

      ) : showLogin ? (

        <Login
          onRegister={handleRegister}
        />

      ) : showSellerDashboard ? (

        <SellerDashboard
          onPublishProperty={handleShowPropertyForm}
          onShowHome={() => handleShowHome()}
          onDeleteProperty={handleDeleteProperty}
          onEditProperty={handleEditProperty}
          properties={allProperties}
          appointments={appointments}
          onUpdateAppointmentStatus={
            handleUpdateAppointmentStatus
          }
        />

      ) : showPropertyForm ? (

        <PropertyForm
          onAddProperty={handleAddProperty}
          propertyToEdit={propertyToEdit}
        />

      ) : selectedProperty ? (

        <PropertyDetail
          property={selectedProperty}
          onRequestAppointment={
            handleRequestAppointment
          }
          onAddAppointment={
            handleAddAppointment
          }
          showAppointmentForm={
            showAppointmentForm
          }
          onCloseAppointment={
            handleCloseAppointment
          }
          onBack={
            handleBackToProperties
          }
        />

      ) : (

        <>

          <Hero
            onOperationChange={setOperation}
            onDistanceChange={setDistance}
            onLocationChange={setLocation}
          />

          <section className="properties-section">

            <h2>
              Propiedades disponibles
            </h2>

            <div className="properties-container">

              {filteredProperties.length > 0 ? (

                filteredProperties.map((property) => (

                  <PropertyCard
                    key={property.id}
                    property={property}
                    onViewProperty={
                      setSelectedProperty
                    }
                  />

                ))

              ) : (

                <div className="no-results">

                  <h3>
                    No encontramos propiedades
                  </h3>

                  <p>
                    Intenta cambiar la ubicación,
                    distancia o tipo de operación.
                  </p>

                </div>

              )}

            </div>

          </section>

        </>

      )}

    </div>
  )
}

export default App