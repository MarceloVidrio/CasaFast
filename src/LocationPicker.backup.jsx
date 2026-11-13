import { useEffect, useRef, useState } from 'react'
import { api } from './lib'

let mapsPromise
function loadMaps(key) {
  if(window.google?.maps?.importLibrary)return Promise.resolve(window.google.maps)
  if(mapsPromise)return mapsPromise
  mapsPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script')
    const timeout=setTimeout(()=>{script.remove();mapsPromise=null;reject(new Error('Google Maps tardó demasiado en responder. Recarga la página para reintentar.'))},20000)
    window.__casafastMapsReady=()=>{clearTimeout(timeout);resolve(window.google.maps)}
    script.onerror=()=>{clearTimeout(timeout);mapsPromise=null;reject(new Error('No se pudo cargar Google Maps. Revisa la conexión y vuelve a intentar.'))}
    const url=new URL('https://maps.googleapis.com/maps/api/js')
    Object.entries({key,callback:'__casafastMapsReady',loading:'async',v:'weekly',language:'es',region:'MX'}).forEach(([k,v])=>url.searchParams.set(k,v))
    script.src=url.href;script.async=true;document.head.appendChild(script)
  })
  return mapsPromise
}
const blank={street:'',number:'',neighborhood:'',city:'',state:'',postalCode:'',unit:'',reference:''}
const labels={street:'Calle',number:'Número exterior',neighborhood:'Colonia',city:'Ciudad / municipio',state:'Estado',postalCode:'Código postal',unit:'Interior / departamento',reference:'Referencias adicionales'}

export default function LocationPicker({value,onChange}) {
  const [config,setConfig]=useState(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[results,setResults]=useState([]),[busy,setBusy]=useState(false),[mapReady,setMapReady]=useState(false),[confirmed,setConfirmed]=useState(false)
  const canvas=useRef(null),map=useRef(null),marker=useRef(null),current=useRef(value),change=useRef(onChange),requestVersion=useRef(0),selectPoint=useRef(null)
  current.current=value;change.current=onChange
  useEffect(()=>{let live=true;api('config').then(c=>{if(live)setConfig(c)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false;requestVersion.current++}},[])
  function update(next){change.current(next)}
  function invalidate(){const next={...current.current,locationToken:'',locationValidated:false};update(next);setConfirmed(false);return next}
  selectPoint.current=async point=>{
    const version=++requestVersion.current
    const previous=invalidate();update({...previous,...point});setBusy(true);setError('')
    if(marker.current)marker.current.position=point
    try{const result=await api('locations/reverse','POST',point);if(version!==requestVersion.current)return;update({...point,locationDetails:{...blank,...result.address,unit:previous.locationDetails?.unit||'',reference:previous.locationDetails?.reference||''},locationToken:'',locationValidated:false});map.current?.panTo(point)}catch(e){if(version===requestVersion.current)setError(e.message)}finally{if(version===requestVersion.current)setBusy(false)}
  }
  useEffect(()=>{
    if(!config?.mapsEnabled)return
    let disposed=false,clickListener,dragListener,instance
    ;(async()=>{try{
      const maps=await loadMaps(config.mapsBrowserKey)
      const [{Map},{AdvancedMarkerElement}]=await Promise.all([maps.importLibrary('maps'),maps.importLibrary('marker')])
      if(disposed)return
      const point=Number.isFinite(current.current.lat)&&Number.isFinite(current.current.lng)?{lat:current.current.lat,lng:current.current.lng}:{lat:24.8091,lng:-107.394}
      instance=new Map(canvas.current,{center:point,zoom:16,mapId:config.mapsMapId,mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:'cooperative'})
      map.current=instance;marker.current=new AdvancedMarkerElement({map:instance,position:point,gmpDraggable:true,title:'Ubicación del inmueble. Arrastra el pin hasta la entrada.'})
      clickListener=instance.addListener('click',e=>{if(e.latLng)selectPoint.current(e.latLng.toJSON())})
      dragListener=()=>{const p=marker.current.position;selectPoint.current(typeof p.toJSON==='function'?p.toJSON():{lat:p.lat,lng:p.lng})}
      marker.current.addEventListener('gmp-dragend',dragListener)
      setMapReady(true)
    }catch(e){if(!disposed)setError(e.message)}})()
    return()=>{disposed=true;clickListener?.remove();if(marker.current){marker.current.removeEventListener('gmp-dragend',dragListener);marker.current.map=null}map.current=null}
  },[config])
  async function search(){if(query.trim().length<4){setError('Escribe al menos cuatro caracteres.');return}const version=++requestVersion.current;setBusy(true);setError('');try{const list=await api('locations/search','POST',{query});if(version!==requestVersion.current)return;setResults(list);if(!list.length)setError('No encontramos esa dirección. Agrega la ciudad y el estado.')}catch(e){if(version===requestVersion.current)setError(e.message)}finally{if(version===requestVersion.current)setBusy(false)}}
  function choose(result){setResults([]);map.current?.setZoom(result.address.street?18:15);selectPoint.current({lat:result.lat,lng:result.lng})}
  function edit(field,text){requestVersion.current++;setBusy(false);const previous=invalidate();update({...previous,locationDetails:{...blank,...previous.locationDetails,[field]:text}})}
  async function validate(){const version=++requestVersion.current;setBusy(true);setError('');try{const receipt=await api('locations/confirm','POST',{lat:value.lat,lng:value.lng,locationDetails:value.locationDetails,confirmed});if(version!==requestVersion.current)return;update({...value,...receipt,locationValidated:true})}catch(e){if(version===requestVersion.current)setError(e.message)}finally{if(version===requestVersion.current)setBusy(false)}}
  const details={...blank,...value.locationDetails}
  return <section className="location-picker" aria-label="Ubicación de la propiedad"><h2>02 <span>Ubica tu propiedad</span></h2><p className="muted">Busca una colonia o dirección, coloca el pin en la entrada y revisa los datos. Puedes corregir los detalles antes de validar.</p>
    {config&&!config.mapsEnabled?<div className="map-unavailable" role="status"><strong>El mapa está pendiente de activación.</strong><p>La selección y validación de direcciones estará disponible cuando se configure Google Maps. No se marcarán ubicaciones como validadas sin consultar el servicio.</p></div>:<><div className="map-search"><label>Buscar dirección o colonia<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Las Quintas, Culiacán, Sinaloa" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();search()}}} disabled={!mapReady}/></label><button type="button" className="secondary" onClick={search} disabled={busy||!mapReady}>Buscar en el mapa</button></div>
    {!!results.length&&<ul className="map-results">{results.map(r=><li key={r.placeId}><button type="button" onClick={()=>choose(r)}>{r.formatted}</button></li>)}</ul>}
    {!mapReady&&<p role="status">Preparando el mapa…</p>}<div className="map-canvas" ref={canvas} aria-label="Mapa para seleccionar la entrada del inmueble"/>
    <p className="map-attribution">Google Maps · Acerca el mapa y haz clic o arrastra el pin hasta la entrada. La búsqueda está limitada a México.</p></>}
    <div className="form-grid">{Object.keys(labels).map(field=><label key={field}>{labels[field]}<input value={details[field]} maxLength={field==='reference'?300:120} onChange={e=>edit(field,e.target.value)} required={['street','city','state'].includes(field)} inputMode={field==='postalCode'?'numeric':undefined} pattern={field==='postalCode'?'[0-9]{5}':undefined} disabled={!config?.mapsEnabled}/></label>)}</div>
    {Number.isFinite(value.lat)&&<p className="muted">Punto seleccionado: {value.lat.toFixed(6)}, {value.lng.toFixed(6)}</p>}
    <label className="check-label"><input type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);if(!e.target.checked)update({...value,locationValidated:false,locationToken:''})}} disabled={!mapReady}/>Confirmo que el pin y la dirección corresponden a la entrada de mi inmueble.</label>
    <button type="button" className="secondary" onClick={validate} disabled={busy||!mapReady||!confirmed}>{busy?'Consultando ubicación…':'Validar dirección con el mapa'}</button>
    {value.locationValidated&&<p role="status" className="success validation-note">✓ Ubicación contrastada. Si cambias el pin o la dirección, tendrás que validarla nuevamente.</p>}
    {error&&<p role="alert" className="error">{error}</p>}
    <small>El mapa ayuda a contrastar una dirección; no comprueba la titularidad ni la existencia física de una vivienda.</small>
  </section>
}
