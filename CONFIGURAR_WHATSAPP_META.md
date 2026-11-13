# Conectar WhatsApp de Meta con CasaFast

El «Hola, mundo» recibido confirma el envío de prueba del panel de Meta. Todavía no es una confirmación de CasaFast. No usamos esa plantilla para marcar avisos de visitas como enviados porque no contiene fecha, domicilio ni ubicación.

## 1. Credenciales

Revoca el token que apareció en las capturas mediante las herramientas de acceso de Meta antes de usar uno nuevo. Generar otro token no garantiza que el anterior se invalide. No pegues tokens en el chat, capturas, terminales compartidas ni archivos con prefijo VITE_.

Abre `C:\CasaFast\frontend\.env.local`. Conserva tus valores de correo y mapas. Agrega estas líneas si todavía no existen:

```dotenv
# Conserva disabled hasta terminar la plantilla y las credenciales.
WHATSAPP_MODE=disabled
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_ACCESS_TOKEN=
META_GRAPH_VERSION=v25.0
META_WHATSAPP_TEMPLATE_NAME=casafast_visita
META_WHATSAPP_TEMPLATE_LANGUAGE=es_MX
```

Si ya hay una línea WHATSAPP_MODE, edítala; no la dupliques. Phone Number ID es el identificador numérico del remitente que muestra Meta: no es el número de WhatsApp ni el identificador de la cuenta comercial. Copia el token nuevo directamente después del signo igual de META_WHATSAPP_ACCESS_TOKEN, sin compartirlo. El token temporal de desarrollo caduca; usa para producción un token de servidor con los permisos requeridos y gestiona su vencimiento/revocación.

## 2. Plantilla para las citas

En el administrador de WhatsApp del negocio conectado a CasaFast, crea una plantilla de texto llamada `casafast_visita`. Selecciona Español (México) si está disponible, cuyo código es `es_MX`. Si eliges otro español, coloca su código exacto en META_WHATSAPP_TEMPLATE_LANGUAGE.

Selecciona variables **numéricas/posicionales**, sin encabezado con variables ni botones dinámicos. El cuerpo debe tener estas seis variables, en este orden:

```text
Hola {{1}}, tienes una actualización de tu visita en CasaFast.
Estado: {{2}}
Propiedad: {{3}}
Fecha y hora: {{4}}
Domicilio: {{5}}
Ubicación: {{6}}
Consulta Mis visitas en CasaFast para gestionar tu cita.
```

Ejemplos ficticios para la revisión: 1: Persona de prueba; 2: Visita confirmada; 3: Casa de ejemplo; 4: 15 de diciembre, 10:00 a.m., hora de Culiacán; 5: Domicilio ilustrativo, Culiacán; 6: https://www.google.com/maps/search/?api=1&query=24.8,-107.4

Solicita la categoría correspondiente a avisos de servicio; Meta decide la clasificación y aprobación. Espera hasta verla aprobada. Las cuentas/números de prueba tienen restricciones: que hello_world funcione no garantiza que puedas usar una plantilla personalizada con ese remitente. Si Meta no permite crearla o enviarla en la cuenta de prueba, hará falta completar la configuración del número real; no modifiques hello_world ni una plantilla de pedido ajena para simular confirmaciones de visitas.

Las solicitudes pendientes llevan textos de consulta en las variables de domicilio y mapa. Las confirmaciones llevan la dirección y el pin guardados por el vendedor. También se notifican cancelaciones y cambios, siempre con consentimiento previo del comprador.

## 3. Activar y probar

1. Verifica que tu teléfono esté agregado como destinatario de prueba en Meta si usas un remitente de prueba.
2. Con la plantilla aprobada y las credenciales correctas, cambia WHATSAPP_MODE a `meta`.
3. Guarda el archivo, detén el servidor con Ctrl+C y vuelve a ejecutar `npm.cmd run dev` en C:\CasaFast\frontend.
4. Desde el comprador, solicita una visita y marca la casilla de autorización de WhatsApp con tu propio número.
5. Confirma desde el vendedor. Revisa tu WhatsApp y Mis visitas → Mis avisos.
6. «Aceptado por el proveedor» significa que Meta aceptó el mensaje, no que fue entregado o leído. La integración aún no procesa webhooks de entrega/lectura.

Los avisos fallidos conservan la cita y permiten reintentar. No reintentes una solicitud ya aceptada por Meta. Un fallo de red puede dejar incierto el resultado remoto; revisa Meta antes de reenviar. La cola mantiene los avisos pendientes en SQLite y sigue las mismas reglas de caducidad y revisión que el envío por Twilio.

Para volver a pruebas sin mensajes reales usa WHATSAPP_MODE=preview (solo desarrollo local). Para desactivar usa disabled. Las credenciales de Twilio pueden quedarse sin uso; el modo meta solo utiliza Meta. Las claves no se exponen en /api/config.

## Costos y alcance

La conexión directa evita la tarifa de intermediación de Twilio. Los mensajes reales siguen sujetos a las tarifas, plantillas y requisitos vigentes de Meta. Prueba inicialmente solo con tu número y revisa los costos en tu cuenta. El servidor debe estar encendido para procesar los avisos.

Documentación oficial: https://developers.facebook.com/docs/whatsapp/cloud-api/ y https://whatsappbusiness.com/developers/developer-hub/
