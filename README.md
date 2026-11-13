# CasaFast - versión local integrada

## Configuración de correo y Google Maps

Antes de registrar cuentas o publicar inmuebles, sigue [CONFIGURAR_CORREO_Y_MAPAS.md](./CONFIGURAR_CORREO_Y_MAPAS.md). Los servicios quedan pendientes de credenciales: no hay envío de correo ni comprobación geográfica simulados. Hay un modo de vista previa local para probar los correos sin enviarlos.

## Iniciar

Requiere Node.js 24 o posterior. En PowerShell:

```powershell
cd C:\CasaFast\frontend
npm.cmd install
npm.cmd run dev
```

`npm.cmd install` solo es necesario en una instalación nueva. Abre la dirección que imprime Vite (normalmente http://127.0.0.1:5173). Conserva la terminal abierta. Ctrl+C detiene el servidor.

Una sola terminal inicia React, la API y SQLite. No hace falta ejecutar MySQL. La API está integrada como middleware de Vite para esta versión local; `npm run preview` también monta la API. No se presenta este servidor de desarrollo como despliegue de producción.

## Novedades: herramientas para decidir

- **Búsquedas guardadas** («Guardar búsqueda» junto a los filtros del mapa). Se guardan en el servidor (tabla `saved_searches`, hasta 10 por cuenta) y en «Descubre tu zona» muestran cuántas propiedades nuevas aparecieron desde tu última revisión. Al abrir una, se aplican sus filtros y se marca como revisada.
- **Comparador de favoritos**: en «Mis favoritos», elige hasta tres propiedades y compáralas lado a lado (precio, precio por m², superficie, recámaras, baños y precio frente a la zona). Se resalta con ★ el mejor valor de cada fila; no se cruzan precios de venta con renta.
- **Precio frente a la zona**: el detalle muestra el precio por m² y lo compara con la mediana de anuncios de la misma operación y tipo a 15 km o menos (requiere al menos 3 comparables). Las tarjetas muestran «Buen precio» (≥10 % debajo) o «Sobre la zona» (≥15 % arriba).
- **Calculadora**: en venta estima mensualidad, total pagado e ingreso sugerido según enganche, plazo y tasa; en renta calcula el dinero para mudarte y el ingreso recomendado. Es orientativa, no una oferta de crédito.
- **Enlaces para compartir**: «Compartir» usa el menú del teléfono o copia un enlace `/?propiedad=<id>` que abre directamente la propiedad. Los botones atrás/adelante del navegador recuerdan la propiedad abierta.
- **Galería**: flechas sobre la foto, contador y navegación con ← → del teclado.

Archivos nuevos: `src/search.js` (motor de búsqueda compartido), `src/Insights.jsx` y `src/Insights.css` (componentes anteriores), `server/searches.mjs` y `server/searches.test.mjs`.

## Publicaciones de prueba en todo México

```powershell
npm.cmd run demo:mexico            # 100 por estado (3,200)
npm.cmd run demo:mexico -- 50      # otra cantidad por estado
npm.cmd run demo:mexico -- quitar  # eliminarlas
```

```powershell
npm.cmd run demo:mexico -- asignar                 # solo pasa los ejemplos a la cuenta responsable
npm.cmd run demo:mexico -- asignar otro@correo.com
```

Todos los ejemplos pertenecen a la cuenta responsable (por defecto **alfredovidriomarketplace@gmail.com**, que debe estar registrada): sus solicitudes de visita llegan a «Mi espacio» de esa cuenta, que las confirma, rechaza o propone otro horario. Regenerar los ejemplos borra sus citas y favoritos; para solo reasignar usa `asignar`.

**Agenda abierta:** cualquier propiedad sin horarios publicados permite pedir una hora completa de 9:00 a 18:00 (Culiacán) en los próximos 14 días; el vendedor confirma. Si el vendedor publica horarios, solo se ofrecen esos.

Crea un respaldo en `server/data/backups` antes de escribir. Son anuncios de ejemplo repartidos en 2 a 5 ciudades por estado, con precios ajustados por región y fotos del catálogo de demostración. Se pueden regenerar sin duplicarse y no tocan publicaciones reales. Con muchas propiedades, el mapa agrupa los marcadores en burbujas y la lista carga las tarjetas por bloques.

## Revisión de documentos y panel de administración

**Publicar requiere documentación.** Al publicar, el vendedor sube (PDF, JPG o PNG, máx. 6 MB):

| Documento | Obligatorio |
|---|---|
| Identificación oficial vigente del propietario (INE o pasaporte) | Siempre |
| Escritura pública o título de propiedad inscrito en el Registro Público | Siempre |
| Boleta de predial del año en curso pagada | Siempre |
| Recibo de agua sin adeudo / constancia de no adeudo | Casas y departamentos |
| Certificado de libertad de gravamen (máx. 3 meses) | Venta |
| Poder notarial | Opcional (si quien publica no es el propietario) |

Los documentos se guardan en `server/data/documents/` (privado, fuera de la carpeta pública). Solo el vendedor y los administradores pueden abrirlos.

Cada publicación nueva queda **En revisión** y no aparece en el catálogo hasta que un administrador la aprueba. Compromiso: **24 horas hábiles** (lunes a viernes). Si se rechaza, el vendedor ve el motivo y la corrige desde «Mi espacio». Editar una publicación aprobada no la regresa a revisión, salvo que se suban documentos nuevos. Las publicaciones existentes y los ejemplos se consideran aprobados.

**Volver a publicar:** las publicaciones retiradas por el vendedor tienen el botón «Volver a publicar» (un clic). Las retiradas por CasaFast solo las restaura un administrador.

**Panel de administración (oculto):** no tiene enlaces en la página. Entra a `http://127.0.0.1:5173/?admin` con una cuenta administradora. Incluye: revisión de documentación (aprobar / rechazar con motivo, plazo restante), publicaciones (retirar con motivo / restaurar), cuentas (suspender / reactivar) y registro de actividad. Para crear la cuenta administradora, registra una cuenta normal, verifica su correo y ejecuta:

```powershell
npm.cmd run admin -- correo-del-admin@ejemplo.com CONFIRMAR-ADMIN
```

## Correos con Gmail (sin dominio propio)

Resend en modo de prueba solo entrega al correo dueño de la cuenta. Para enviar a cualquier persona sin comprar un dominio, CasaFast puede enviar desde una cuenta de Gmail con una **contraseña de aplicación**:

1. En la cuenta de Google que enviará los correos, activa la **verificación en dos pasos**.
2. Entra a https://myaccount.google.com/apppasswords, crea una contraseña llamada «CasaFast» y copia las 16 letras.
3. En `.env.local` cambia el modo de correo:

```
EMAIL_MODE=smtp
SMTP_USER=tu-cuenta@gmail.com
SMTP_PASS=abcd efgh ijkl mnop
EMAIL_FROM_NAME=CasaFast
```

4. Reinicia `npm.cmd run dev`. Las líneas de Resend pueden quedarse; no se usan mientras `EMAIL_MODE=smtp`.

Gmail permite unos 500 correos al día desde una cuenta personal: suficiente para pruebas y demostraciones.

## Probar el flujo completo

1. Crea una cuenta con la opción «Quiero publicar una propiedad».
2. Verifica tu correo y publica un inmueble con de 1 a 8 fotografías JPG, PNG o WebP (máximo 5 MB cada una). Selecciona el pin en Google Maps, revisa la dirección y valídala.
3. Cierra sesión y crea otra cuenta como comprador, con un correo diferente.
4. Encuentra la propiedad, guárdala en favoritos y solicita una visita futura.
5. Inicia sesión como vendedor y acepta o rechaza la solicitud desde «Mi espacio».
6. Vuelve a la cuenta de comprador y consulta el estado. «Actualizar» recupera los últimos cambios; también se actualizan al volver a la pestaña.

Las seis propiedades iniciales están identificadas como ejemplos; usan datos y una fotografía ilustrativos y no admiten visitas.

## Datos

- Base de datos: `server/data/casafast.sqlite`.
- Imágenes: `server/data/uploads/`.
- Usuarios, sesiones, favoritos, propiedades y citas se guardan en el servidor y persisten tras reiniciarlo.
- Para respaldar, detén el servidor y copia la carpeta completa `server/data` (incluye archivos auxiliares de SQLite si existen).
- No publiques `server/data`, contraseñas ni copias de seguridad en Git.
- La información del antiguo prototipo en localStorage no se borra ni se importa automáticamente. Las cuentas antiguas deben registrarse de nuevo; nunca se reutilizan sus contraseñas en texto plano. Las publicaciones anteriores pueden recrearse con sus fotografías originales.

## Búsqueda

Venta/renta, texto sin distinguir acentos, tipo de inmueble, precio máximo, recámaras, orden y radio de 1 a 50 km. El radio usa Haversine con las coordenadas de cada inmueble y el centro seleccionado. Hay centros de referencia para Culiacán, Navolato, Mazatlán y Los Mochis, y geolocalización opcional del navegador. La distancia es en línea recta, no de conducción. Escribir una colonia filtra texto; no cambia por sí solo el centro del radio.

## Administrador

Registra primero una cuenta normal. Desde una terminal local autorizada:

```powershell
npm.cmd run admin -- tu-correo@ejemplo.com
```

El comando convierte esa cuenta existente en administradora; no crea contraseñas predeterminadas. Cierra sesión y vuelve a entrar. El panel permite retirar publicaciones y activar/desactivar cuentas. Desactivar un vendedor retira sus anuncios; reactivarlo no vuelve a publicarlos automáticamente. Las acciones administrativas quedan en la tabla `audit`.

## Validación

```powershell
npm.cmd test
npm.cmd run build
```

Las pruebas usan una base temporal aislada. Comprueban registros, sesiones, contraseñas protegidas, prohibición de autorregistro administrativo, permisos entre vendedores, archivos, favoritos, fechas y duplicados de citas, estados, administración y persistencia tras reiniciar la API.

## Archivos principales

- `src/CasaFast.jsx`: catálogo, búsqueda, detalle y paneles.
- `src/Forms.jsx`: registro, acceso, publicación y citas.
- `src/lib.js`: cliente API y cálculo de distancias.
- `src/CasaFast.css`: diseño adaptable.
- `server/api.mjs`: API y esquema SQLite.
- `server/api.test.mjs`: pruebas de integración.
- `server/admin.mjs`: promoción local de administrador.
- `vite.config.js`: arranque conjunto del frontend y API.

Los componentes originales permanecen como referencia, pero `src/main.jsx` ahora monta `CasaFast.jsx`.

## Alcance y preparación para publicación

Esta entrega completa el flujo local del MVP. Antes de ofrecerlo públicamente faltan alojamiento con HTTPS, moderación/reportes, copias de seguridad automatizadas, límites de archivos por cuenta, paginación y medidas operativas frente a abuso. SQLite sustituye a la propuesta inicial de MySQL para que funcione sin instalar servicios adicionales; no se ha integrado MySQL ni Express. Las tipografías usan Google Fonts con fuentes del sistema como respaldo. El enlace de ubicación abre Google Maps. Los correos de verificación y recuperación están integrados con Resend, pendientes de credenciales; no se envían SMS.

