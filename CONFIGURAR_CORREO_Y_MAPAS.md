# Activar correo y ubicaciones en CasaFast

La integración está programada, pero los servicios externos todavía no están activados. No se han contratado servicios ni creado claves. Hasta configurarlos, la aplicación muestra mensajes claros: no simula el envío de correos y no permite publicar una ubicación sin comprobarla.

## 1. Crear la configuración local

En la terminal de Visual Studio Code:

```powershell
cd C:\CasaFast\frontend
Copy-Item .env.example .env.local
```

Haz la copia solo si `.env.local` todavía no existe. Edita `.env.local` en Visual Studio Code. Este archivo está excluido de Git. No pegues claves en el chat ni las escribas en los archivos de React.

Después de modificar la configuración, detén la terminal de Vite con Ctrl+C y vuelve a ejecutar:

```powershell
npm.cmd run dev
```

## 2. Correo real con Resend

Necesitas una cuenta de Resend y un dominio de tu propiedad (por ejemplo, el que vayas a utilizar para CasaFast).

1. Abre [Resend](https://resend.com/) y agrega el dominio en **Domains**. Puedes usar un subdominio dedicado, como `correo.tudominio.mx`.
2. En el administrador DNS de tu dominio, agrega los registros que Resend muestre. Espera a que el dominio aparezca verificado. Usa los valores del panel, no valores inventados o de un ejemplo.
3. Crea una API key limitada al envío de correo y al dominio correspondiente.
4. Elige un remitente del dominio verificado, por ejemplo `CasaFast <cuentas@correo.tudominio.mx>`.
5. Completa `.env.local`:

```dotenv
APP_URL=http://localhost:5173
EMAIL_MODE=resend
EMAIL_FROM=CasaFast <cuentas@correo.tudominio.mx>
RESEND_API_KEY=PEGA_AQUI_TU_CLAVE_PRIVADA
```

`APP_URL` es la dirección que abrirán los enlaces del correo. Mientras pruebes en esta computadora puede ser localhost. Un enlace a localhost abierto en un teléfono u otra computadora no llegará a este servidor. Al publicar CasaFast, cambia ese valor al dominio HTTPS real antes de enviar correos a usuarios.

Evita el seguimiento de clics en los correos de autenticación. El enlace usa un fragmento (`#verify=...` o `#reset=...`); la aplicación lo retira de la barra de direcciones después de leerlo y no consume el token hasta que la persona confirma la acción.

### Qué ocurre al registrarse

- La cuenta se guarda como pendiente de verificación; no se abre una sesión.
- Llega un correo con un enlace que dura **24 horas** y sirve una sola vez.
- Al confirmar, se habilita el inicio de sesión.
- En el acceso existe **Reenviar verificación**. Cada envío correcto invalida el enlace anterior. Hay que esperar al menos un minuto entre solicitudes.
- Si el servicio de correo falla, la cuenta sigue pendiente. La pantalla informa del problema; después puede solicitarse otro enlace.
- Las cuentas anteriores a esta mejora también deben verificar su correo. No se consideran verificadas automáticamente.

### Recuperación de contraseña

- En **Iniciar sesión**, pulsa **Olvidé mi contraseña**.
- El mensaje de respuesta es el mismo exista o no una cuenta con ese correo.
- El enlace dura **30 minutos** y sirve una sola vez.
- La contraseña nueva debe tener entre 10 y 128 caracteres.
- Al cambiarla, se cierran todas las sesiones anteriores. La persona debe volver a iniciar sesión.
- Recuperar una contraseña no omite la verificación pendiente del correo.

### Probar el flujo sin contratar un dominio

Solo para desarrollo en tu computadora, puedes configurar:

```dotenv
APP_URL=http://localhost:5173
EMAIL_MODE=preview
```

Reinicia Vite. Registra una cuenta de prueba. **No se envía ningún correo real**: se genera un archivo HTML en `server/data/mail-preview/`. Abre el archivo más reciente para ver el correo y pulsa su enlace. La pantalla avisa que estás usando el modo local. Lo mismo funciona para recuperar la contraseña.

Los archivos contienen enlaces de acceso temporales: no los compartas. No se sirven por HTTP y están dentro de la carpeta de datos excluida de Git. El modo preview se rechaza con un dominio remoto o `NODE_ENV=production`. Para volver a dejar el envío pendiente, usa `EMAIL_MODE=disabled`.

## 3. Google Maps

La implementación usa **Maps JavaScript API** para mostrar el mapa y **Geocoding API** para buscar direcciones y convertir un pin en una dirección. No requiere Places API en esta versión: la búsqueda se ejecuta al pulsar el botón, no por cada tecla.

1. Crea o selecciona un proyecto en [Google Cloud Console](https://console.cloud.google.com/).
2. Habilita la facturación del proyecto y las APIs **Maps JavaScript API** y **Geocoding API**. Revisa sus precios y cuotas en tu cuenta antes de activarlas; esta integración no contrata ni paga esos servicios.
3. Crea **dos claves distintas**:
   - **Navegador:** restricción de aplicación por sitios web, limitada a Maps JavaScript API. Durante desarrollo, agrega `http://localhost:5173/*` y `http://127.0.0.1:5173/*`. Agrega solo los puertos de desarrollo que realmente uses y, después, el dominio de producción.
   - **Servidor:** limitada a Geocoding API y a la IP pública de salida del servidor que hará las consultas. En desarrollo esa IP puede ser la de tu conexión de internet; `127.0.0.1` no es la IP que verá Google. Si cambia, actualiza la restricción. La clave del servidor nunca se entrega al navegador.
4. Para desarrollo se usa `DEMO_MAP_ID`; para publicación crea tu propio **Map ID de JavaScript**.
5. Completa el mismo `.env.local`:

```dotenv
GOOGLE_MAPS_BROWSER_KEY=PEGA_LA_CLAVE_RESTRINGIDA_DEL_NAVEGADOR
GOOGLE_MAPS_SERVER_KEY=PEGA_LA_CLAVE_PRIVADA_DEL_SERVIDOR
GOOGLE_MAPS_MAP_ID=DEMO_MAP_ID
```

Reinicia Vite. La clave del navegador es visible por diseño; su protección depende de las restricciones de dominio y API. No uses la clave privada del servidor en ese campo. Configura cuotas de uso y avisos de facturación en Google Cloud; un aviso de presupuesto no equivale a un límite automático de gasto.

## 4. Publicar con dirección contrastada

1. Entra con una cuenta de vendedor cuyo correo esté verificado.
2. Pulsa **Publicar** y completa la información del inmueble.
3. En **Ubica tu propiedad**, busca, por ejemplo, `Las Quintas, Culiacán, Sinaloa` y elige un resultado.
4. Acerca el mapa. Haz clic o arrastra el pin hasta la entrada de la casa. Se consultará la dirección cercana y se completarán calle, número, colonia, ciudad, estado y código postal cuando Google tenga esos datos.
5. Revisa y corrige los campos. Puedes agregar interior y referencias. Un resultado por colonia es un punto de partida; no identifica por sí solo una vivienda.
6. Marca que el pin y la dirección corresponden al inmueble y pulsa **Validar dirección con el mapa**.
7. Cuando se muestre la confirmación, agrega fotografías y publica.

El servidor vuelve a consultar la dirección y exige una coincidencia de calle y localidad cercana al pin (máximo 200 metros), sin una coincidencia parcial. Número, colonia y código postal deben coincidir cuando se proporcionan. Las zonas rurales, calles nuevas o nomenclaturas que Google no reconozca pueden no pasar esta comprobación; no se marca una dirección inventada como válida para sortearlo.

Cambiar cualquier dato de dirección o mover el pin invalida la comprobación. El comprobante caduca a los **30 minutos** y está asociado a la cuenta: no se puede reutilizar el de otro vendedor ni cambiar las coordenadas después. Editar solo el precio de un anuncio que ya tenía dirección contrastada conserva su comprobación previa.

Google no siempre devuelve número, colonia o código postal. El sistema deja los campos ausentes para que se revisen. Contrastar la dirección no prueba que la casa exista físicamente, su disponibilidad o quién es su propietario; esas verificaciones requieren otros procesos.

## 5. Comprobaciones antes de abrir al público

- Configura el dominio HTTPS real en `APP_URL`, el dominio de correo verificado y las restricciones de ambas claves.
- Prueba un registro y una recuperación con un correo tuyo, revisando recepción, spam, caducidad y reenvío.
- Prueba un inmueble que conozcas: selecciona su pin, revisa la dirección y verifica que los datos incorrectos sean rechazados.
- Publica las páginas de privacidad y términos que correspondan al servicio e informa del uso de los proveedores de correo y mapas. Consulta los requisitos de Google enlazados abajo.
- Conserva la atribución de Google Maps. No ocultes los controles o avisos del mapa.
- La integración no guarda respuestas completas de Google ni crea un catálogo propio de direcciones de Google: conserva el Place ID, la comprobación y los datos del anuncio que el vendedor revisa y confirma. Antes de publicación, revisa que el tratamiento de esos campos y las condiciones de retención se ajusten a tu acuerdo con Google; confirmar un formulario no elimina las restricciones del proveedor.

## 6. Pruebas y diagnóstico

```powershell
cd C:\CasaFast\frontend
npm.cmd test
npm.cmd run build
```

Las pruebas usan proveedores simulados y bases temporales: no mandan correos ni consumen Google Maps. Comprueban autorización, enlaces, recuperación, caducidad, validación de ubicaciones y preservación del catálogo vacío. Las llamadas reales y la calidad de las direcciones deben probarse cuando tengas las credenciales.

| Mensaje | Qué revisar |
| --- | --- |
| Correo pendiente de activación | `EMAIL_MODE`, `APP_URL`, `EMAIL_FROM`, `RESEND_API_KEY`, y reinicio de Vite. |
| No se pudo enviar el correo | Dominio verificado, permisos de la clave, remitente, cuotas y panel de Resend. No hace falta compartir la clave para describir el error. |
| Cuenta pendiente de verificación | Abre el enlace recibido o usa Reenviar verificación. |
| Enlace inválido o caducado | Solicita uno nuevo; utiliza el más reciente. |
| Mapa pendiente de activación | Ambas claves de Maps y reinicio de Vite. |
| Google no carga el mapa | API habilitada, facturación, dominio/puerto autorizado, Map ID y conexión. |
| Consulta de ubicación no disponible | Clave del servidor, Geocoding API, restricciones de IP y cuotas. |
| Dirección no coincide | Acerca el mapa, mueve el pin a la entrada y revisa la dirección sugerida. |

## Documentación oficial

- [Resend: verificación de dominios](https://resend.com/docs/dashboard/domains/introduction)
- [Resend: API de envío](https://resend.com/docs/api-reference/emails/send-email)
- [Google: carga de Maps JavaScript API](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)
- [Google: geocodificación inversa](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-reverse-geocoding)
- [Google: marcadores arrastrables](https://developers.google.com/maps/documentation/javascript/advanced-markers/draggable-markers)
- [Google: seguridad de claves](https://developers.google.com/maps/api-security-best-practices)
- [Google: políticas de geocodificación y atribución](https://developers.google.com/maps/documentation/geocoding/policies)
