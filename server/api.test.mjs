import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync,readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApi } from './api.mjs'
import { testServices,sampleAddress,samplePlace,uploadDocuments } from './test-fixtures.mjs'

test('Recorrido completo: cuentas, permisos, imágenes, publicaciones, favoritos, citas y persistencia',async()=>{
 const {options,emails}=testServices()
 const dir=mkdtempSync(join(tmpdir(),'casafast-test-'))
 let server=createServer(createApi(dir,options));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 let base=`http://127.0.0.1:${server.address().port}`
 async function call(path,method='GET',body,cookie=''){
   const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)})
   const text=await r.text()
   assert.ok(text,`${method} ${path}: empty response, HTTP ${r.status}`)
   return {status:r.status,data:JSON.parse(text),cookie:r.headers.get('set-cookie')?.split(';')[0]}
 }
 async function register(data){
   const registered=await call('register','POST',data);assert.equal(registered.status,202)
   const email=emails.findLast(e=>e.email===data.email)
   assert.equal((await call('email/verify','POST',{token:email.token})).status,200)
   return call('login','POST',data)
 }
 try{
  const registration=role=>({name:'Cuenta de prueba',email:`${role}@example.com`,password:'Prueba-segura-123',role:role==='otro'?'vendedor':role})
  const buyer=await register(registration('comprador'));assert.equal(buyer.status,200)
  const seller=await register(registration('vendedor'));assert.equal(seller.status,200)
  const other=await register(registration('otro'));assert.equal(other.status,200)
  assert.equal((await call('register','POST',registration('admin'))).status,400)
  assert.equal((await call('register','POST',registration('comprador'))).status,409)
  assert.equal((await call('login','POST',{email:'comprador@example.com',password:'incorrecta'})).status,401)
  assert.equal((await call('session','GET',undefined,buyer.cookie)).data.role,'comprador')
  assert.equal((await call('properties','POST',{})).status,401)
  assert.equal((await call('properties','POST',{},buyer.cookie)).status,403)
  assert.equal((await call('upload','POST',{image:'data:image/png;base64,aGVsbG8='},seller.cookie)).status,400)
  const image=readFileSync(new URL('../public/images/casa1.jpg',import.meta.url)).toString('base64')
  const upload=await call('upload','POST',{image:`data:image/jpeg;base64,${image}`},seller.cookie);assert.equal(upload.status,200)
  assert.equal((await fetch(base+upload.data.url)).status,200)
  const check=await call('locations/confirm','POST',{lat:samplePlace.lat,lng:samplePlace.lng,locationDetails:sampleAddress,confirmed:true},seller.cookie);assert.equal(check.status,200)
  const property={locationToken:check.data.locationToken,locationDetails:sampleAddress,title:'Casa de prueba',operation:'venta',type:'Casa',price:2500000,description:'Una casa de prueba con jardín.',location:'Culiacán',address:'Dirección de prueba',area:180,bedrooms:3,bathrooms:2,lat:samplePlace.lat,lng:samplePlace.lng,images:[upload.data.url]}
  assert.equal((await call('properties','POST',property,seller.cookie)).status,400)
  property.documents=await uploadDocuments(call,seller.cookie)
  const created=await call('properties','POST',property,seller.cookie);assert.equal(created.status,201);const id=created.data.id
  assert.equal(created.data.review.status,'pendiente')
  assert.ok(!(await call('properties','GET',undefined,buyer.cookie)).data.some(p=>p.id===id))
  assert.equal((await call('favorites','POST',{id,saved:true},buyer.cookie)).status,404)
  { const approve=new DatabaseSync(join(dir,'casafast.sqlite'));approve.prepare("UPDATE property_reviews SET status='aprobada' WHERE property_id=?").run(id);approve.close() }
  assert.equal((await call(`properties/${id}`,'PUT',property,other.cookie)).status,403)
  assert.equal((await call(`properties/${id}`,'DELETE',{},other.cookie)).status,403)
  assert.equal((await call(`properties/${id}`,'PUT',{...property,title:'Casa actualizada'},seller.cookie)).status,200)
  assert.equal((await call('favorites','POST',{id,saved:true},buyer.cookie)).status,200)
  assert.deepEqual((await call('favorites','GET',undefined,buyer.cookie)).data,[id])
  assert.equal((await call('appointments','POST',{propertyId:id,date:'2020-01-01'},buyer.cookie)).status,400)
  assert.equal((await call('appointments','POST',{propertyId:'demo-1',date:new Date(Date.now()+86400000).toISOString()},buyer.cookie)).status,400)
  const day=new Date(Date.now()+2*86400000);day.setUTCHours(17,0,0,0)
  assert.equal((await call(`visit-slots/${id}`,'POST',{dates:[day.toISOString()]},seller.cookie)).status,200)
  const slot=(await call(`visit-slots/${id}`,'GET',undefined,buyer.cookie)).data.slots[0]
  const visit={propertyId:id,slotId:slot.id,message:'Quisiera visitar la casa.'}
  const appointment=await call('appointments','POST',visit,buyer.cookie);assert.equal(appointment.status,201)
  assert.equal((await call('appointments','POST',visit,buyer.cookie)).status,409)
  assert.equal((await call('appointments','GET',undefined,other.cookie)).data.length,0)
  assert.equal((await call(`appointments/${appointment.data.id}`,'PATCH',{status:'Aceptada',revision:1},other.cookie)).status,403)
  assert.equal((await call(`appointments/${appointment.data.id}`,'PATCH',{status:'Aceptada',revision:1},seller.cookie)).status,200)
  assert.equal((await call('appointments','GET',undefined,buyer.cookie)).data[0].status,'Aceptada')
  assert.equal((await call(`appointments/${appointment.data.id}`,'PATCH',{status:'Rechazada',revision:2},seller.cookie)).status,409)
  assert.equal((await call('admin/users','GET',undefined,buyer.cookie)).status,403)
  const db=new DatabaseSync(join(dir,'casafast.sqlite'))
  assert.notEqual(db.prepare('SELECT password FROM users WHERE id=?').get(buyer.data.id).password,'Prueba-segura-123')
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(other.data.id);db.close()
  assert.equal((await call('admin/users','GET',undefined,other.cookie)).status,200)
  assert.equal((await call('logout','POST',{},buyer.cookie)).status,200)
  assert.equal((await call('session','GET',undefined,buyer.cookie)).data,null)
  await new Promise(r=>server.close(r));server=createServer(createApi(dir,options));await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`
  assert.ok((await call('properties')).data.some(p=>p.id===id&&p.title==='Casa actualizada'))
  assert.equal((await call('appointments','GET',undefined,seller.cookie)).data.length,1)
  assert.equal((await call(`properties/${id}`,'DELETE',{},seller.cookie)).status,200)
  assert.ok(!(await call('properties')).data.some(p=>p.id===id))
  assert.ok((await call('properties','GET',undefined,seller.cookie)).data.some(p=>p.id===id&&!p.active))
  assert.equal((await call(`admin/users/${seller.data.id}`,'PATCH',{active:false},other.cookie)).status,200)
  assert.equal((await call('session','GET',undefined,seller.cookie)).data,null)
  // An intentionally cleared catalog must remain empty on the next startup.
  const resetDb=new DatabaseSync(join(dir,'casafast.sqlite'))
  resetDb.exec('DELETE FROM favorites; DELETE FROM appointments; DELETE FROM sessions; DELETE FROM properties; DELETE FROM email_tokens; DELETE FROM location_checks; DELETE FROM users;')
  resetDb.close()
  await new Promise(r=>server.close(r));server=createServer(createApi(dir,options));await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`
  assert.deepEqual((await call('properties')).data,[])
 }finally{await new Promise(r=>server.close(r))}
})
