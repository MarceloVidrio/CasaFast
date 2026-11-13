import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createMetaWhatsApp} from './whatsapp-meta.mjs'
const env={META_WHATSAPP_PHONE_NUMBER_ID:'12345678901',META_WHATSAPP_ACCESS_TOKEN:'fake-private-token-for-test',META_GRAPH_VERSION:'v25.0',META_WHATSAPP_TEMPLATE_NAME:'casafast_visita',META_WHATSAPP_TEMPLATE_LANGUAGE:'es_MX'}
const payload={phone:'+526670000000',name:'Test',subject:'Visita confirmada',title:'Casa de prueba',when:'15 de diciembre, 10:00',address:'Calle ilustrativa 123',mapUrl:'https://www.google.com/maps/search/?api=1&query=24,-107'}
test('Meta: destino, autorización y seis variables de la plantilla',async()=>{
 let sent
 const meta=createMetaWhatsApp(env,async(url,init)=>{sent={url,...init};return Response.json({messages:[{id:'wamid-test'}]})})
 assert.equal(meta.enabled,true);assert.equal(await meta.send(payload),'wamid-test')
 assert.equal(sent.url,'https://graph.facebook.com/v25.0/12345678901/messages');assert.equal(sent.headers.Authorization,'Bearer '+env.META_WHATSAPP_ACCESS_TOKEN)
 const body=JSON.parse(sent.body);assert.equal(body.to,'526670000000');assert.equal(body.template.language.code,'es_MX');assert.equal(body.template.components[0].parameters.length,6);assert.equal(body.template.components[0].parameters[5].text,payload.mapUrl)
 await meta.send({...payload,address:'',mapUrl:''});assert.equal(JSON.parse(sent.body).template.components[0].parameters[4].text,'Consulta los detalles en CasaFast')
})
test('Meta: configuración incompleta y hello_world nunca simulan una confirmación',async()=>{
 let sent=0;const request=async()=>{sent++;return Response.json({messages:[{id:'x'}]})}
 for(const bad of [{},{...env,META_WHATSAPP_ACCESS_TOKEN:''},{...env,META_WHATSAPP_PHONE_NUMBER_ID:'../secret'},{...env,META_WHATSAPP_TEMPLATE_NAME:'hello_world'},{...env,META_GRAPH_VERSION:'https://evil.invalid'}]){const m=createMetaWhatsApp(bad,request);assert.equal(m.enabled,false);await assert.rejects(()=>m.send(payload))}
 assert.equal(sent,0)
})
test('Meta: errores de token, plantilla y destinatario se informan sin revelar respuestas privadas',async()=>{
 for(const [code,fragment] of [[190,'token'],[131030,'destinatario'],[132001,'plantilla'],[132000,'variables']]){
  const m=createMetaWhatsApp(env,async()=>Response.json({error:{code,message:'secret-provider-details'}},{status:400}))
  await assert.rejects(()=>m.send(payload),e=>e.publicMessage.includes(fragment)&&!e.message.includes('secret-provider-details'))
 }
 await assert.rejects(()=>createMetaWhatsApp(env,async()=>Response.json({})).send(payload),/no confirmó/)
})
