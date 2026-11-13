import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtempSync,readdirSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {createApi} from './api.mjs'
import {createMailer} from './email.mjs'
import {createGeocoder,parseGeocode} from './locations.mjs'
import {testServices,samplePlace,sampleAddress,uploadDocuments} from './test-fixtures.mjs'

async function fixture(options){
 const directory=mkdtempSync(join(tmpdir(),'casafast-security-'))
 let server,base
 async function start(){server=createServer(createApi(directory,options));await new Promise((resolve,reject)=>{const bind=()=>server.listen(20000+Math.floor(Math.random()*30000),'127.0.0.1',resolve);server.on('error',e=>e.code==='EADDRINUSE'?bind():reject(e));bind()});base=`http://127.0.0.1:${server.address().port}`}
 await start()
 return {directory,db:()=>new DatabaseSync(join(directory,'casafast.sqlite')),
  async call(path,method='GET',body,cookie='') {const res=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]}},
  async restart(){await new Promise(r=>server.close(r));await start()},async close(){await new Promise(r=>server.close(r))}}
}
const account={name:'Usuario de prueba',email:'persona@example.test',password:'Original-segura-2026',role:'vendedor'}
async function loginVerified(f,emails,data=account){assert.equal((await f.call('register','POST',data)).status,202);const token=emails.findLast(e=>e.email===data.email).token;assert.equal((await f.call('email/verify','POST',{token})).status,200);return f.call('login','POST',data)}

test('Verificación obligatoria, tokens de un solo uso y recuperación con revocación de sesiones',async()=>{
 const {options,emails}=testServices(),f=await fixture(options)
 try{
  const registration=await f.call('register','POST',account)
  assert.equal(registration.status,202);assert.equal(registration.cookie,undefined);assert.equal(registration.data.token,undefined)
  assert.equal((await f.call('login','POST',account)).status,403)
  const verify=emails[0].token,db=f.db()
  assert.notEqual(db.prepare('SELECT token FROM email_tokens').get().token,verify)
  assert.equal((await f.call('password/reset','POST',{token:verify,password:'Una-nueva-segura'})).status,400)
  assert.equal((await f.call('email/verify','POST',{token:verify})).status,200)
  assert.equal((await f.call('email/verify','POST',{token:verify})).status,400)
  const first=await f.call('login','POST',account),second=await f.call('login','POST',account)
  assert.equal(first.status,200);assert.match(first.cookie,/casafast_session=/)
  await f.restart()
  const known=await f.call('password/forgot','POST',{email:account.email}),unknown=await f.call('password/forgot','POST',{email:'nobody@example.test'})
  assert.equal(known.status,202);assert.deepEqual(known.data,unknown.data)
  const reset=emails.findLast(e=>e.purpose==='reset').token
  assert.equal((await f.call('email/verify','POST',{token:reset})).status,400)
  assert.equal((await f.call('password/reset','POST',{token:reset,password:'short'})).status,400)
  const changed=await f.call('password/reset','POST',{token:reset,password:'Nueva-clave-segura-2026'})
  assert.equal(changed.status,200);assert.equal(changed.cookie,undefined)
  for(const session of [first,second])assert.equal((await f.call('session','GET',undefined,session.cookie)).data,null)
  assert.equal((await f.call('password/reset','POST',{token:reset,password:'Otra-clave-segura-2026'})).status,400)
  assert.equal((await f.call('login','POST',account)).status,401)
  assert.equal((await f.call('login','POST',{...account,password:'Nueva-clave-segura-2026'})).status,200)
  db.close()
 }finally{await f.close()}
})

test('Reenvío invalida el enlace anterior, respeta caducidad y limita solicitudes',async()=>{
 const {options,emails}=testServices(),f=await fixture(options)
 try{
  await f.call('register','POST',account);const first=emails[0].token
  assert.equal((await f.call('email/resend','POST',{email:account.email})).status,429)
  await f.restart()
  assert.equal((await f.call('email/resend','POST',{email:account.email})).status,202)
  assert.equal((await f.call('email/verify','POST',{token:first})).status,400)
  const latest=emails.at(-1).token,db=f.db();db.prepare('UPDATE email_tokens SET expires=?').run(Date.now()-1);db.close()
  assert.equal((await f.call('email/verify','POST',{token:latest})).status,400)
  assert.equal((await f.call('login','POST',account)).status,403)
 }finally{await f.close()}
})

test('Sin configuración no se simulan envíos ni se crean cuentas verificadas',async()=>{
 const f=await fixture({env:{}})
 try{
  assert.equal((await f.call('register','POST',account)).status,503)
  assert.equal((await f.call('password/forgot','POST',{email:account.email})).status,503)
  const config=(await f.call('config')).data
  assert.equal(config.emailEnabled,false);assert.equal(config.mapsEnabled,true) // El mapa base de OpenStreetMap no requiere claves.
  const db=f.db();assert.equal(db.prepare('SELECT count(*) n FROM users WHERE email=?').get(account.email).n,0);db.close()
 }finally{await f.close()}
})

test('Errores de envío dejan la cuenta pendiente sin un token válido',async()=>{
 const {options}=testServices();options.mailer.send=async()=>{throw Object.assign(new Error('Servicio no disponible'),{status:503})}
 const f=await fixture(options)
 try{assert.equal((await f.call('register','POST',account)).status,503);const db=f.db();assert.equal(db.prepare('SELECT verified FROM users WHERE email=?').get(account.email).verified,0);assert.equal(db.prepare('SELECT count(*) n FROM email_tokens').get().n,0);db.close()}finally{await f.close()}
})

test('La dirección se valida en servidor y no acepta pruebas ajenas, caducadas o alteradas',async()=>{
 const {options,emails}=testServices(),f=await fixture(options)
 try{
  const seller=await loginVerified(f,emails),other=await loginVerified(f,emails,{...account,email:'otra@example.test'})
  const payload={lat:samplePlace.lat,lng:samplePlace.lng,locationDetails:sampleAddress,confirmed:true}
  assert.equal((await f.call('locations/confirm','POST',payload)).status,401)
  assert.equal((await f.call('locations/confirm','POST',{...payload,confirmed:false},seller.cookie)).status,400)
  assert.equal((await f.call('locations/confirm','POST',{...payload,lat:95},seller.cookie)).status,400)
  assert.equal((await f.call('locations/confirm','POST',{...payload,locationDetails:{...sampleAddress,city:'Ciudad inventada'}},seller.cookie)).status,400)
  const valid=await f.call('locations/confirm','POST',payload,seller.cookie);assert.equal(valid.status,200)
  const image=readFileSync(new URL('../public/images/casa1.jpg',import.meta.url)).toString('base64')
  const upload=await f.call('upload','POST',{image:`data:image/jpeg;base64,${image}`},seller.cookie)
  const documents=await uploadDocuments(f.call,seller.cookie)
  const p={...payload,documents,locationToken:valid.data.locationToken,title:'Propiedad de prueba',description:'Datos de prueba',type:'Casa',operation:'venta',price:1000000,bedrooms:3,bathrooms:2,area:150,images:[upload.data.url]}
  assert.equal((await f.call('properties','POST',p,other.cookie)).status,400)
  assert.equal((await f.call('properties','POST',{...p,lat:p.lat+0.1},seller.cookie)).status,400)
  assert.equal((await f.call('properties','POST',{...p,locationDetails:{...sampleAddress,street:'Calle inventada'}},seller.cookie)).status,400)
  const created=await f.call('properties','POST',p,seller.cookie);assert.equal(created.status,201);assert.equal(created.data.locationVerification.provider,'openstreetmap')
  const db=f.db();db.prepare('UPDATE location_checks SET expires=?').run(Date.now()-1);db.close()
  assert.equal((await f.call('properties','POST',p,seller.cookie)).status,400)
  // Unchanged, previously verified location can retain its proof when only price changes.
  assert.equal((await f.call(`properties/${created.data.id}`,'PUT',{...p,locationToken:'',price:1200000},seller.cookie)).status,200)
 }finally{await f.close()}
})

test('Adaptadores de servicios: modo local, campos de OpenStreetMap, errores y claves privadas',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'casafast-mail-'))
 const preview=createMailer({APP_URL:'http://localhost:5173',EMAIL_MODE:'preview'},directory)
 await preview.send({email:'test@example.test',name:'<script>bad</script>',purpose:'verify',token:'a'.repeat(64)})
 const html=readFileSync(join(directory,'mail-preview',readdirSync(join(directory,'mail-preview'))[0]),'utf8')
 assert.ok(html.includes('#verify='));assert.ok(!html.includes('<script>bad</script>'))
 assert.equal(createMailer({APP_URL:'https://example.com',EMAIL_MODE:'preview'},directory).enabled,false)
 assert.equal(createMailer({APP_URL:'http://localhost:5173',EMAIL_MODE:'preview',NODE_ENV:'production'},directory).enabled,false)
 let sent
 const mailer=createMailer({APP_URL:'https://casafast.example',EMAIL_MODE:'resend',RESEND_API_KEY:'private-test-key',EMAIL_FROM:'CasaFast <cuentas@casafast.example>'},directory,async(url,options)=>{sent={url,...options};return {ok:true}})
 await mailer.send({email:'user@example.test',name:'Test',purpose:'reset',token:'b'.repeat(64)})
 assert.equal(sent.url,'https://api.resend.com/emails');assert.ok(JSON.parse(sent.body).text.includes('#reset='))
 const raw={address:{road:'Calle Primavera',city:'Culiacán Rosales',state:'Sinaloa',country_code:'mx',suburb:'Las Quintas'},lat:'24.801',lon:'-107.374',place_id:'place-test',display_name:'Dirección de prueba',type:'house',addresstype:'building'}
 assert.equal(parseGeocode(raw).address.neighborhood,'Las Quintas')
 const geocoder=createGeocoder({NOMINATIM_CONTACT_EMAIL:'test@example.invalid'},async()=>({ok:true,json:async()=>[raw]}))
 assert.equal((await geocoder.lookup({address:'test'}))[0].country,'MX')
 const unavailable=createGeocoder({NOMINATIM_CONTACT_EMAIL:'other@example.invalid'},async()=>{throw new Error('private-key-details')})
 await assert.rejects(()=>unavailable.lookup({address:'unavailable'}),error=>error.status===503&&!error.message.includes('private-key-details'))
 const f=await fixture({env:{RESEND_API_KEY:'email-secret',GOOGLE_MAPS_SERVER_KEY:'maps-secret',GOOGLE_MAPS_BROWSER_KEY:'public-browser-key'}})
 try{const result=await f.call('config');assert.ok(!JSON.stringify(result.data).includes('email-secret'));assert.ok(!JSON.stringify(result.data).includes('maps-secret'))}finally{await f.close()}
})
