import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMailer } from './email.mjs'
import { createMetaWhatsApp } from './whatsapp-meta.mjs'

export function createVisitNotifications(db, { env, dataDir, mailer, request = fetch }) {
  const email = mailer || createMailer(env, dataDir)
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(env.APP_URL || '') && env.NODE_ENV !== 'production'
  const mode = env.WHATSAPP_MODE || 'disabled'
  const meta = createMetaWhatsApp(env, request)
  const whatsappEnabled = mode === 'preview' ? local : mode === 'meta' ? meta.enabled : mode === 'twilio' &&
    /^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID || '') && !!env.TWILIO_AUTH_TOKEN &&
    /^\+[1-9]\d{7,14}$/.test(env.TWILIO_WHATSAPP_FROM || '') && /^HX[a-f0-9]{32}$/i.test(env.TWILIO_VISIT_CONTENT_SID || '')
  db.exec(`CREATE TABLE IF NOT EXISTS visit_notifications (
    id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, channel TEXT NOT NULL,
    event TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
    provider_id TEXT, error TEXT, created TEXT NOT NULL
  )`)
  let flushing = false
  async function flush() {
    if (flushing) return
    flushing = true
    try {
      const jobs = db.prepare("SELECT * FROM visit_notifications WHERE state IN ('pending','failed') AND attempts<3 AND next_attempt<=? ORDER BY created LIMIT 30").all(Date.now())
      for (const job of jobs) {
        const payload = JSON.parse(job.payload)
        // A failed confirmation must never be retried after the appointment changed.
        const current = db.prepare('SELECT status,revision FROM appointments WHERE id=?').get(job.appointment_id)
        if (!current || current.revision !== payload.revision) {
          db.prepare("UPDATE visit_notifications SET state='superseded' WHERE id=?").run(job.id)
          continue
        }
        const enabled = job.channel === 'email' ? email.enabled : whatsappEnabled
        if (!enabled) {
          db.prepare("UPDATE visit_notifications SET state='disabled',error='Servicio sin configurar' WHERE id=?").run(job.id)
          continue
        }
        db.prepare("UPDATE visit_notifications SET state='sending',attempts=attempts+1 WHERE id=?").run(job.id)
        try {
          let providerId = null
          let state = 'submitted'
          if (job.channel === 'email') {
            await email.send({ purpose: 'visit', email: payload.email, name: payload.name, subject: payload.subject, text: payload.text, visit: payload.visit, notificationId: job.id })
            if (email.mode === 'preview') state = 'preview'
          } else if (mode === 'preview') {
            const directory = join(dataDir, 'whatsapp-preview')
            mkdirSync(directory, { recursive: true })
            writeFileSync(join(directory, `${job.id}.txt`), `Vista previa local. NO se envió WhatsApp.\nPara: ${payload.phone}\n\n${payload.text}`, { mode: 0o600 })
            state = 'preview'
          } else if (mode === 'meta') {
            providerId = await meta.send(payload)
          } else {
            const form = new URLSearchParams({
              To: `whatsapp:${payload.phone}`, From: `whatsapp:${env.TWILIO_WHATSAPP_FROM}`,
              ContentSid: env.TWILIO_VISIT_CONTENT_SID,
              ContentVariables: JSON.stringify({ '1': payload.name, '2': payload.subject, '3': payload.title, '4': payload.when, '5': payload.address || payload.addressHint || 'Consulta los detalles en CasaFast', '6': payload.mapUrl || payload.mapHint || 'Consulta CasaFast' })
            })
            const result = await request(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
              method: 'POST', signal: AbortSignal.timeout(15000),
              headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString()
            })
            if (!result.ok) throw new Error('No se pudo enviar el aviso de WhatsApp.')
            const response = await result.json()
            if (!response.sid) throw new Error('Respuesta inválida del servicio de WhatsApp.')
            providerId = response.sid
          }
          db.prepare('UPDATE visit_notifications SET state=?,provider_id=?,error=NULL WHERE id=?').run(state, providerId, job.id)
        } catch (error) {
          db.prepare("UPDATE visit_notifications SET state='failed',error=?,next_attempt=? WHERE id=?").run(error.publicMessage || 'No se pudo enviar. Puedes reintentar desde Mis visitas.', Date.now() + 60000, job.id)
        }
      }
    } finally { flushing = false }
  }
  // An interrupted outbound request has an unknown outcome: do not resend it automatically.
  db.prepare("UPDATE visit_notifications SET state='unknown',error='Envío interrumpido; revisa antes de reintentar.' WHERE state='sending'").run()
  return {
    config: { whatsappEnabled: !!whatsappEnabled, whatsappMode: whatsappEnabled ? mode : 'disabled' },
    flush,
    list(appointmentId, userId) {
      return db.prepare('SELECT id,channel,event,state,error FROM visit_notifications WHERE appointment_id=? AND user_id=? ORDER BY created DESC').all(appointmentId, userId)
    },
    retry(id, userId) {
      const job = db.prepare('SELECT * FROM visit_notifications WHERE id=? AND user_id=?').get(id, userId)
      if (!job || !['failed', 'disabled'].includes(job.state)) throw Object.assign(new Error('Este aviso no se puede reintentar.'), { status: 409 })
      db.prepare("UPDATE visit_notifications SET state='pending',attempts=0,next_attempt=0 WHERE id=?").run(id)
    }
  }
}
