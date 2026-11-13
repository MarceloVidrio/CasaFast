import tls from 'node:tls'
import net from 'node:net'
import { randomUUID } from 'node:crypto'

// Envío de correo por SMTP sin dependencias (por ejemplo, Gmail con contraseña de aplicación).
// Usa TLS directo (puerto 465). secure:false solo existe para las pruebas automáticas.

const b64 = text => Buffer.from(text, 'utf8').toString('base64')
const wrap = text => b64(text).replace(/.{1,76}/g, '$&\r\n').trimEnd()
const header = text => /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${b64(text)}?=`
const address = value => {
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(value || '')
  return (m ? m[1] : String(value || '').trim()).replace(/[\r\n<>]/g, '')
}
const displayName = value => { const m = /^\s*"?([^"<]*?)"?\s*</.exec(value || ''); return m ? m[1].trim() : '' }

// inline: imágenes incrustadas que el HTML usa como src="cid:<cid>" (por ejemplo, el logo).
export function buildMessage({ from, to, subject, text, html, inline = [], messageId = `${randomUUID()}@casafast` }) {
  const boundary = `casafast-${randomUUID()}`
  const related = `casafast-rel-${randomUUID()}`
  const name = displayName(from)
  const htmlPart = [
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(html || '')
  ]
  const clean = value => String(value).replace(/[^\w.@-]/g, '')
  const htmlBlock = inline.length ? [
    `Content-Type: multipart/related; boundary="${related}"`,
    '',
    `--${related}`,
    ...htmlPart,
    ...inline.flatMap(file => [
      `--${related}`,
      `Content-Type: ${/^image\/(png|jpeg|gif)$/.test(file.contentType) ? file.contentType : 'image/png'}; name="${clean(file.filename || 'imagen.png')}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${clean(file.cid)}>`,
      `Content-Disposition: inline; filename="${clean(file.filename || 'imagen.png')}"`,
      '',
      Buffer.from(file.content).toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd()
    ]),
    `--${related}--`
  ] : htmlPart
  return [
    `From: ${name ? `${header(name)} ` : ''}<${address(from)}>`,
    `To: <${address(to)}>`,
    `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(text || ''),
    `--${boundary}`,
    ...htmlBlock,
    `--${boundary}--`,
    ''
  ].join('\r\n')
}

export function sendSmtp({ host, port = 465, secure = true, user, pass, from, to, subject, text, html, inline, timeout = 20000 }) {
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port })
    socket.setTimeout(timeout)
    let buffer = '', waiting = null, finished = false
    const done = (error, value) => {
      if (finished) return
      finished = true
      socket.end(); socket.destroy()
      error ? reject(error) : resolve(value)
    }
    const failWith = (code, line) => done(Object.assign(new Error(`SMTP ${code}: ${line}`), { smtpCode: code }))
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      // Una respuesta termina cuando la última línea es «NNN texto» (sin guion).
      const lines = buffer.split('\r\n')
      const complete = lines.slice(0, -1)
      const last = complete.findLastIndex?.(l => /^\d{3} /.test(l)) ?? -1
      if (last === -1 || !waiting) return
      const reply = complete.slice(0, last + 1)
      buffer = lines.slice(last + 1).join('\r\n')
      const code = Number(reply.at(-1).slice(0, 3))
      const next = waiting; waiting = null
      next(code, reply.join('\n'))
    })
    socket.on('timeout', () => done(Object.assign(new Error('Tiempo de espera agotado con el servidor de correo.'), { smtpCode: 'timeout' })))
    socket.on('error', error => done(Object.assign(error, { smtpCode: 'network' })))

    const expect = (codes, then) => { waiting = (code, line) => codes.includes(code) ? then(code, line) : failWith(code, line) }
    const say = (command, codes, then) => { expect(codes, then); socket.write(`${command}\r\n`) }

    const message = buildMessage({ from, to, subject, text, html, inline })
      .split('\r\n').map(line => line.startsWith('.') ? `.${line}` : line).join('\r\n')

    expect([220], () =>
      say('EHLO casafast.local', [250], () =>
        say('AUTH LOGIN', [334], () =>
          say(b64(user), [334], () =>
            say(b64(pass), [235], () =>
              say(`MAIL FROM:<${address(from)}>`, [250], () =>
                say(`RCPT TO:<${address(to)}>`, [250, 251], () =>
                  say('DATA', [354], () => {
                    expect([250], (_code, line) => { socket.write('QUIT\r\n'); done(null, line) })
                    socket.write(`${message}\r\n.\r\n`)
                  }))))))))
  })
}

// Mensaje claro para «Mis visitas» y la consola, sin exponer contraseñas.
export function smtpPublicMessage(error) {
  const code = error?.smtpCode
  if (code === 535 || code === 534) return 'Gmail rechazó el inicio de sesión: revisa SMTP_USER y la contraseña de aplicación (16 letras, sin espacios).'
  if (code === 550 || code === 553) return 'El servidor de correo rechazó la dirección de destino.'
  if (code === 'timeout' || code === 'network') return 'No se pudo conectar con el servidor de correo. Revisa tu conexión a internet.'
  return 'No se pudo enviar el correo. Puedes reintentar desde Mis visitas.'
}
