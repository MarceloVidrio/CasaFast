export async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/${path}`, {method, credentials:'same-origin', ...(body !== undefined ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})})
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.')
  return data
}
export const money = value => new Intl.NumberFormat('es-MX', {style:'currency',currency:'MXN',maximumFractionDigits:0}).format(value)
export const normalized = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export function distanceKm(a,b) {
  const rad=v=>v*Math.PI/180
  const h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)))
}
export const cities = {'Culiacán':{lat:24.8091,lng:-107.394},'Navolato':{lat:24.766,lng:-107.702},'Mazatlán':{lat:23.2494,lng:-106.4111},'Los Mochis':{lat:25.7905,lng:-108.9859}}
export const readImage = file => new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('No se pudo leer la fotografía.'));r.readAsDataURL(file)})
