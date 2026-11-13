import { useEffect, useState } from 'react'
import { api } from './lib'

export function readEmailAction() {
  const hash=new URLSearchParams(window.location.hash.slice(1))
  if(hash.has('verify'))return {mode:'verify',token:hash.get('verify')}
  if(hash.has('reset'))return {mode:'reset',token:hash.get('reset')}
  return {mode:'home',token:''}
}

export function AuthForm({mode,onSuccess,onNavigate,token=''}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(null),[config,setConfig]=useState(null)
  useEffect(()=>{let current=true;api('config').then(c=>{if(current)setConfig(c)}).catch(()=>{if(current)setError('No se pudo consultar el servicio. Recarga la página.')});return()=>{current=false}},[])
  const register=mode==='register',emailOnly=['forgot','resend'].includes(mode),needsMail=register||emailOnly
  const titles={login:'Qué gusto verte de nuevo.',register:'Hagamos espacio para ti.',forgot:'Recupera el acceso a tu hogar.',resend:'Confirma que este correo es tuyo.',verify:'Un último paso para empezar.',reset:'Elige una nueva contraseña.'}
  const descriptions={login:'Entra para continuar con tus propiedades y visitas.',register:'Te enviaremos un enlace para verificar tu correo antes de entrar.',forgot:'Escribe tu correo. Te enviaremos un enlace de recuperación si corresponde a una cuenta.',resend:'Solicita un nuevo enlace de verificación. El anterior dejará de funcionar.',verify:'Confirma tu correo para activar el acceso a tu cuenta.',reset:'El enlace solo puede utilizarse una vez y vence en 30 minutos.'}
  const labels={login:'Iniciar sesión',register:'Crear cuenta y verificar correo',forgot:'Enviar enlace de recuperación',resend:'Reenviar verificación',verify:'Verificar mi correo',reset:'Guardar nueva contraseña'}
  async function submit(e) {
    e.preventDefault();setBusy(true);setError('')
    try {
      const data=Object.fromEntries(new FormData(e.currentTarget))
      if(mode==='reset'&&data.password!==data.confirm)throw new Error('Las contraseñas no coinciden.')
      const paths={login:'login',register:'register',forgot:'password/forgot',resend:'email/resend',verify:'email/verify',reset:'password/reset'}
      const response=await api(paths[mode],'POST',{...data,token})
      if(mode==='login')await onSuccess(response)
      else setResult(response)
    }catch(err){setError(err.message)}finally{setBusy(false)}
  }
  return <section className="auth-layout"><div className="auth-story"><span className="eyebrow">UN NUEVO COMIENZO</span><h1>Tu próximo capítulo<br/>empieza en casa.</h1><p>Encuentra un lugar para vivir o conecta tu propiedad con las personas indicadas.</p><div className="auth-photo"/></div><div className="form-panel">
    <span className="eyebrow">TU CUENTA CASAFAST</span><h2>{titles[mode]}</h2>
    {result?<div className="auth-result" role="status"><span className="result-icon">✓</span><h3>{mode==='register'?'Cuenta pendiente de verificación':mode==='verify'?'Correo confirmado':mode==='reset'?'Contraseña actualizada':'Solicitud recibida'}</h3>
      {result.delivery==='preview'?<p><strong>Modo de prueba local:</strong> no se envió un correo real. El enlace está en el archivo de vista previa que guarda el administrador.</p>:<p>{result.message||(mode==='register'?`Enviamos un enlace a ${result.email}. Abre tu correo, revisa también spam y confirma tu dirección para iniciar sesión.`:'Revisa tu correo para continuar.')}</p>}
      <button className="primary" onClick={()=>onNavigate('login')}>Ir a iniciar sesión →</button>{['register','resend'].includes(mode)&&<button className="text-button" onClick={()=>{setResult(null);onNavigate('resend')}}>Solicitar otro enlace</button>}
    </div>:<><p>{descriptions[mode]}</p>
    {needsMail&&config&&!config.emailEnabled&&<div className="info-box" role="status">El servicio de correo aún está pendiente de activación. Podrás {register?'registrarte':'solicitar el enlace'} cuando esté habilitado.</div>}
    {needsMail&&config?.emailMode==='preview'&&<div className="info-box">Modo de prueba local: se generará una vista previa del correo; no se enviará a tu bandeja.</div>}
    <form onSubmit={submit}>
      {register&&<label>Nombre completo<input name="name" autoComplete="name" required maxLength="100"/></label>}
      {!['verify','reset'].includes(mode)&&<label>Correo electrónico<input name="email" type="email" autoComplete="email" required maxLength="200"/></label>}
      {!emailOnly&&mode!=='verify'&&<label>{mode==='reset'?'Nueva contraseña':'Contraseña'}<input name="password" type="password" autoComplete={mode==='login'?'current-password':'new-password'} minLength={mode==='login'?1:10} maxLength="128" required/>{mode!=='login'&&<small>Entre 10 y 128 caracteres.</small>}</label>}
      {mode==='reset'&&<label>Confirma la nueva contraseña<input name="confirm" type="password" autoComplete="new-password" minLength="10" maxLength="128" required/></label>}
      {register&&<label>¿Cómo quieres usar CasaFast?<select name="role"><option value="comprador">Busco comprar o rentar</option><option value="vendedor">Quiero publicar una propiedad</option></select></label>}
      {error&&<p role="alert" className="error">{error}</p>}
      <button className="primary" disabled={busy||(needsMail&&!config?.emailEnabled)}>{busy?'Un momento…':labels[mode]} <span>→</span></button>
    </form>
    {mode==='login'&&<div className="auth-links"><button onClick={()=>onNavigate('forgot')}>Olvidé mi contraseña</button><button onClick={()=>onNavigate('resend')}>Reenviar verificación</button></div>}
    <p className="switch">{mode==='login'?'¿Primera vez aquí?':'¿Ya tienes acceso?'} <button onClick={()=>onNavigate(mode==='login'?'register':'login')}>{mode==='login'?'Crea una cuenta':'Inicia sesión'}</button></p>
    {['verify','reset'].includes(mode)&&<button className="text-button" onClick={()=>onNavigate(mode==='verify'?'resend':'forgot')}>Solicitar un enlace nuevo</button>}
    </>}
  </div></section>
}
