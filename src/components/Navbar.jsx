function Navbar({
  onRegister,
  onLogin,
  onSellerDashboard,
  onShowHome,
  currentUser
}) {
  return (
    <nav className="navbar">

      <button
        className="navbar-logo"
        onClick={onShowHome}
      >
        CASAFAST
      </button>

      <div className="navbar-links">

        <button
          className="navbar-link-button"
          onClick={onShowHome}
        >
          Comprar
        </button>

        <button
          className="navbar-link-button"
          onClick={onShowHome}
        >
          Rentar
        </button>

        {currentUser ? (

          <span className="navbar-user">
            👤 {currentUser.name}
          </span>

        ) : (

          <>
            <button
              className="navbar-action"
              onClick={onLogin}
            >
              Iniciar sesión
            </button>

            <button
              className="navbar-action"
              onClick={onRegister}
            >
              Registrarse
            </button>
          </>

        )}

        {currentUser &&
          currentUser.role === 'vendedor' && (

            <button
              className="navbar-action"
              onClick={onSellerDashboard}
            >
              Panel vendedor
            </button>

          )}

      </div>

    </nav>
  )
}

export default Navbar