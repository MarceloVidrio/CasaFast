
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { renderVisitEmail } from './visit-email.mjs'
import { sendSmtp, smtpPublicMessage } from './smtp.mjs'
import { emailLayout } from './email-layout.mjs'

// Logo de CasaFast para los correos (PNG transparente, 420×129).
let logoPng = null
try { logoPng = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'assets', 'casafast-email-logo.png')) } catch {}
const LOGO_CID = 'casafast-logo'

// Nombre visible del remitente: si la línea de .env.local quedó mal escrita, se usa «CasaFast».
export const senderName = value => {
  const name = String(value || '').trim()
  return name && name.length <= 60 && !/[=<>"\r\n@]/.test(name) ? name : 'CasaFast'
}

export function createMailer(env, dataDir, request = fetch) {
  const mode = env.EMAIL_MODE || 'disabled'

  let base
  try {
    base = new URL(env.APP_URL)
  } catch {}

  const local = base &&
    ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)

  const validUrl = base &&
    !base.username &&
    !base.password &&
    !base.search &&
    !base.hash &&
    (base.protocol === 'https:' ||
      (local && base.protocol === 'http:'))

  const enabled = !!(
    validUrl &&
    (
      (mode === 'resend' && env.RESEND_API_KEY && env.EMAIL_FROM) ||
      (mode === 'smtp' && env.SMTP_USER && env.SMTP_PASS) ||
      (mode === 'preview' && local && env.NODE_ENV !== 'production')
    )
  )

  // SMTP: imagen incrustada (cid). Vista previa: imagen dentro del HTML. Resend: nombre en texto.
  const logoSrc = !logoPng ? '' : mode === 'smtp' ? `cid:${LOGO_CID}` : mode === 'preview' ? `data:image/png;base64,${logoPng.toString('base64')}` : ''

  async function deliver({ email, subject, html, text, notificationId }) {
      if (mode === 'preview') {
        const directory = join(dataDir, 'mail-preview')
        mkdirSync(directory, { recursive: true })

        writeFileSync(
          join(directory, `${Date.now()}-${randomUUID()}.html`),
          html,
          { mode: 0o600 }
        )
        return
      }

      // Gmail u otro servidor SMTP: entrega a cualquier dirección sin necesidad de dominio propio.
      if (mode === 'smtp') {
        const user = env.SMTP_USER.trim(), pass = env.SMTP_PASS.replace(/\s+/g, '')
        try {
          await sendSmtp({
            host: env.SMTP_HOST || 'smtp.gmail.com',
            port: Number(env.SMTP_PORT || 465),
            secure: env.SMTP_SECURE !== 'false',
            user, pass,
            from: `${senderName(env.EMAIL_FROM_NAME)} <${user}>`,
            to: email, subject, text, html,
            inline: logoPng && html.includes(`cid:${LOGO_CID}`) ? [{ cid: LOGO_CID, contentType: 'image/png', filename: 'casafast.png', content: logoPng }] : []
          })
          return
        } catch (error) {
          console.error('[CasaFast] Error SMTP:', error.message.replace(pass, '***'))
          throw Object.assign(new Error('No se pudo enviar el correo.'), { status: 503, publicMessage: smtpPublicMessage(error) })
        }
      }

      let response

      try {
        response = await request('https://api.resend.com/emails', {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': notificationId || randomUUID()
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: [email],
            subject,
            html,
            text
          })
        })
      } catch {
        throw Object.assign(
          new Error('No se pudo contactar al servicio de correo.'),
          { status: 503 }
        )
      }

      if (!response.ok) {
  let details = {}

  try {
    details = await response.json()
  } catch {
    details = {}
  }

  console.error('[CasaFast] Error de Resend:', {
    status: response.status,
    name: details.name || 'Desconocido',
    message: details.message || 'Sin detalles'
  })

  // Motivo claro para «Mis avisos» (sin revelar claves ni respuestas privadas).
  const reason = String(details.message || '')
  const publicMessage =
    /testing emails|own email address|verify a domain/i.test(reason)
      ? 'Resend está en modo de prueba: solo envía a tu propio correo. Verifica un dominio en Resend para enviar a cualquier persona.'
      : /domain is not verified|not verified/i.test(reason)
        ? 'El dominio del remitente no está verificado en Resend.'
        : response.status === 401 || response.status === 403
          ? 'Resend rechazó el envío: revisa la clave y el remitente configurados.'
          : response.status === 429
            ? 'Resend alcanzó su límite de envíos. Reintenta más tarde.'
            : 'No se pudo enviar el correo. Puedes reintentar desde Mis visitas.'

  throw Object.assign(
    new Error('No se pudo enviar el correo.'),
    { status: 503, publicMessage }
  )
}
  }

  return {
    mode,
    enabled,

    async send({ email, name, purpose, token, subject: noticeSubject, text: noticeText, notificationId, visit, notice }) {
      if (!enabled) {
        throw Object.assign(
          new Error('El envío de correo no está configurado.'),
          { status: 503 }
        )
      }

      if (purpose === 'visit') {
        const subject = String(noticeSubject || 'Tu visita en CasaFast')
        const text = String(noticeText || '')
        const { html } = renderVisitEmail({ name, subject, text, visit, appUrl: base.href, logoSrc })
        return deliver({ email, subject, html, text, notificationId })
      }

      // Avisos de documentación y publicaciones (vendedor y administración).
      if (purpose === 'notice') {
        const subject = String(noticeSubject || 'Aviso de CasaFast')
        const text = String(noticeText || '')
        const n = notice || {}
        let cta = null
        if (n.cta?.label) {
          const link = new URL(base.href)
          link.search = n.cta.query || ''
          link.hash = ''
          cta = { href: link.href, label: n.cta.label }
        }
        const html = emailLayout({
          subject, logoSrc, name,
          tone: n.tone, icon: n.icon, badge: n.badge,
          heading: n.heading || subject,
          intro: n.intro || text,
          details: n.details, notes: n.notes,
          preheader: n.preheader || n.intro,
          cta, ctaHint: n.ctaHint,
          footer: n.footer
        })
        return deliver({ email, subject, html, text, notificationId })
      }

      const verify = purpose === 'verify'

      const title = verify
        ? 'Confirma tu correo electrónico'
        : 'Restablece tu contraseña'

      const subject = verify
        ? 'Confirma tu correo en CasaFast'
        : 'Restablece tu contraseña de CasaFast'

      const description = verify
        ? '¡Qué gusto tenerte aquí! Solo falta confirmar tu correo para que puedas guardar favoritos, agendar visitas y publicar tus propiedades.'
        : 'Recibimos una solicitud para cambiar tu contraseña. Usa el botón para crear una nueva; solo te tomará un momento.'

      const action = verify
        ? 'Verificar mi correo'
        : 'Crear nueva contraseña'

      const duration = verify ? '24 horas' : '30 minutos'

      const link = new URL(base.href)
      link.hash = `${verify ? 'verify' : 'reset'}=${token}`

      const text = [
        'CasaFast',
        '',
        `Hola, ${name}.`,
        '',
        description,
        '',
        `${action}: ${link.href}`,
        '',
        `Este enlace vence en ${duration} y solo puede utilizarse una vez.`,
        '',
        'Si no solicitaste esta acción, ignora este mensaje.',
        '',
        'CasaFast · Un espacio para cada nuevo comienzo.'
      ].join('\n')

      const html = emailLayout({
        subject, logoSrc, name,
        tone: verify ? 'success' : 'info',
        icon: verify ? '✉️' : '🔑',
        badge: verify ? 'Bienvenida' : 'Seguridad de tu cuenta',
        heading: title,
        intro: description,
        cta: { href: link.href, label: action },
        ctaHint: `Este enlace vence en ${duration} y solo puede utilizarse una vez.`,
        notes: ['Si no solicitaste esta acción, puedes ignorar este mensaje con tranquilidad.', `¿El botón no funciona? Copia este enlace en tu navegador: ${link.href}`],
        footer: 'Recibes este correo por una acción en tu cuenta de CasaFast.'
      })

      return deliver({ email, subject, html, text })
    }
  }
}
