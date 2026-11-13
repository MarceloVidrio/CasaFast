# Visitas y WhatsApp en CasaFast

## Primero: probar las visitas

1. Abre CasaFast e inicia sesión con el vendedor de una propiedad real. Los veinte anuncios de ejemplo no admiten visitas.
2. En **Mi espacio**, localiza la publicación y pulsa **Horarios de visita**.
3. Elige un día futuro y un intervalo. Por ejemplo, 10:00–13:00 publica tres horarios: 10:00, 11:00 y 12:00. Cada visita dura una hora. Todos los horarios se muestran en hora de Culiacán, incluso si tu computadora tiene otra zona horaria.
4. Usa una cuenta distinta para probar al comprador (puede ser también vendedor de otras propiedades). Abre la casa, elige un horario y escribe una pregunta si lo deseas.
5. Opcionalmente activa los avisos de WhatsApp y escribe tu número con código de país: +52 seguido de los diez dígitos en México. Confirma que es tu número. El teléfono no se muestra al vendedor.
6. Pulsa **Revisar solicitud**, comprueba los datos y después **Enviar solicitud de visita**.
7. En **Mis visitas** aparece **Pendiente**. Ese horario queda reservado, también para las demás propiedades del mismo vendedor, durante un máximo de 48 horas o hasta la hora de la visita.
8. El vendedor entra en Mi espacio y pulsa **Confirmar visita**, **Rechazar solicitud** o **Reprogramar**.
9. Al confirmar, ambas cuentas ven el domicilio confirmado y un enlace al punto exacto en Google Maps. El comprador que autorizó WhatsApp recibirá el mismo dato cuando esté habilitado el servicio.
10. Las dos personas pueden cancelar una visita futura o proponer otro horario publicado. La otra debe aceptar el cambio. Si ya existía una visita confirmada, se conserva mientras se decide. Rechazar el cambio conserva la confirmada; si la solicitud original no estaba confirmada, la rechaza.
11. Puedes descargar un archivo de calendario (.ics) en una visita confirmada. Si cambia el horario, vuelve a descargarlo y actualiza tu calendario.

Una cuenta que busca también puede publicar: pulsa **Publicar**. Se habilitará el perfil vendedor sin crear un segundo correo, conservando tus favoritos y visitas. No puedes solicitar una visita a tu propia propiedad.

## Prueba local de mensajes, sin WhatsApps reales

1. Abre `C:\CasaFast\frontend\.env.local` en Visual Studio Code. No lo compartas.
2. Agrega una línea nueva:

```dotenv
WHATSAPP_MODE=preview
```

3. Para ver también correos de prueba, usa `EMAIL_MODE=preview` y `APP_URL=http://localhost:5173` (o tu dirección local configurada).
4. Guarda con Ctrl+S. En la terminal detén el servidor con Ctrl+C; si pregunta S/N, pulsa S y Enter. Vuelve a ejecutar `npm.cmd run dev`.
5. Solicita una visita con una cuenta de prueba y un teléfono de ejemplo. Activa explícitamente la casilla de WhatsApp.
6. Confirma la visita desde la cuenta del vendedor.
7. En el Explorador de Windows, abre `C:\CasaFast\frontend\server\data\whatsapp-preview`. Abre el archivo `.txt` más reciente: contiene la vista previa, incluida la dirección y el enlace del mapa al confirmarse. No se envió un mensaje real.
8. Los correos de prueba están en `server\data\mail-preview`.

Las vistas previas pueden contener números y domicilios; son archivos privados del servidor, bloqueados para el navegador. Este modo solo funciona en desarrollo con APP_URL local y nunca en NODE_ENV=production.

## Activar envíos reales con Twilio WhatsApp

La integración usa WhatsApp Business mediante Twilio. Crear una cuenta, habilitar el remitente y aprobar la plantilla se realiza en los paneles de los proveedores. La aplicación no completa esos pasos ni compra servicios. Consulta los costos y condiciones vigentes antes de activar envíos reales.

1. Crea tu cuenta en https://www.twilio.com/ y sigue su proceso para habilitar un remitente de WhatsApp Business. El remitente debe estar habilitado por Twilio/Meta; escribir cualquier teléfono en el archivo no lo registra.
2. En Twilio, abre **Messaging → Content Template Builder**. Crea una plantilla de texto en español para avisos de visitas, de categoría correspondiente a notificaciones de servicio, y solicita su aprobación para WhatsApp.
3. Usa exactamente estas seis variables en este orden:

```text
Hola {{1}}, tienes una actualización de tu visita en CasaFast.
Estado: {{2}}
Propiedad: {{3}}
Fecha y hora: {{4}}
Domicilio: {{5}}
Ubicación: {{6}}
Consulta Mis visitas en CasaFast para confirmar el estado actual o gestionar cambios.
```

La plantilla debe admitir tanto solicitudes y cancelaciones como confirmaciones; para las solicitudes pendientes, domicilio y ubicación llevan «Consulta los detalles en CasaFast» y «Consulta CasaFast», sin revelar el domicilio en el mensaje. Twilio/Meta determinan si aprueban el contenido; si requieren ajustes, conserva el orden y significado de las seis variables.

4. Obtén el **Content SID** de la plantilla aprobada: comienza por `HX`. Obtén también tu **Account SID** (`AC...`) y Auth Token del panel de Twilio.
5. Copia las credenciales directamente a `.env.local`, sin enviarlas por chat ni capturas:

```dotenv
WHATSAPP_MODE=twilio
TWILIO_ACCOUNT_SID=AC_TU_IDENTIFICADOR
TWILIO_AUTH_TOKEN=TU_TOKEN_PRIVADO
TWILIO_WHATSAPP_FROM=+NUMERO_HABILITADO
TWILIO_VISIT_CONTENT_SID=HX_TU_PLANTILLA_APROBADA
```

Reemplaza los ejemplos completos por los valores reales. El teléfono empieza con `+` y código de país, sin el prefijo `whatsapp:`. No uses `VITE_` en los nombres. El servidor devuelve únicamente si está configurado, nunca estas credenciales.

6. Reinicia `npm.cmd run dev`.
7. Prueba con tu propio número y consentimiento. Confirma una cita y comprueba el mensaje en tu WhatsApp. Revisa también los registros del proveedor si no llega.

El Sandbox de Twilio requiere que cada destinatario se una a él. Sus plantillas disponibles pueden no coincidir con las seis variables de CasaFast. Esta integración usa una plantilla aprobada compatible; no envía texto libre como sustituto de una plantilla ni evita las restricciones del Sandbox.

Fuentes oficiales: https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates y https://www.twilio.com/docs/whatsapp/api

## Qué significa el estado de un aviso

- **Servicio sin activar**: se guardó el aviso, no se envió. Puedes activar el servicio y reintentar desde Mis visitas si el aviso sigue vigente.
- **Vista previa local**: se escribió un archivo, no se envió.
- **Aceptado por el proveedor; entrega no confirmada**: Twilio o el servicio de correo aceptó el envío; esto no prueba que haya llegado ni que se haya leído. La integración todavía no incorpora webhooks de entrega/lectura.
- **No se pudo enviar**: el estado de la visita se conserva; el aviso puede reintentarse. Los fallos de conexión pueden tener un resultado remoto incierto: revisa el proveedor antes de reintentar para evitar duplicados.
- **Resultado desconocido**: el proceso se interrumpió mientras enviaba. No se reenvía automáticamente.
- **Sustituido**: la visita cambió; un aviso antiguo no se vuelve a enviar.

Hay una cola persistente en SQLite. Mientras el servidor está encendido, cada 30 segundos revisa caducidades y avisos pendientes/fallidos (hasta tres intentos automáticos con al menos un minuto entre fallos). Los avisos también se procesan al cambiar la visita o abrir Mis visitas. Al cerrar la terminal, los procesos se detienen y se retoman al volver a abrir el proyecto; no es un servicio de alojamiento permanente.

Los correos usan la configuración de Resend ya existente. Para correos reales deben estar configurados Resend y su remitente. Una cita confirmada no se revierte por un fallo de envío: Mis visitas es la referencia del estado actual.

La ubicación exacta enviada es el pin y domicilio que el vendedor guardó y confirmó en la publicación. El sistema no puede demostrar que el vendedor sea dueño ni que el número exterior sea correcto. Antes de aceptar, el vendedor debe revisar el domicilio y la entrada de la casa. Se guarda una copia del domicilio y pin al confirmar, para conservar los datos acordados.

Al migrar, las visitas antiguas se conservan. Una solicitud antigua aún pendiente puede confirmarse o cancelarse; los nuevos registros requieren elegir un horario publicado. Los estados anteriores y los anuncios existentes no se borran.
