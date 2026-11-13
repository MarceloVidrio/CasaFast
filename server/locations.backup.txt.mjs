import { randomBytes, createHash } from 'node:crypto'
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})}
const digest=value=>createHash('sha256').update(value).digest('hex')
const normalize=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const fields=['street','number','neighborhood','city','state','postalCode','unit','reference']
export function cleanLocation(value) {
  if(!value||typeof value!=='object')fail('Selecciona y confirma la ubicación en el mapa.')
  const result={}
  for(const field of fields){if(value[field]!==undefined&&typeof value[field]!=='string')fail('Datos de dirección inválidos.');result[field]=(value[field]||'').trim();if(result[field].length>(field==='reference'?300:120))fail('La dirección contiene un campo demasiado largo.')}
  if(!result.street||!result.city||!result.state)fail('Completa al menos calle, ciudad y estado; después valida la dirección.')
  if(result.postalCode&&!/^\d{5}$/.test(result.postalCode))fail('El código postal debe tener cinco dígitos.')
  return result
}
const coords=value=>{
  if(value.lat===''||value.lng===''||value.lat==null||value.lng==null||!Number.isFinite(Number(value.lat))||!Number.isFinite(Number(value.lng))||Math.abs(Number(value.lat))>90||Math.abs(Number(value.lng))>180)fail('Selecciona un punto válido en el mapa.')
  return {lat:Number(value.lat),lng:Number(value.lng)}
}
export function meters(a,b){const rad=x=>x*Math.PI/180,h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)))}
const fingerprint=(point,address)=>digest(JSON.stringify([point.lat,point.lng,...fields.map(k=>normalize(address[k]))]))
const addressText=a=>[`${a.street} ${a.number}`.trim(),a.neighborhood,a.city,a.state,a.postalCode].filter(Boolean).join(', ')

export function parseGeocode(result) {
  const component=(type,short=false)=>{const c=result.address_components?.find(c=>c.types.includes(type));return c?.[short?'short_name':'long_name']||''}
  return {placeId:result.place_id,formatted:result.formatted_address,lat:result.geometry?.location?.lat,lng:result.geometry?.location?.lng,
    types:result.types||[],partial:!!result.partial_match,precision:result.geometry?.location_type,country:component('country',true),
    address:{street:component('route'),number:component('street_number'),neighborhood:component('sublocality_level_1')||component('sublocality')||component('neighborhood'),city:component('locality')||component('administrative_area_level_2'),state:component('administrative_area_level_1'),postalCode:component('postal_code'),unit:'',reference:''}}
}
export function createGeocoder(env,request=fetch) {
  return {
    enabled:!!env.GOOGLE_MAPS_SERVER_KEY,
    async lookup(params) {
      if(!env.GOOGLE_MAPS_SERVER_KEY)fail('La búsqueda de ubicaciones todavía no está habilitada.',503)
      const url=new URL('https://maps.googleapis.com/maps/api/geocode/json')
      for(const [key,value] of Object.entries({...params,language:'es',region:'mx',key:env.GOOGLE_MAPS_SERVER_KEY}))url.searchParams.set(key,value)
      let response,result
      try{response=await request(url,{signal:AbortSignal.timeout(10000)});result=await response.json()}catch{fail('No se pudo consultar Google Maps. Inténtalo de nuevo.',503)}
      
if (result.status === 'ZERO_RESULTS') return []

if (!response.ok || result.status !== 'OK') {
  console.error('[CasaFast Geocoding]', {
    httpStatus: response.status,
    googleStatus: result.status,
    googleMessage: result.error_message || 'Sin detalle de Google'
  })

  fail(
    'La consulta de ubicación no está disponible. Revisa la configuración o inténtalo más tarde.',
    503
  )
}

      return result.results.map(parseGeocode).filter(r=>r.country==='MX')
    },
  }
}
export function createLocations(db,{env,geocoder:provided}) {
  db.exec('CREATE TABLE IF NOT EXISTS location_checks(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,fingerprint TEXT NOT NULL,place_id TEXT NOT NULL,expires INTEGER NOT NULL);')
  const geocoder=provided||createGeocoder(env)
  const limits=new Map()
  const ready=()=>{if(!geocoder.enabled)fail('La validación de ubicaciones todavía no está habilitada. Contacta al administrador.',503)}
  function limit(user){const now=Date.now();for(const [k,v]of limits)if(v.until<now)limits.delete(k);const e=limits.get(user.id)||{count:0,until:now+60000};if(++e.count>30)fail('Espera un minuto antes de consultar más ubicaciones.',429);limits.set(user.id,e)}
  const streetMatch=r=>!r.partial&&r.address.street&&r.address.city&&r.address.state&&r.types.some(t=>['street_address','premise','subpremise','route'].includes(t))
  return {
    config:{mapsEnabled:!!(geocoder.enabled&&env.GOOGLE_MAPS_BROWSER_KEY),mapsBrowserKey:env.GOOGLE_MAPS_BROWSER_KEY||'',mapsMapId:env.GOOGLE_MAPS_MAP_ID||'DEMO_MAP_ID'},
    async handle({path,method,body,auth,send}) {
      if(method!=='POST'||!['/api/locations/search','/api/locations/reverse','/api/locations/confirm'].includes(path))return false
      const user=auth(['vendedor','admin']);ready();limit(user)
      if(path==='/api/locations/search') {
        if(typeof body.query!=='string'||body.query.trim().length<4||body.query.length>250)fail('Escribe una calle, colonia y ciudad (al menos 4 caracteres).')
        const results=await geocoder.lookup({address:body.query.trim(),components:'country:MX'})
        send(results.slice(0,5));return true
      }
      const point=coords(body)
      if(path==='/api/locations/reverse') {
        const results=await geocoder.lookup({latlng:`${point.lat},${point.lng}`})
        const result=results.find(streetMatch)
        if(!result||meters(point,result)>300)fail('No encontramos una calle cercana a ese punto. Acerca el mapa y selecciona la entrada del inmueble.')
        send({...result,...point});return true
      }
      const address=cleanLocation(body.locationDetails)
      if(body.confirmed!==true)fail('Confirma que el pin y la dirección corresponden al inmueble.')
      const results=await geocoder.lookup({address:`${addressText(address)}, México`,components:'country:MX'})
      const match=results.find(r=>streetMatch(r)&&meters(point,r)<=200&&normalize(r.address.street)===normalize(address.street)&&normalize(r.address.city)===normalize(address.city)&&normalize(r.address.state)===normalize(address.state)&&(!address.number||normalize(r.address.number)===normalize(address.number))&&(!address.postalCode||r.address.postalCode===address.postalCode)&&(!address.neighborhood||normalize(r.address.neighborhood)===normalize(address.neighborhood)))
      if(!match)fail('La dirección no coincide suficientemente con el pin o Google no reconoce los detalles. Revisa calle, número, colonia y ciudad; vuelve a colocar el pin si es necesario.')
      const token=randomBytes(32).toString('hex'),expires=Date.now()+30*60000
      db.prepare('DELETE FROM location_checks WHERE expires<=?').run(Date.now())
      db.prepare('INSERT INTO location_checks VALUES(?,?,?,?,?)').run(digest(token),user.id,fingerprint(point,address),match.placeId,expires)
      send({locationToken:token,expires,precision:match.precision,message:'Dirección contrastada con Google Maps. Revisa los datos antes de publicar.'});return true
    },
    forProperty(body,old,user) {
      const point=coords(body),address=cleanLocation(body.locationDetails),fp=fingerprint(point,address)
      let placeId,verifiedAt
      if(old?.locationVerification?.provider==='google'&&old.locationDetails&&fp===fingerprint(coords(old),cleanLocation(old.locationDetails))){placeId=old.locationVerification.placeId;verifiedAt=old.locationVerification.checkedAt}
      else {
        ready()
        if(typeof body.locationToken!=='string'||!/^[a-f0-9]{64}$/.test(body.locationToken))fail('Valida la dirección en el mapa antes de publicar.')
        const check=db.prepare('SELECT * FROM location_checks WHERE token=? AND user_id=? AND expires>?').get(digest(body.locationToken),user.id,Date.now())
        if(!check||check.fingerprint!==fp)fail('La validación caducó o cambió la dirección. Vuelve a validarla antes de publicar.')
        placeId=check.place_id;verifiedAt=new Date().toISOString()
      }
      return {...point,location:[address.neighborhood,address.city,address.state].filter(Boolean).join(', '),address:addressText(address)+(address.unit?` · Interior ${address.unit}`:''),locationDetails:address,locationVerification:{provider:'google',placeId,checkedAt:verifiedAt}}
    },
  }
}
