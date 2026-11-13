import { useState } from 'react'

function AppointmentForm({
  property,
  onAddAppointment,
  onClose
}) {
  const [buyerName, setBuyerName] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [message, setMessage] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()

    const newAppointment = {
      id: Date.now(),

      propertyId: property.id,

      propertyTitle: property.title,

      buyerName,

      date,

      time,

      message,

      status: 'Pendiente'
    }

    onAddAppointment(newAppointment)

    alert('Solicitud de cita enviada correctamente')

    onClose()
  }

  return (
    <div className="appointment-overlay">

      <div className="appointment-form">

        <button
          type="button"
          className="close-button"
          onClick={onClose}
        >
          ×
        </button>

        <h2>
          Solicitar una cita
        </h2>

        <p>
          {property.title}
        </p>

        <form onSubmit={handleSubmit}>

          <label>
            Nombre del comprador
          </label>

          <input
            type="text"
            placeholder="Ej. Juan Pérez"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            required
          />

          <label>
            Fecha
          </label>

          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />

          <label>
            Hora
          </label>

          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />

          <label>
            Mensaje
          </label>

          <textarea
            placeholder="Escribe un mensaje para el vendedor..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <button
            type="submit"
            className="submit-appointment"
          >
            Solicitar cita
          </button>

        </form>

      </div>

    </div>
  )
}

export default AppointmentForm