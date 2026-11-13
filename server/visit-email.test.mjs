import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderVisitEmail } from './visit-email.mjs'
const data={name:'Francisco',subject:'Solicitud de visita pendiente',appUrl:'http://localhost:5173',visit:{appointmentId:'cita-123',event:'Pendiente',recipientRole:'buyer',title:'Casa La Isla',date:'2026-11-02T17:00:00.000Z',deadline:'2026-11-02T17:00:00.000Z',confirmed:false,address:'NO MOSTRAR',mapUrl:'https://www.google.com/maps/search/?api=1&query=24,-107'}}
test('Solicitud minimalista: datos, hora Culiacán y sin domicilio pendiente',()=>{
 const {html}=renderVisitEmail(data)
 assert.ok(html.includes('Esperando al vendedor'));assert.ok(html.includes('10:00'));assert.ok(html.includes('Casa La Isla'));assert.ok(!html.includes('NO MOSTRAR'));assert.ok(!html.includes('Ver ubicación exacta'))
 assert.equal((html.match(/Tu visita está por confirmar\./g)||[]).length,1)
 assert.ok(renderVisitEmail({...data,visit:{...data.visit,recipientRole:'seller'}}).html.includes('Tienes una visita por confirmar.'))
})
test('Confirmación incorpora botón seguro de mapa y escapa datos del usuario',()=>{
 const {html}=renderVisitEmail({...data,name:'<script>x</script>',visit:{...data.visit,event:'Aceptada',confirmed:true,address:'Calle <prueba> 123',title:'Casa & Jardín'}})
 assert.ok(html.includes('Ver ubicación exacta'));assert.ok(html.includes('Calle &lt;prueba&gt; 123'));assert.ok(html.includes('Casa &amp; Jardín'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('query=24,-107'))
 assert.ok(!renderVisitEmail({...data,visit:{...data.visit,confirmed:true,mapUrl:'javascript:alert(1)'}}).html.includes('Ver ubicación exacta'))
 assert.ok(!renderVisitEmail({...data,appUrl:'javascript:alert(1)'}).html.includes('href="javascript:'))
})

test('Botón «Ver mi cita» con enlace directo y mapa corto de Google',()=>{
 const {html}=renderVisitEmail(data)
 assert.ok(html.includes('Ver mi cita'));assert.ok(html.includes('href="http://localhost:5173/?cita=cita-123"'))
 assert.ok(renderVisitEmail({...data,visit:{...data.visit,recipientRole:'seller'}}).html.includes('Ver solicitud'))
 const confirmed=renderVisitEmail({...data,visit:{...data.visit,event:'Aceptada',confirmed:true,address:'Calle 1',mapUrl:'https://maps.google.com/?q=24.8,-107.4'}}).html
 assert.ok(confirmed.includes('Ver ubicación exacta'))
 assert.ok(!renderVisitEmail({...data,visit:{...data.visit,event:'Aceptada',confirmed:true,mapUrl:'https://maps.evil.com/?q=1'}}).html.includes('Ver ubicación exacta'))
 assert.ok(renderVisitEmail({...data,visit:{...data.visit,event:'Reprogramada'}}).html.includes('Tu visita se reprogramó.'))
})
