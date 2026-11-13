import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { createApi } from './api.mjs'
import { createMailer } from './email.mjs'

async function fixture(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(),'casafast-visits-')), emails=[]
  const env={APP_URL:'http://localhost:5173',WHATSAPP_MODE:'preview',...extra.env}
  const mailer={enabled:true, mode:'test', async send(m) { emails.push(m) }}
  const server=createServer(createApi(dir,{env,mailer:extra.mailer||mailer,notificationRequest:extra.request}))
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve) })
  const base=`http://127.0.0.1:${server.address().port}`
  const db=new DatabaseSync(join(dir,'casafast.sqlite'))
  for(const [id,role] of [['seller','vendedor'],['buyer','comprador'],['other','comprador'],['seller2','vendedor']]) {
    db.prepare('INSERT INTO users(id,name,email,password,role,active,verified) VALUES(?,?,?,?,?,1,1)').run(id,id,`${id}@example.invalid`,'',role)
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(id).digest('hex'),id,Date.now()+86400000)
  }
  for(const [id,seller] of [['house','seller'],['house2','seller'],['house3','seller2']]) db.prepare('INSERT INTO properties(id,seller_id,data,active) VALUES(?,?,?,1)').run(id,seller,JSON.stringify({title:id,address:'Calle de prueba 123, Culiacán',lat:24.8,lng:-107.4,images:[],demo:false}))
  const call=async(path,method='GET',body,who='buyer') => {
    const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:`casafast_session=${who}`},body:body===undefined?undefined:JSON.stringify(body)})
    return {status:r.status,data:await r.json()}
  }
  const date=n=>{const d=new Date(Date.now()+(n+2)*86400000);d.setUTCHours(17,0,0,0);return d.toISOString()}
  const slots=async(property='house',who='seller')=>{const r=await call(`visit-slots/${property}`,'POST',{dates:[date(0),date(1),date(2)]},who);assert.equal(r.status,200,JSON.stringify(r.data));return (await call(`visit-slots/${property}`,'GET',undefined,who)).data.slots}
  const current=async(id,who='buyer')=>(await call('appointments','GET',undefined,who)).data.find(a=>a.id===id)
  const change=async(a,status,who,extra={})=>call(`appointments/${a.id}`,'PATCH',{status,revision:a.revision,...extra},who)
  return {dir,db,emails,call,date,slots,current,change,close:async()=>{await new Promise(r=>server.close(r));db.close()}}
}

test('Disponibilidad real, permisos, reserva exclusiva, confirmación y ubicación en avisos consentidos',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('visit-slots/house','POST',{dates:[f.date(0)]},'buyer')).status,403)
  assert.equal((await f.call('visit-slots/house','POST',{dates:[new Date().toISOString()]},'seller')).status,400)
  const slots=await f.slots()
  assert.equal((await f.call('visit-slots/house2','POST',{dates:[f.date(0)]},'seller')).status,409)
  assert.equal((await f.call('appointments','POST',{propertyId:'house',date:f.date(0)})).status,400)
  assert.equal((await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id},'seller')).status,400)
  assert.equal((await f.call('appointments','POST',{propertyId:'demo-1',slotId:slots[0].id})).status,400)
  assert.equal((await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id,whatsappConsent:true,phone:'123'})).status,400)
  const request={propertyId:'house',slotId:slots[0].id,whatsappConsent:true,phone:'+526671234567',message:'Me interesa conocerla'}
  const concurrent=await Promise.all([f.call('appointments','POST',request),f.call('appointments','POST',request,'other')])
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409])
  const winner=concurrent[0].status===201?'buyer':'other', loser=winner==='buyer'?'other':'buyer'
  const id=concurrent.find(r=>r.status===201).data.id
  assert.equal((await f.call('visit-slots/house')).data.slots.some(s=>s.id===slots[0].id),false)
  assert.ok(f.emails.every(e=>!e.text.includes('Calle de prueba')))
  let a=await f.current(id,winner)
  assert.equal((await f.change(a,'Aceptada',loser)).status,403)
  assert.equal((await f.change(a,'Aceptada',winner)).status,403)
  assert.equal((await f.change(a,'Aceptada','seller')).status,200)
  assert.equal((await f.change(a,'Aceptada','seller')).status,409)
  a=await f.current(id,winner)
  assert.equal(a.status,'Aceptada'); assert.equal(a.confirmed_address,'Calle de prueba 123, Culiacán')
  assert.equal(a.confirmed_map,'https://maps.google.com/?q=24.8,-107.4')
  assert.ok(f.emails.some(e=>e.text.includes(a.confirmed_map)))
  assert.ok(a.notifications.some(n=>n.channel==='whatsapp'&&n.event==='Aceptada'&&n.state==='preview'))
  const files=readdirSync(join(f.dir,'whatsapp-preview'));assert.ok(files.some(file=>readFileSync(join(f.dir,'whatsapp-preview',file),'utf8').includes(a.confirmed_map)))
  assert.equal((await f.current(id,'seller')).phone,undefined)
  assert.equal((await f.call(`visit-slots/house/${slots[0].id}`,'DELETE',{},'seller')).status,409)
 }finally{await f.close()}
})

test('Reprogramar: el comprador cambia al instante con 12 h de anticipación; el vendedor solo propone o cancela',async()=>{
 const f=await fixture();try{
  const slots=await f.slots(), created=await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id})
  let a=await f.current(created.data.id);await f.change(a,'Aceptada','seller');a=await f.current(a.id)
  // El comprador ya no «propone»: reprograma directo y la visita sigue confirmada en el nuevo horario
  assert.equal((await f.change(a,'Propuesta','buyer',{slotId:slots[1].id})).status,403)
  const moved=await f.change(a,'Reprogramar','buyer',{slotId:slots[1].id})
  assert.equal(moved.status,200,JSON.stringify(moved.data))
  a=await f.current(a.id);assert.equal(a.status,'Aceptada');assert.equal(a.date,slots[1].date);assert.ok(a.confirmed_map)
  assert.equal(a.history.at(-1).event,'Reprogramada')
  assert.ok(f.emails.some(e=>e.subject==='Visita reprogramada'||String(e.text).includes('Visita reprogramada')))
  assert.ok((await f.call('visit-slots/house')).data.slots.some(s=>s.id===slots[0].id))
  // El vendedor no puede reprogramar por su cuenta
  assert.equal((await f.change(a,'Reprogramar','seller',{slotId:slots[2].id})).status,403)
  // El vendedor propone; el comprador rechaza y se conserva el horario
  await f.change(a,'Propuesta','seller',{slotId:slots[2].id});a=await f.current(a.id)
  assert.equal(a.status,'Propuesta');assert.equal(a.date,slots[1].date)
  assert.equal((await f.change(a,'Reprogramar','buyer',{slotId:slots[0].id})).status,409)
  assert.equal((await f.change(a,'Aceptada','seller')).status,403)
  assert.equal((await f.change(a,'Conservar','buyer')).status,200)
  a=await f.current(a.id);assert.equal(a.status,'Aceptada');assert.equal(a.date,slots[1].date)
  // El vendedor propone otra vez; el comprador acepta
  await f.change(a,'Propuesta','seller',{slotId:slots[2].id});a=await f.current(a.id)
  assert.equal((await f.change(a,'Aceptada','buyer')).status,200)
  a=await f.current(a.id);assert.equal(a.date,slots[2].date);assert.equal(a.status,'Aceptada')
  // Menos de 12 horas antes de la visita: ya no se puede reprogramar
  f.db.prepare('UPDATE appointments SET date=? WHERE id=?').run(new Date(Date.now()+6*3600000).toISOString(),a.id);a=await f.current(a.id)
  const late=await f.change(a,'Reprogramar','buyer',{slotId:slots[0].id})
  assert.equal(late.status,409);assert.match(late.data.error,/12 horas/)
  // El vendedor siempre puede cancelar
  assert.equal((await f.change(a,'Cancelada','seller')).status,200)
  assert.equal((await f.current(a.id)).history.at(-1).event,'Cancelada')
 }finally{await f.close()}
})

test('Expiración de reservas y propuestas; cuenta de vendedor también puede comprar sin otra cuenta',async()=>{
 const f=await fixture();try{
  const slots=await f.slots();const created=await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id})
  f.db.prepare('UPDATE appointments SET hold_until=? WHERE id=?').run(Date.now()-1,created.data.id)
  assert.equal((await f.current(created.data.id)).status,'Vencida')
  const created2=await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id});let a=await f.current(created2.data.id)
  await f.change(a,'Aceptada','seller');a=await f.current(a.id);await f.change(a,'Propuesta','seller',{slotId:slots[1].id})
  f.db.prepare('UPDATE appointments SET hold_until=? WHERE id=?').run(Date.now()-1,a.id)
  a=await f.current(a.id);assert.equal(a.status,'Aceptada');assert.equal(a.proposed_date,null)
  const others=await f.slots('house3','seller2')
  assert.equal((await f.call('appointments','POST',{propertyId:'house3',slotId:others[0].id},'seller')).status,201)
  assert.equal((await f.call('account/publishing','POST',{},'buyer')).data.role,'vendedor')
  assert.equal((await f.call('session')).data.role,'vendedor')
 }finally{await f.close()}
})

test('WhatsApp Twilio usa plantilla, no envía sin consentimiento y fallos no revierten la confirmación',async()=>{
 const requests=[];let failing=true
 const f=await fixture({env:{WHATSAPP_MODE:'twilio',TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'secret-test',TWILIO_WHATSAPP_FROM:'+14155238886',TWILIO_VISIT_CONTENT_SID:'HX'+'2'.repeat(32)},request:async(url,init)=>{requests.push({url,init});return failing?new Response('{}',{status:503}):Response.json({sid:'SM-test'})}})
 try{
  const slots=await f.slots();const created=await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id})
  let a=await f.current(created.data.id);await f.change(a,'Aceptada','seller');assert.equal(requests.length,0)
  a=await f.current(a.id);await f.change(a,'Cancelada','buyer')
  const c=await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id,whatsappConsent:true,phone:'+526671234567'})
  a=await f.current(c.data.id);assert.equal((await f.change(a,'Aceptada','seller')).status,200)
  a=await f.current(a.id);assert.equal(a.status,'Aceptada');assert.ok(a.notifications.some(n=>n.state==='failed'))
  const form=new URLSearchParams(requests.at(-1).init.body);assert.equal(form.get('ContentSid'),'HX'+'2'.repeat(32));assert.equal(form.get('To'),'whatsapp:+526671234567');assert.ok(JSON.parse(form.get('ContentVariables'))['6'].includes('24.8,-107.4'))
  const config=await f.call('config');assert.ok(!JSON.stringify(config).includes('secret-test'))
  const failed=a.notifications.find(n=>n.event==='Aceptada'&&n.state==='failed')
  assert.equal((await f.call(`visit-notifications/${failed.id}/retry`,'POST',{},'other')).status,409)
  failing=false;await f.call(`visit-notifications/${failed.id}/retry`,'POST',{})
  assert.ok((await f.current(a.id)).notifications.some(n=>n.id===failed.id&&n.state==='submitted'))
  // A failed old request must be superseded, never delivered after cancellation.
  const old=a.notifications.find(n=>n.event==='Pendiente'&&n.state==='failed')
  a=await f.current(a.id);await f.change(a,'Cancelada','seller')
  const count=requests.length;await f.call(`visit-notifications/${old.id}/retry`,'POST',{})
  assert.equal(requests.length,count)
  assert.equal(f.db.prepare('SELECT state FROM visit_notifications WHERE id=?').get(old.id).state,'superseded')
 }finally{await f.close()}
})

test('Meta integrado: consentimiento, confirmación con ubicación y claves privadas ocultas',async()=>{
 const requests=[]
 const f=await fixture({env:{WHATSAPP_MODE:'meta',META_WHATSAPP_PHONE_NUMBER_ID:'12345678901',META_WHATSAPP_ACCESS_TOKEN:'meta-secret-token-for-testing',META_WHATSAPP_TEMPLATE_NAME:'casafast_visita',META_WHATSAPP_TEMPLATE_LANGUAGE:'es_MX'},request:async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return Response.json({messages:[{id:'wamid-test'}]})}})
 try{
  const slots=await f.slots()
  const c=await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id,whatsappConsent:true,phone:'+526670000000'})
  let a=await f.current(c.data.id)
  assert.equal(requests.length,1);assert.equal(requests[0].body.template.components[0].parameters[5].text,'Te la enviaremos en cuanto se confirme la visita.')
  assert.match(requests[0].body.template.components[0].parameters[4].text,/La dirección exacta llega al confirmar la visita\.$/)
  assert.equal((await f.change(a,'Aceptada','seller')).status,200)
  a=await f.current(a.id);assert.equal(requests.length,2)
  assert.equal(requests[1].body.template.components[0].parameters[5].text,a.confirmed_map)
  assert.ok(a.notifications.some(n=>n.channel==='whatsapp'&&n.event==='Aceptada'&&n.state==='submitted'))
  const config=(await f.call('config')).data;assert.equal(config.whatsappMode,'meta');assert.ok(!JSON.stringify(config).includes('meta-secret-token'))
 }finally{await f.close()}
})

test('Correo de visitas escapa contenido y transporta dirección/mapa sin alterar verificación',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'casafast-mail-visits-'))
 const mailer=createMailer({EMAIL_MODE:'preview',APP_URL:'http://localhost:5173'},dir)
 await mailer.send({purpose:'visit',email:'test@example.invalid',name:'test',subject:'Visita <confirmada>',text:'<script>alert(1)</script>\nhttps://maps.google.com'})
 const html=readFileSync(join(dir,'mail-preview',readdirSync(join(dir,'mail-preview'))[0]),'utf8')
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('https://maps.google.com'))
})

test('Agenda abierta: sin horarios publicados se puede pedir una hora de 9:00 a 18:00 y el vendedor confirma o propone otra',async()=>{
 const f=await fixture();try{
  // Propiedad de demostración asignada a un vendedor activo: también admite visitas.
  f.db.prepare('INSERT INTO properties(id,seller_id,data,active) VALUES(?,?,?,1)').run('demo-mx-x','seller2',JSON.stringify({title:'Demo',address:'Zona ilustrativa',lat:20.6,lng:-103.3,images:[],demo:true}))
  const list=(await f.call('visit-slots/demo-mx-x')).data
  assert.equal(list.open,true)
  assert.ok(list.slots.length>50)
  assert.ok(list.slots.every(s=>s.open&&s.id.startsWith('open:')))
  const hours=new Set(list.slots.map(s=>(new Date(s.date).getUTCHours()+17)%24))
  assert.ok([...hours].every(h=>h>=9&&h<=18))
  // Hora fuera del horario (3:00 de Culiacán) o ya pasada: rechazada.
  const night=new Date(Date.now()+3*86400000);night.setUTCHours(10,0,0,0)
  assert.equal((await f.call('appointments','POST',{propertyId:'demo-mx-x',slotId:`open:${night.toISOString()}`})).status,400)
  const created=await f.call('appointments','POST',{propertyId:'demo-mx-x',slotId:list.slots[5].id})
  assert.equal(created.status,201,JSON.stringify(created.data))
  // El horario tomado desaparece de la agenda abierta del mismo vendedor.
  assert.ok(!(await f.call('visit-slots/demo-mx-x','GET',undefined,'other')).data.slots.some(s=>s.date===list.slots[5].date))
  assert.equal((await f.call('appointments','POST',{propertyId:'demo-mx-x',slotId:list.slots[5].id},'other')).status,409)
  // El vendedor la ve, propone otra hora abierta y el comprador acepta.
  let a=await f.current(created.data.id,'seller2');assert.equal(a.status,'Pendiente')
  assert.equal((await f.change(a,'Propuesta','seller2',{slotId:list.slots[8].id})).status,200)
  a=await f.current(created.data.id)
  assert.equal((await f.change(a,'Aceptada','buyer')).status,200)
  a=await f.current(created.data.id)
  assert.equal(a.status,'Aceptada');assert.equal(a.date,list.slots[8].date)
  // Si el vendedor publica horarios, la agenda abierta deja de ofrecerse.
  assert.equal((await f.call('visit-slots/demo-mx-x','POST',{dates:[f.date(4)]},'seller2')).status,200)
  const after=(await f.call('visit-slots/demo-mx-x')).data
  assert.equal(after.open,false);assert.ok(after.slots.every(s=>!s.open))
  assert.equal((await f.call('appointments','POST',{propertyId:'demo-mx-x',slotId:list.slots[12].id},'other')).status,400)
 }finally{await f.close()}
})

test('Modo vacaciones: bloquea nuevas citas en el periodo y cancela las que ya caían en él',async()=>{
 const f=await fixture();try{
  const day=n=>new Date(Date.now()-7*3600000+n*86400000).toISOString().slice(0,10)
  const dayOf=iso=>new Date(Date.parse(iso)-7*3600000).toISOString().slice(0,10)
  const slots=await f.slots()  // date(0..2): pasado mañana, +3 y +4 días a las 10:00 de Culiacán
  const a1=await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id})
  const a2=await f.call('appointments','POST',{propertyId:'house',slotId:slots[2].id},'other')
  assert.equal(a1.status,201);assert.equal(a2.status,201)
  let a=await f.current(a1.data.id);assert.equal((await f.change(a,'Aceptada','seller')).status,200)
  // Permisos y validaciones
  assert.equal((await f.call('vacation','PUT',{start:day(2),end:day(3)},'buyer')).status,403)
  assert.equal((await f.call('vacation','PUT',{start:day(3),end:day(2)},'seller')).status,400)
  assert.equal((await f.call('vacation','PUT',{start:day(-5),end:day(-2)},'seller')).status,400)
  // Vacaciones que cubren la primera visita (confirmada) pero no la tercera
  const v=await f.call('vacation','PUT',{start:dayOf(slots[0].date),end:dayOf(slots[1].date),note:'Viaje'},'seller')
  assert.equal(v.status,200,JSON.stringify(v.data));assert.equal(v.data.cancelled,1)
  assert.equal((await f.current(a1.data.id)).status,'Cancelada')
  assert.equal((await f.current(a2.data.id,'other')).status,'Pendiente')
  assert.ok((await f.current(a1.data.id)).history.some(h=>h.event==='Cancelada'&&/vacaciones/.test(h.detail)))
  // El horario del periodo ya no se ofrece ni se puede reservar; la agenda informa las vacaciones
  const list=(await f.call('visit-slots/house','GET',undefined,'other')).data
  assert.equal(list.vacation.start,dayOf(slots[0].date));assert.ok(!list.slots.some(s=>s.id===slots[1].id))
  const blocked=await f.call('appointments','POST',{propertyId:'house',slotId:slots[1].id},'other')
  assert.equal(blocked.status,409);assert.match(blocked.data.error,/vacaciones/)
  // Otras propiedades del mismo vendedor también quedan bloqueadas (agenda abierta incluida)
  const open=(await f.call('visit-slots/house2','GET',undefined,'other')).data
  assert.ok(open.slots.every(s=>{const t=Date.parse(s.date);return t<Date.parse(`${dayOf(slots[0].date)}T00:00:00-07:00`)||t>=Date.parse(`${dayOf(slots[1].date)}T00:00:00-07:00`)+86400000}))
  // Al terminar las vacaciones vuelve a aceptar citas
  assert.equal((await f.call('vacation','DELETE',{},'seller')).status,200)
  assert.equal((await f.call('vacation','GET',undefined,'seller')).data,null)
  assert.equal((await f.call('appointments','POST',{propertyId:'house',slotId:slots[1].id},'buyer')).status,201)
 }finally{await f.close()}
})

test('Cancelar: el comprador solo puede con 12 h de anticipación; el vendedor sí puede cancelar',async()=>{
 const f=await fixture();try{
  const slots=await f.slots(), created=await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id})
  let a=await f.current(created.data.id);await f.change(a,'Aceptada','seller')
  f.db.prepare('UPDATE appointments SET date=? WHERE id=?').run(new Date(Date.now()+6*3600000).toISOString(),a.id)
  a=await f.current(a.id)
  const late=await f.change(a,'Cancelada','buyer');assert.equal(late.status,409);assert.match(late.data.error,/12 horas/)
  a=await f.current(a.id);assert.equal(a.status,'Aceptada')
  assert.equal((await f.change(a,'Cancelada','seller')).status,200)
 }finally{await f.close()}
})

test('Recordatorios 24 h y 2 h antes, una sola vez por horario',async()=>{
 const f=await fixture();try{
  const slots=await f.slots(), created=await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id})
  let a=await f.current(created.data.id);await f.change(a,'Aceptada','seller')
  const old=new Date(Date.now()-5*3600000).toISOString()
  f.db.prepare('UPDATE visit_events SET created=? WHERE appointment_id=?').run(old,a.id)
  f.db.prepare('UPDATE appointments SET date=? WHERE id=?').run(new Date(Date.now()+20*3600000).toISOString(),a.id)
  await f.current(a.id);await f.current(a.id)
  assert.equal(f.emails.filter(e=>e.subject==='Recordatorio: tu visita es mañana').length,2)
  f.db.prepare('UPDATE appointments SET date=? WHERE id=?').run(new Date(Date.now()+90*60000).toISOString(),a.id)
  await f.current(a.id)
  assert.equal(f.emails.filter(e=>e.subject==='Tu visita es en 2 horas').length,2)
  assert.equal(f.emails.find(e=>e.subject==='Tu visita es en 2 horas').visit.confirmed,true)
 }finally{await f.close()}
})

test('Después de la visita: asistencia, calificación, límite por inasistencias y bloqueos de horario',async()=>{
 const f=await fixture();try{
  const slots=await f.slots(), created=await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id})
  let a=await f.current(created.data.id);await f.change(a,'Aceptada','seller')
  assert.equal((await f.call(`appointments/${a.id}/rating`,'POST',{stars:5,sellerArrived:true,matched:true})).status,409)
  f.db.prepare('UPDATE appointments SET date=? WHERE id=?').run(new Date(Date.now()-3600000).toISOString(),a.id)
  assert.equal((await f.call(`appointments/${a.id}/attendance`,'POST',{attended:true},'buyer')).status,403)
  assert.equal((await f.call(`appointments/${a.id}/attendance`,'POST',{attended:true},'seller')).status,200)
  assert.equal((await f.call(`appointments/${a.id}/rating`,'POST',{stars:4,sellerArrived:true,matched:false,comment:'Bien'})).status,200)
  assert.equal((await f.call(`appointments/${a.id}/rating`,'POST',{stars:4,sellerArrived:true,matched:false})).status,409)
  assert.equal((await f.current(a.id)).rating.stars,4)
  const listing=(await f.call('properties')).data.find(p=>p.id==='house');assert.equal(listing.sellerRating.avg,4)
  // Tres inasistencias en 90 días bloquean nuevas solicitudes.
  for(let i=0;i<3;i++)f.db.prepare("INSERT INTO appointments(id,property_id,buyer_id,date,status,attendance) VALUES(?,?,?,?,'Aceptada','no_asistio')").run(`miss${i}`,'house2','other',new Date(Date.now()-(i+2)*86400000).toISOString())
  const blocked=await f.call('appointments','POST',{propertyId:'house',slotId:slots[1].id},'other');assert.equal(blocked.status,403);assert.match(blocked.data.error,/asististe/)
  // Bloqueo puntual: ese horario deja de ofrecerse.
  const start=new Date(Date.parse(slots[2].date)-1800000).toISOString(),end=new Date(Date.parse(slots[2].date)+3600000).toISOString()
  assert.equal((await f.call('blocks','POST',{start,end,note:'Junta'},'buyer')).status,403)
  assert.equal((await f.call('blocks','POST',{start,end,note:'Junta'},'seller')).status,201)
  assert.ok(!(await f.call('visit-slots/house')).data.slots.some(s=>s.id===slots[2].id))
  const blocks=(await f.call('blocks','GET',undefined,'seller')).data;assert.equal(blocks.length,1)
  assert.equal((await f.call(`blocks/${blocks[0].id}`,'DELETE',undefined,'seller')).status,200)
  assert.ok((await f.call('visit-slots/house')).data.slots.some(s=>s.id===slots[2].id))
 }finally{await f.close()}
})

test('Vendida/rentada cancela visitas, reportes llegan al admin, vistas y métricas',async()=>{
 const f=await fixture();try{
  f.db.prepare("INSERT INTO users(id,name,email,password,role,active,verified) VALUES('adm','adm','adm@example.invalid','','admin',1,1)").run()
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('adm').digest('hex'),'adm',Date.now()+86400000)
  const slots=await f.slots(), created=await f.call('appointments','POST',{propertyId:'house',slotId:slots[0].id})
  // Vistas: una por persona y día; el dueño no cuenta.
  await f.call('properties/house/view','POST',{});await f.call('properties/house/view','POST',{});await f.call('properties/house/view','POST',{},'seller')
  await f.call('properties/house/view','POST',{visitor:'visitante-anonimo-1'},'nadie')
  await f.call('favorites','POST',{id:'house',saved:true})
  const stats=(await f.call('seller/stats','GET',undefined,'seller')).data.house
  assert.equal(stats.views,2);assert.equal(stats.favorites,1);assert.equal(stats.upcoming,1)
  // Reportes
  assert.equal((await f.call('reports','POST',{propertyId:'house',reason:'fotos'})).status,201)
  assert.equal((await f.call('reports','POST',{propertyId:'house',reason:'fotos'})).status,409)
  assert.equal((await f.call('reports','POST',{propertyId:'house',reason:'fotos'},'seller')).status,400)
  const reports=(await f.call('admin/reports','GET',undefined,'adm')).data;assert.equal(reports.length,1);assert.equal(reports[0].reasonLabel,'Las fotos no corresponden a la propiedad')
  assert.equal((await f.call('admin/reports','GET',undefined,'buyer')).status,403)
  assert.equal((await f.call(`admin/reports/${reports[0].id}`,'POST',{status:'resuelto',note:'Fotos corregidas'},'adm')).status,200)
  // Vendida
  assert.equal((await f.call('properties/house/close','POST',{result:'vendida'},'buyer')).status,403)
  const closed=await f.call('properties/house/close','POST',{result:'vendida'},'seller');assert.equal(closed.status,200);assert.equal(closed.data.cancelled,1)
  assert.equal((await f.current(created.data.id)).status,'Cancelada')
  const mine=(await f.call('properties','GET',undefined,'seller')).data.find(p=>p.id==='house');assert.equal(mine.closed.result,'vendida');assert.equal(mine.active,false)
  assert.equal((await f.call('properties/house/restore','POST',{},'seller')).status,200)
  assert.equal((await f.call('properties','GET',undefined,'seller')).data.find(p=>p.id==='house').closed,undefined)
  const m=(await f.call('admin/metrics','GET',undefined,'adm')).data
  assert.equal(m.weeks.length,8);assert.equal(m.visits.requested,1);assert.equal(m.closed.vendida,0);assert.equal(m.reports,0)
 }finally{await f.close()}
})

test('Visor de base de datos: solo administradores, solo lectura y sin secretos',async()=>{
 const f=await fixture();try{
  f.db.prepare("INSERT INTO users(id,name,email,password,role,active,verified) VALUES('adm2','adm2','adm2@example.invalid','hash-secreto','admin',1,1)").run()
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('adm2').digest('hex'),'adm2',Date.now()+86400000)
  assert.equal((await f.call('admin/db','GET',undefined,'buyer')).status,403)
  const list=(await f.call('admin/db','GET',undefined,'adm2')).data;assert.ok(list.some(t=>t.name==='users'&&t.rows>=5))
  const users=(await f.call('admin/db/users?q=adm2','GET',undefined,'adm2')).data
  assert.equal(users.filtered,1);assert.ok(!users.columns.includes('password'));assert.ok(!JSON.stringify(users).includes('hash-secreto'))
  const sessions=(await f.call('admin/db/sessions','GET',undefined,'adm2')).data;assert.equal(sessions.rows.length,0);assert.equal(sessions.secret,true)
  assert.equal((await f.call('admin/db/users','POST',{},'adm2')).status,405)
  assert.equal((await f.call('admin/db/nada','GET',undefined,'adm2')).status,404)
 }finally{await f.close()}
})

test('Editor de base de datos: cambia valores con validación, respaldo y registro; protege lo crítico',async()=>{
 const f=await fixture();try{
  f.db.prepare("INSERT INTO users(id,name,email,password,role,active,verified) VALUES('adm3','adm3','adm3@example.invalid','x','admin',1,1)").run()
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('adm3').digest('hex'),'adm3',Date.now()+86400000)
  const rowOf=async(table,q)=>(await f.call(`admin/db/${table}?q=${q}`,'GET',undefined,'adm3')).data.rows[0]
  const buyer=await rowOf('users','buyer%40example')
  assert.equal((await f.call(`admin/db/users/${buyer.__rowid}`,'PATCH',{column:'name',value:'Comprador Nuevo'},'buyer')).status,403)
  assert.equal((await f.call(`admin/db/users/${buyer.__rowid}`,'PATCH',{column:'name',value:'Comprador Nuevo'},'adm3')).status,200)
  assert.equal(f.db.prepare("SELECT name FROM users WHERE id='buyer'").get().name,'Comprador Nuevo')
  assert.equal((await f.call(`admin/db/users/${buyer.__rowid}`,'PATCH',{column:'role',value:'jefe'},'adm3')).status,400)
  assert.equal((await f.call(`admin/db/users/${buyer.__rowid}`,'PATCH',{column:'password',value:'x'},'adm3')).status,400)
  assert.equal((await f.call(`admin/db/users/${buyer.__rowid}`,'PATCH',{column:'id',value:'otro'},'adm3')).status,403)
  assert.equal((await f.call(`admin/db/users/${buyer.__rowid}`,'PATCH',{column:'active',value:'sí'},'adm3')).status,400)
  const me=await rowOf('users','adm3')
  assert.equal((await f.call(`admin/db/users/${me.__rowid}`,'PATCH',{column:'role',value:'comprador'},'adm3')).status,403)
  assert.equal((await f.call(`admin/db/users/${me.__rowid}`,'DELETE',{},'adm3')).status,403)
  // JSON de la publicación: se valida y el cambio se ve de inmediato en el catálogo.
  const house=await rowOf('properties','house2')
  assert.equal((await f.call(`admin/db/properties/${house.__rowid}`,'PATCH',{column:'data',value:'{"title":'},'adm3')).status,400)
  const data=JSON.parse(house.data);data.title='Título corregido'
  assert.equal((await f.call(`admin/db/properties/${house.__rowid}`,'PATCH',{column:'data',value:JSON.stringify(data,null,2)},'adm3')).status,200)
  assert.equal((await f.call('properties')).data.find(p=>p.id==='house2').title,'Título corregido')
  // Borrar con dependencias falla con un mensaje claro; sin dependencias funciona.
  await f.call('favorites','POST',{id:'house3',saved:true})
  const fav=(await f.call('admin/db/favorites','GET',undefined,'adm3')).data.rows[0]
  assert.equal((await f.call(`admin/db/favorites/${fav.__rowid}`,'DELETE',{},'adm3')).status,200)
  assert.equal((await f.call('admin/db/sessions/1','DELETE',{},'adm3')).status,403)
  assert.ok(readdirSync(join(f.dir,'backups')).some(n=>n.endsWith('.sqlite')))
  assert.ok(f.db.prepare("SELECT COUNT(*) n FROM audit WHERE action LIKE 'base de datos:%'").get().n>=3)
 }finally{await f.close()}
})

test('Admin crea citas con las mismas reglas: pendiente o confirmada, avisos y horario ocupado',async()=>{
 const f=await fixture();try{
  f.db.prepare("INSERT INTO users(id,name,email,password,role,active,verified) VALUES('adm4','Admin','adm4@example.invalid','','admin',1,1)").run()
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('adm4').digest('hex'),'adm4',Date.now()+86400000)
  f.db.prepare("UPDATE properties SET code='PUB-AAAA1111' WHERE id='house'").run()
  const when=f.date(1)
  assert.equal((await f.call('appointments/admin','POST',{property:'PUB-AAAA1111',buyerEmail:'buyer@example.invalid',date:when,status:'Aceptada'},'buyer')).status,403)
  assert.equal((await f.call('appointments/admin','POST',{property:'PUB-NOEXISTE',buyerEmail:'buyer@example.invalid',date:when,status:'Aceptada'},'adm4')).status,404)
  assert.equal((await f.call('appointments/admin','POST',{property:'pub-aaaa1111',buyerEmail:'nadie@example.invalid',date:when,status:'Aceptada'},'adm4')).status,404)
  assert.equal((await f.call('appointments/admin','POST',{property:'house',buyerEmail:'seller@example.invalid',date:when,status:'Aceptada'},'adm4')).status,400)
  const ok=await f.call('appointments/admin','POST',{property:'pub-aaaa1111',buyerEmail:'BUYER@example.invalid',date:when,status:'Aceptada',message:'Llamó por teléfono'},'adm4')
  assert.equal(ok.status,201,JSON.stringify(ok.data));assert.match(ok.data.code,/^CITA-/);assert.equal(ok.data.status,'Aceptada')
  const a=await f.current(ok.data.id);assert.equal(a.status,'Aceptada');assert.ok(a.confirmed_map);assert.match(a.history[0].detail,/administración/)
  assert.ok(f.emails.filter(e=>e.subject==='Visita confirmada').length>=2)
  // Mismo horario del vendedor (otra propiedad suya): ocupado.
  assert.equal((await f.call('appointments/admin','POST',{property:'house2',buyerEmail:'other@example.invalid',date:when,status:'Pendiente'},'adm4')).status,409)
  const pend=await f.call('appointments/admin','POST',{property:'house2',buyerEmail:'other@example.invalid',date:f.date(2),status:'Pendiente'},'adm4')
  assert.equal(pend.status,201);assert.equal(pend.data.status,'Pendiente')
 }finally{await f.close()}
})
