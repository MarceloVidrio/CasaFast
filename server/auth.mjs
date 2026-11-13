import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import { createMailer } from './email.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}) }
const safe = u => ({id:u.id,name:u.name,email:u.email,role:u.role,active:!!u.active,emailVerified:!!u.verified})
const emailValue = value => {
  if(typeof value !== 'string' || value.length>200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) fail('Escribe un correo válido.')
  return value.trim().toLowerCase()
}
const passwordValue = (value,min=10) => { if(typeof value!=='string'||value.length<min||value.length>128)fail(`La contraseña debe tener entre ${min} y 128 caracteres.`);return value }
const passwordHash = password => {const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`}

export function createAuth(db,{env,dataDir,mailer:providedMailer}) {
  if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='verified')) db.exec('ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0')
  db.exec(`CREATE TABLE IF NOT EXISTS email_tokens(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose TEXT NOT NULL,expires INTEGER NOT NULL,created INTEGER NOT NULL);`)
  const mailer=providedMailer||createMailer(env,dataDir)
  const limits=new Map()
  function limit(key,max,windowMs) {
    const now=Date.now()
    for(const [k,v] of limits)if(v.until<=now)limits.delete(k)
    const entry=limits.get(key)||{count:0,until:now+windowMs}
    if(entry.count>=max)fail('Demasiados intentos. Espera un momento antes de volver a intentar.',429)
    entry.count++;limits.set(key,entry)
  }
  const requireMail = () => {if(!mailer.enabled)fail('El envío de correo aún no está configurado. Contacta al administrador.',503)}
  async function issue(account,purpose) {
    const token=randomBytes(32).toString('hex'),digest=hash(token),now=Date.now()
    db.prepare('DELETE FROM email_tokens WHERE expires<=?').run(now)
    db.prepare('INSERT INTO email_tokens VALUES(?,?,?,?,?)').run(digest,account.id,purpose,now+(purpose==='verify'?86400000:1800000),now)
    try {await mailer.send({email:account.email,name:account.name,purpose,token})}
    catch(error){db.prepare('DELETE FROM email_tokens WHERE token=?').run(digest);throw error}
    db.prepare('DELETE FROM email_tokens WHERE user_id=? AND purpose=? AND token<>?').run(account.id,purpose,digest)
  }
  function tokenRow(token,purpose) {
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail('El enlace no es válido o ya caducó. Solicita uno nuevo.')
    const row=db.prepare('SELECT t.* FROM email_tokens t JOIN users u ON t.user_id=u.id WHERE t.token=? AND t.purpose=? AND t.expires>? AND u.active=1').get(hash(token),purpose,Date.now())
    if(!row)fail('El enlace no es válido, ya fue utilizado o caducó. Solicita uno nuevo.')
    return row
  }
  return {
    config:{emailEnabled:mailer.enabled,emailMode:mailer.mode==='preview'?'preview':mailer.enabled?'live':'disabled'},
    async handle({path,method,body,req,res,send,token}) {
      if(method!=='POST'||!['/api/register','/api/login','/api/logout','/api/email/resend','/api/email/verify','/api/password/forgot','/api/password/reset'].includes(path))return false
      const ip=req.socket.remoteAddress||'local'
      if(path!=='/api/logout')limit(`auth:${ip}`,30,60000)
      if(path==='/api/logout') {
        if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token))
        res.setHeader('Set-Cookie','casafast_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');send({ok:true});return true
      }
      if(path==='/api/register') {
        requireMail()
        const email=emailValue(body.email),password=passwordValue(body.password)
        if(!['comprador','vendedor'].includes(body.role))fail('Rol inválido.')
        if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100)fail('Escribe tu nombre (máximo 100 caracteres).')
        if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail('Este correo ya tiene una cuenta. Inicia sesión o solicita un nuevo enlace de verificación.',409)
        limit(`send:${hash(email)}`,1,60000)
        const id=randomUUID()
        db.prepare('INSERT INTO users(id,name,email,password,role,verified) VALUES(?,?,?,?,?,0)').run(id,body.name.trim(),email,passwordHash(password),body.role)
        const account=db.prepare('SELECT * FROM users WHERE id=?').get(id)
        try {await issue(account,'verify')}catch(error){throw Object.assign(new Error('Tu cuenta quedó pendiente de verificación, pero no pudimos enviar el correo. Usa «Reenviar verificación» más tarde.'),{status:error.status||503})}
        send({verificationRequired:true,email,delivery:mailer.mode==='preview'?'preview':'email'},202);return true
      }
      if(path==='/api/login') {
        const email=emailValue(body.email),password=passwordValue(body.password,1)
        limit(`login:${hash(email)}`,10,15*60000)
        const account=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email)
        const [salt,stored]=account?.password?.split(':')||['invalid','00'.repeat(64)]
        if(!timingSafeEqual(scryptSync(password,salt,64),Buffer.from(stored,'hex'))||!account)fail('Correo o contraseña incorrectos.',401)
        if(!account.verified)fail('Confirma tu correo antes de iniciar sesión. Si lo necesitas, solicita otro enlace en «Reenviar verificación».',403)
        const session=randomBytes(32).toString('hex')
        db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now())
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(session),account.id,Date.now()+7*86400000)
        const secure=env.APP_URL?.startsWith('https://')||req.socket.encrypted
        res.setHeader('Set-Cookie',`casafast_session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure?'; Secure':''}`)
        send(safe(account));return true
      }
      if(['/api/email/resend','/api/password/forgot'].includes(path)) {
        requireMail()
        const email=emailValue(body.email)
        limit(`send:${hash(email)}`,1,60000)
        const account=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email)
        const verify=path==='/api/email/resend'
        if(account&&(!verify||!account.verified))await issue(account,verify?'verify':'reset')
        send({message:'Si el correo corresponde a una cuenta elegible, recibirás un enlace para continuar.',delivery:mailer.mode==='preview'?'preview':'email'},202);return true
      }
      const verify=path==='/api/email/verify'
      const password=verify?null:passwordValue(body.password)
      const row=tokenRow(body.token,verify?'verify':'reset')
      const encoded=verify?null:passwordHash(password)
      db.exec('BEGIN IMMEDIATE')
      try {
        const used=db.prepare('DELETE FROM email_tokens WHERE token=? AND expires>?').run(row.token,Date.now())
        if(used.changes!==1)fail('Este enlace ya fue utilizado. Solicita uno nuevo.')
        if(verify)db.prepare('UPDATE users SET verified=1 WHERE id=?').run(row.user_id)
        else {db.prepare('UPDATE users SET password=? WHERE id=?').run(encoded,row.user_id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id)}
        db.prepare('DELETE FROM email_tokens WHERE user_id=? AND purpose=?').run(row.user_id,verify?'verify':'reset')
        db.exec('COMMIT')
      }catch(error){db.exec('ROLLBACK');throw error}
      send({message:verify?'Correo verificado. Ya puedes iniciar sesión.':'Contraseña actualizada. Inicia sesión de nuevo en tus dispositivos.'});return true
    },
  }
}
