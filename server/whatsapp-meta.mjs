export function createMetaWhatsApp(env, request = fetch) {
  const phoneId = String(env.META_WHATSAPP_PHONE_NUMBER_ID || '').trim()
  const token = String(env.META_WHATSAPP_ACCESS_TOKEN || '').trim()
  const version = String(env.META_GRAPH_VERSION || 'v25.0').trim()
  const name = String(env.META_WHATSAPP_TEMPLATE_NAME || '').trim()
  const language = String(env.META_WHATSAPP_TEMPLATE_LANGUAGE || 'es_MX').trim()
  const enabled = /^\d{5,30}$/.test(phoneId) && token.length >= 20 && !/\s/.test(token) &&
    /^v\d{1,3}\.0$/.test(version) && /^[a-z0-9_]{1,128}$/.test(name) && name !== 'hello_world' && /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)
  const error = message => Object.assign(new Error(message), { publicMessage: message })
  return {
    enabled,
    async send(payload) {
      if (!enabled) throw error('Completa la configuración de Meta y una plantilla de visitas aprobada.')
      const phone = String(payload.phone || '').replace(/[\s()-]/g,'')
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw error('El número de WhatsApp no es válido.')
      const values = [payload.name, payload.subject, payload.title, payload.when, payload.address || payload.addressHint || 'Consulta los detalles en CasaFast', payload.mapUrl || payload.mapHint || 'Consulta CasaFast']
      const response = await request(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method:'POST', signal:AbortSignal.timeout(15000),
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:phone.slice(1),type:'template',template:{name,language:{code:language},components:[{type:'body',parameters:values.map(value=>({type:'text',text:String(value ?? '').replace(/\s+/g,' ').trim()}))}]}})
      })
      let data
      try { data = await response.json() } catch { throw error('Meta devolvió una respuesta inválida. Revisa el envío antes de reintentar.') }
      if (!response.ok || data.error) {
        const messages = {190:'El token de Meta venció o no es válido. Actualízalo en el servidor.',10:'Meta no autorizó el envío. Revisa los permisos de la cuenta.',200:'Meta no autorizó el envío. Revisa los permisos de WhatsApp.',131030:'Agrega y verifica al destinatario en el entorno de prueba de Meta.',132001:'Meta no encuentra la plantilla en ese idioma. Revisa su nombre y aprobación.',132000:'Las variables de la plantilla no coinciden. La integración requiere seis variables en el cuerpo.',131047:'Meta requiere una plantilla aprobada para este envío.',131042:'Revisa la configuración de facturación de WhatsApp en Meta.'}
        throw error(messages[Number(data.error?.code)] || 'Meta rechazó el aviso. Revisa la plantilla, el remitente y el destinatario.')
      }
      const id = data.messages?.[0]?.id
      if (typeof id !== 'string' || !id) throw error('Meta no confirmó la aceptación del mensaje. Revisa antes de reintentar.')
      return id
    }
  }
}
