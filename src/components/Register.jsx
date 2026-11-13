import { useState } from 'react'

function Register({ onLogin }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('comprador')

  const handleSubmit = (e) => {
    e.preventDefault()

    const savedUsers = localStorage.getItem(
      'casafast_users'
    )

    const users = savedUsers
      ? JSON.parse(savedUsers)
      : []

    const userAlreadyExists = users.some(
      (user) =>
        user.email.toLowerCase() ===
        email.toLowerCase()
    )

    if (userAlreadyExists) {
      alert(
        'Ya existe una cuenta registrada con este correo.'
      )

      return
    }

    const newUser = {
      id: Date.now(),
      name,
      email,
      password,
      role
    }

    const updatedUsers = [
      ...users,
      newUser
    ]

    localStorage.setItem(
      'casafast_users',
      JSON.stringify(updatedUsers)
    )

    alert(
      'Usuario registrado correctamente'
    )

    setName('')
    setEmail('')
    setPassword('')
    setRole('comprador')

    onLogin()
  }

  return (
    <section className="register-section">

      <div className="register-card">

        <h1>
          Crear una cuenta
        </h1>

        <p>
          Regístrate en CasaFast para comenzar.
        </p>

        <form onSubmit={handleSubmit}>

          <label>
            Nombre completo
          </label>

          <input
            type="text"
            placeholder="Tu nombre"
            value={name}
            onChange={(e) =>
              setName(e.target.value)
            }
            required
          />

          <label>
            Correo electrónico
          </label>

          <input
            type="email"
            placeholder="correo@ejemplo.com"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            required
          />

          <label>
            Contraseña
          </label>

          <input
            type="password"
            placeholder="Tu contraseña"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            required
          />

          <label>
            Tipo de usuario
          </label>

          <select
            value={role}
            onChange={(e) =>
              setRole(e.target.value)
            }
          >
            <option value="comprador">
              Comprador / Arrendatario
            </option>

            <option value="vendedor">
              Vendedor
            </option>
          </select>

          <button
            type="submit"
            className="register-button"
          >
            Registrarse
          </button>

        </form>

        <div className="account-switch">

          ¿Ya tienes una cuenta?

          <button
            type="button"
            onClick={onLogin}
          >
            Inicia sesión
          </button>

        </div>

      </div>

    </section>
  )
}

export default Register