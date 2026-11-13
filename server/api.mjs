import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuth } from './auth.mjs'
import { createLocations } from './locations.mjs'
import { createVisits } from './visits.mjs'
import { createSearches } from './searches.mjs'
import { createReviews } from './reviews.mjs'
import { ensureCodes } from './codes.mjs'
import { createExtras } from './extras.mjs'
import { createDbViewer } from './dbviewer.mjs'
const root = dirname(fileURLToPath(import.meta.url))
export function createApi(dataDir = join(root, 'data'), options = {}) {
  const env = options.env || process.env
  mkdirSync(join(dataDir, 'uploads'), { recursive: true })
  const isNewDatabase = !existsSync(join(dataDir, 'casafast.sqlite'))
  const db = new DatabaseSync(join(dataDir, 'casafast.sqlite'))
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
    CREATE TABLE IF NOT EXISTS properties(id TEXT PRIMARY KEY,seller_id TEXT REFERENCES users(id),data TEXT,active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY,property_id TEXT REFERENCES properties(id),buyer_id TEXT REFERENCES users(id),date TEXT,message TEXT,status TEXT DEFAULT 'Pendiente');
    CREATE TABLE IF NOT EXISTS favorites(user_id TEXT REFERENCES users(id),property_id TEXT REFERENCES properties(id),PRIMARY KEY(user_id,property_id));
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor TEXT,action TEXT,target TEXT,created TEXT);`)
  if (isNewDatabase) {
    db.prepare('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,0)').run('demo','CasaFast · Ejemplos','catalogo@example.invalid','','vendedor')
    const seeds=[['Casa contemporánea en Las Quintas','venta',2850000,'Las Quintas, Culiacán',3,2,185,24.801,-107.374],['Un espacio para empezar de nuevo','renta',12500,'Tres Ríos, Culiacán',2,2,95,24.828,-107.407],['Casa familiar con jardín','venta',1980000,'Guadalupe, Culiacán',3,2,160,24.785,-107.399],['Departamento cerca de todo','renta',9800,'Centro, Culiacán',2,1,78,24.809,-107.394],['Amplitud y luz natural','venta',3600000,'La Primavera, Culiacán',4,3,260,24.735,-107.437],['Tu próximo hogar en Navolato','venta',2100000,'Centro, Navolato',3,2,170,24.766,-107.702]]
    seeds.forEach((s,i)=>db.prepare('INSERT INTO properties(id,seller_id,data,active) VALUES(?,?,?,1)').run(`demo-${i+1}`,'demo',JSON.stringify({title:s[0],operation:s[1],price:s[2],location:s[3],bedrooms:s[4],bathrooms:s[5],area:s[6],lat:s[7],lng:s[8],type:s[1]==='renta'?'Departamento':'Casa',images:['/images/casa1.jpg'],description:'Publicación de ejemplo para explorar CasaFast. Los datos, ubicación y fotografía son ilustrativos.',address:'Ubicación ilustrativa',demo:true,created:new Date().toISOString()})))
  }
  const authService = createAuth(db,{env,dataDir,mailer:options.mailer})
  const locations = createLocations(db,{env,geocoder:options.geocoder})
  const searches = createSearches(db)
  const reviews = createReviews(db, { env, dataDir, mailer: options.mailer })
  const visits = createVisits(db,{env,dataDir,mailer:options.mailer,request:options.notificationRequest})
  ensureCodes(db)
  const dbViewer = createDbViewer(db, { dataDir })
  const extras = createExtras(db, { env, dataDir, mailer: options.mailer, visits, reviews })
  const safeUser=u=>u&&({id:u.id,name:u.name,email:u.email,role:u.role,active:!!u.active})
  // review: estado de la documentación (pendiente / aprobada / rechazada) y retiro administrativo.
  const reviewMap=()=>new Map(db.prepare('SELECT * FROM property_reviews').all().map(r=>[r.property_id,r]))
  const rows=()=>{const rv=reviewMap(),badge=extras.sellerBadges();return db.prepare('SELECT * FROM properties').all().map(r=>{const v=rv.get(r.id);return {...JSON.parse(r.data),...badge(r.seller_id),id:r.id,code:r.code,sellerId:r.seller_id,active:!!r.active,review:v?{status:v.status,submitted:v.submitted,due:v.due,reviewed:v.reviewed,note:v.note,hold:!!v.admin_hold,holdNote:v.hold_note}:{status:'aprobada',hold:false}}})}
  const visible=p=>p.active&&p.review.status==='aprobada'&&!p.review.hold
  const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})}
  const required=(v,label,max=200)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail(`${label}: revisa el valor.`);return v.trim()}
  const number=(v,label,min,max)=>{if(v===''||v===null||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max)fail(`${label}: valor fuera de rango.`);return Number(v)}
  const digest=t=>createHash('sha256').update(t).digest('hex')
  const audit=(u,action,target)=>db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),u.id,action,target,new Date().toISOString())
  return async function api(req,res,next) {
    const url=new URL(req.url,'http://localhost')
    if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/uploads/'))return next()
    const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))}
    try {
      if(url.pathname.startsWith('/uploads/')) {
        if(!/^\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/.test(url.pathname))fail('Imagen no encontrada.',404)
        const file=join(dataDir,url.pathname.slice(1));if(!existsSync(file))fail('Imagen no encontrada.',404)
        res.writeHead(200,{'Content-Type':file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':'image/jpeg','X-Content-Type-Options':'nosniff'});res.end(readFileSync(file));return
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
  const origin = req.headers.origin
  const host = req.headers.host

  if (!host) {
    fail('Solicitud sin servidor de origen.', 400)
  }

  if (origin) {
    let parsedOrigin

    try {
      parsedOrigin = new URL(origin)
    } catch {
      fail('Origen inválido.', 403)
    }

    if (
      !['http:', 'https:'].includes(parsedOrigin.protocol) ||
      parsedOrigin.host !== host
    ) {
      fail('Origen no permitido.', 403)
    }
  } else {
    const fetchSite = req.headers['sec-fetch-site']

    if (fetchSite === 'cross-site') {
      fail('Solicitud de otro sitio no permitida.', 403)
    }
  }

  if (
    !req.headers['content-type']
      ?.toLowerCase()
      .startsWith('application/json')
  ) {
    fail('Se requiere JSON.', 415)
  }
}
      const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('casafast_session='))?.slice('casafast_session='.length)
      const user=token?db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1 AND u.verified=1').get(digest(token),Date.now()):null
      const auth=roles=>{if(!user)fail('Inicia sesión para continuar.',401);if(roles&&!roles.includes(user.role))fail('Tu cuenta no tiene permiso para esta acción.',403);return user}
      let body={}
      if(!['GET','HEAD'].includes(req.method)) {
        let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)fail('La solicitud supera 12 MB.',413);chunks.push(chunk)}
        try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{fail('JSON inválido.')}
        if(!body||typeof body!=='object'||Array.isArray(body))fail('Se requiere un objeto JSON.')
      }
      const path=url.pathname,method=req.method
      if(path==='/api/session'&&method==='GET')return send(safeUser(user)??null)
      if(path==='/api/config'&&method==='GET')return send({...authService.config,...locations.config,...visits.config})
      if(await authService.handle({path,method,body,req,res,send,token}))return
      if(await locations.handle({path,method,body,auth,send}))return
      if(await visits.handle({path,method,body,auth,send}))return
      if(await searches.handle({path,method,body,auth,send}))return
      if(await reviews.handle({path,method,body,auth,send,res}))return
      if(await extras.handle({path,method,body,auth,user,send}))return
      if(await dbViewer.handle({path,method,body,auth,send,url}))return
      if(path==='/api/account/publishing'&&method==='POST'){auth();if(user.role==='comprador')db.prepare("UPDATE users SET role='vendedor' WHERE id=?").run(user.id);return send(safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)))}
      if(path==='/api/properties'&&method==='GET')return send(rows().filter(p=>visible(p)||p.sellerId===user?.id||user?.role==='admin').map(p=>p.sellerId===user?.id||user?.role==='admin'?p:{...p,review:{status:'aprobada'}}))
      const restore=/^\/api\/properties\/([^/]+)\/restore$/.exec(path)
      if(restore&&method==='POST'){
        auth(['vendedor','admin']);const p=rows().find(x=>x.id===restore[1]);if(!p)fail('Publicación no encontrada.',404)
        if(p.sellerId!==user.id&&user.role!=='admin')fail('Solo puedes gestionar tus publicaciones.',403)
        if(p.review.hold&&user.role!=='admin')fail('CasaFast retiró esta publicación. Contacta a soporte para revisarla.',403)
        // Si estaba marcada como vendida o rentada, vuelve a estar disponible.
        const raw=JSON.parse(db.prepare('SELECT data FROM properties WHERE id=?').get(p.id).data);delete raw.closed
        db.prepare('UPDATE properties SET active=1,data=? WHERE id=?').run(JSON.stringify(raw),p.id);audit(user,'volver a publicar',p.id)
        return send({ok:true,review:p.review})
      }
      if(path==='/api/upload'&&method==='POST') {
        auth(['vendedor','admin']);const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.image||'');if(!match)fail('Selecciona una imagen JPG, PNG o WebP.')
        const bytes=Buffer.from(match[2],'base64');if(bytes.length>5*1024*1024)fail('Cada imagen debe pesar menos de 5 MB.')
        const kind=bytes.subarray(0,8).toString('hex').startsWith('89504e470d0a1a0a')?'png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null
        if(kind!==match[1])fail('El archivo no corresponde a una imagen válida.')
        const name=`${randomUUID()}.${kind==='jpeg'?'jpg':kind}`;writeFileSync(join(dataDir,'uploads',name),bytes);return send({url:`/uploads/${name}`})
      }
      if(path==='/api/properties'&&method==='POST'||/^\/api\/properties\/[^/]+$/.test(path)&&['PUT','DELETE'].includes(method)) {
        auth(['vendedor','admin']);const id=method==='POST'?randomUUID():path.split('/').pop(),old=rows().find(p=>p.id===id)
        if(method!=='POST'&&!old)fail('Publicación no encontrada.',404)
        if(old&&old.sellerId!==user.id&&user.role!=='admin')fail('Solo puedes gestionar tus publicaciones.',403)
        if(old?.review.hold&&user.role!=='admin')fail('CasaFast retiró esta publicación. Contacta a soporte para revisarla.',403)
        if(method==='DELETE'){db.prepare('UPDATE properties SET active=0 WHERE id=?').run(id);audit(user,'retirar',id);return send({ok:true})}
        if(!['venta','renta'].includes(body.operation))fail('Operación inválida.')
        if(!['Casa','Departamento','Terreno'].includes(body.type))fail('Tipo inválido.')
        const images=body.images;if(!Array.isArray(images)||images.length<1||images.length>8||images.some(i=>typeof i!=='string'||!/^\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/.test(i)||!existsSync(join(dataDir,i.slice(1)))))fail('Agrega de 1 a 8 fotografías válidas.')
        const docs=reviews.collect(body.documents,user,{operation:body.operation,type:body.type},old?.id)
        const verifiedLocation=locations.forProperty(body,old,user)
        body={...body,...verifiedLocation}
        const data={title:required(body.title,'Título',120),description:required(body.description,'Descripción',5000),location:required(body.location,'Ciudad'),address:required(body.address,'Dirección'),operation:body.operation,type:body.type,price:number(body.price,'Precio',1,1e10),bedrooms:number(body.bedrooms,'Recámaras',0,100),bathrooms:number(body.bathrooms,'Baños',0,100),area:number(body.area,'Superficie',1,1e7),lat:number(body.lat,'Latitud',-90,90),lng:number(body.lng,'Longitud',-180,180),images,created:old?.created||new Date().toISOString(),...verifiedLocation}
        db.prepare('INSERT INTO properties(id,seller_id,data,active) VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET data=excluded.data,active=1').run(id,old?.sellerId||user.id,JSON.stringify(data))
        reviews.afterSave(id,docs,{created:method==='POST'})
        if(old&&Number(data.price)<Number(old.price)&&visible(old)&&reviews.isPublic(id))void extras.priceDrop({...data,id,sellerId:old.sellerId},old.price).catch(()=>{})
        return send({...data,id,sellerId:old?.sellerId||user.id,active:true,review:reviews.info(id)},method==='POST'?201:200)
      }
      if(path==='/api/favorites') {
        auth();if(method==='GET')return send(db.prepare('SELECT property_id FROM favorites WHERE user_id=?').all(user.id).map(r=>r.property_id))
        if(method==='POST'){if(typeof body.saved!=='boolean'||typeof body.id!=='string')fail('Favorito inválido.');if(body.saved&&!rows().some(p=>p.id===body.id&&visible(p)))fail('Publicación no disponible.',404);if(body.saved)db.prepare('INSERT OR IGNORE INTO favorites VALUES(?,?)').run(user.id,body.id);else db.prepare('DELETE FROM favorites WHERE user_id=? AND property_id=?').run(user.id,body.id);return send({ok:true})}
      }
      if(path==='/api/admin/users'&&method==='GET'){auth(['admin']);const counts=new Map(db.prepare('SELECT seller_id,COUNT(*) n,SUM(active) a FROM properties GROUP BY seller_id').all().map(r=>[r.seller_id,r]));return send(db.prepare('SELECT * FROM users WHERE id<>?').all('demo').map(u=>({...safeUser(u),verified:!!u.verified,listings:counts.get(u.id)?.n||0,activeListings:counts.get(u.id)?.a||0})))}
      if(/^\/api\/admin\/users\/[^/]+$/.test(path)&&method==='PATCH'){
        auth(['admin']);const id=path.split('/').pop();if(id===user.id||id==='demo')fail('No puedes desactivar esta cuenta.');if(typeof body.active!=='boolean')fail('Estado inválido.')
        db.prepare('UPDATE users SET active=? WHERE id=?').run(body.active?1:0,id);if(!body.active){db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.prepare('UPDATE properties SET active=0 WHERE seller_id=?').run(id)}audit(user,body.active?'activar usuario':'desactivar usuario',id);return send({ok:true})
      }
      fail('Ruta no encontrada.',404)
    }catch(e){if(!e.status)console.error(e);if(!res.headersSent)send({error:e.status?e.message:'No se pudo completar la operación.'},e.status||500);else res.end()}
  }
}

