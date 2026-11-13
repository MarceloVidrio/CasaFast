import { useState } from 'react'

function Login({ onRegister }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()

    const savedUsers = localStorage.getItem(
      'casafast_users'
    )

    const users = savedUsers
      ? JSON.parse(savedUsers)
      : []

    const user = users.find(
      (registeredUser) =>
        registeredUser.email.toLowerCase() ===
          email.toLowerCase() &&
        registeredUser.password === password
    )

    if (!user) {
      alert(
        'Correo o contraseña incorrectos.'
      )

      return
    }

    const session = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }

    localStorage.setItem(
      'casafast_current_user',
      JSON.stringify(session)
    )

    alert(
      `Bienvenido a CasaFast, ${user.name}`
    )
  }

  return (
    <section className="login-section">

      <div className="login-card">

        <h1>
          Iniciar sesión
        </h1>

        <p>
          Accede a tu cuenta de CasaFast.
        </p>

        <form onSubmit={handleSubmit}>

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

          <button
            type="submit"
            className="login-button"
          >
            Iniciar sesión
          </button>

        </form>

        <div className="account-switch">

          ¿No tienes una cuenta?

          <button
            type="button"
            onClick={onRegister}
          >
            Regístrate
          </button>

        </div>

      </div>

    </section>
  )
}

export default Login