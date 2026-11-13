export const sampleAddress={street:'Calle Primavera',number:'123',neighborhood:'Las Quintas',city:'Culiacán Rosales',state:'Sinaloa',postalCode:'80060',unit:'',reference:''}
export const samplePlace={placeId:'place-for-test',formatted:'Calle Primavera 123, Las Quintas, Culiacán Rosales, Sinaloa, México',lat:24.801,lng:-107.374,types:['street_address'],partial:false,precision:'ROOFTOP',country:'MX',address:sampleAddress}
export function testServices(){const emails=[];return {emails,options:{env:{APP_URL:'http://localhost:5173',GOOGLE_MAPS_BROWSER_KEY:'test-browser-key'},mailer:{enabled:true,mode:'test',async send(message){emails.push(message)}},geocoder:{enabled:true,async lookup(){return [samplePlace]}}}}}

// Sube la documentación mínima (PDF de prueba) para publicar en venta y devuelve sus identificadores.
export const samplePdf=`data:application/pdf;base64,${Buffer.from('%PDF-1.4\n% documento de prueba\n%%EOF').toString('base64')}`
export async function uploadDocuments(call,cookie,kinds=['identificacion','escritura','predial','agua','gravamen']){
  const ids=[];for(const kind of kinds){const r=await call('documents','POST',{kind,file:samplePdf,name:`${kind}.pdf`},cookie);if(r.status!==201)throw new Error(`documento ${kind}: ${r.status}`);ids.push(r.data.id)}
  return ids
}
