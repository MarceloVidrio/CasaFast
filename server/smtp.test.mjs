import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sendSmtp, buildMessage } from './smtp.mjs'
import { createMailer } from './email.mjs'

// Servidor SMTP simulado: responde como Gmail y guarda lo recibido.
function fakeSmtp({ password = 'abcdabcdabcdabcd' } = {}) {
  const received = []
  const server = net.createServer(socket => {
    let stage = 'cmd', data = '', session = { auth: [] }
    socket.write('220 smtp.prueba ESMTP\r\n')
    socket.on('data', chunk => {
      for (const line of chunk.toString().split('\r\n')) {
        if (stage === 'data') {
          if (line === '.') { stage = 'cmd'; received.push({ ...session, data }); socket.write('250 2.0.0 OK enviado\r\n'); continue }
          data += line + '\r\n'; continue
        }
        if (!line) continue
        if (stage === 'user') { session.user = Buffer.from(line, 'base64').toString(); stage = 'pass'; socket.write('334 UGFzc3dvcmQ6\r\n'); continue }
        if (stage === 'pass') { stage = 'cmd'; Buffer.from(line, 'base64').toString() === password ? socket.write('235 2.7.0 Accepted\r\n') : socket.write('535 5.7.8 Username and Password not accepted\r\n'); continue }
        if (line.startsWith('EHLO')) socket.write('250-smtp.prueba\r\n250-AUTH LOGIN PLAIN\r\n250 SMTPUTF8\r\n')
        else if (line === 'AUTH LOGIN') { stage = 'user'; socket.write('334 VXNlcm5hbWU6\r\n') }
        else if (line.startsWith('MAIL FROM')) { session.from = line; socket.write('250 OK\r\n') }
        else if (line.startsWith('RCPT TO')) { session.to = line; socket.write('250 OK\r\n') }
        else if (line === 'DATA') { stage = 'data'; data = ''; socket.write('354 Go ahead\r\n') }
        else if (line === 'QUIT') { socket.write('221 Bye\r\n'); socket.end() }
      }
    })
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, received })))
}

test('SMTP: inicia sesión y entrega un correo con acentos, emojis y versión HTML', async () => {
  const s = await fakeSmtp()
  try {
    const reply = await sendSmtp({ host: '127.0.0.1', port: s.port, secure: false, user: 'casafast@gmail.com', pass: 'abcdabcdabcdabcd', from: 'CasaFast <casafast@gmail.com>', to: 'Vendedor <vendedor@example.com>', subject: 'Visita confirmada · Culiacán 🏡', text: 'Hola ñandú\n.línea con punto', html: '<p>Hola</p>' })
    assert.match(reply, /250/)
    const m = s.received[0]
    assert.equal(m.user, 'casafast@gmail.com')
    assert.equal(m.to, 'RCPT TO:<vendedor@example.com>')
    assert.match(m.data, /Subject: =\?UTF-8\?B\?/)
    assert.match(m.data, /multipart\/alternative/)
    const parts = [...m.data.matchAll(/base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map(x => Buffer.from(x[1].replace(/\s/g, ''), 'base64').toString())
    assert.equal(parts[0], 'Hola ñandú\n.línea con punto'); assert.equal(parts[1], '<p>Hola</p>')
  } finally { s.server.close() }
})

test('SMTP: contraseña incorrecta da un motivo claro en el aviso', async () => {
  const s = await fakeSmtp({ password: 'otra' })
  try {
    const mailer = createMailer({ EMAIL_MODE: 'smtp', APP_URL: 'http://localhost:5173', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(s.port), SMTP_SECURE: 'false', SMTP_USER: 'casafast@gmail.com', SMTP_PASS: 'abcd abcd abcd abcd' }, mkdtempSync(join(tmpdir(), 'cf-smtp-')))
    assert.equal(mailer.enabled, true)
    await assert.rejects(mailer.send({ email: 'x@example.com', name: 'X', purpose: 'visit', subject: 'Prueba', text: 'Hola' }), e => /contraseña de aplicación/.test(e.publicMessage))
  } finally { s.server.close() }
})

test('SMTP desde el mailer de CasaFast: los espacios de la contraseña de Google se ignoran', async () => {
  const s = await fakeSmtp()
  try {
    const mailer = createMailer({ EMAIL_MODE: 'smtp', APP_URL: 'http://localhost:5173', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(s.port), SMTP_SECURE: 'false', SMTP_USER: 'casafast@gmail.com', SMTP_PASS: 'abcd abcd abcd abcd' }, mkdtempSync(join(tmpdir(), 'cf-smtp-')))
    await mailer.send({ email: 'alfredo@example.com', name: 'Alfredo', purpose: 'visit', subject: 'Visita confirmada', text: 'CasaFast\nVisita confirmada' })
    assert.equal(s.received.length, 1); assert.equal(s.received[0].to, 'RCPT TO:<alfredo@example.com>')
    assert.match(buildMessage({ from: 'CasaFast <a@b.c>', to: 'x@y.z', subject: 'Hola', text: 't', html: 'h' }), /From: CasaFast <a@b.c>/)
  } finally { s.server.close() }
})

test('Correos con logo: el aviso lleva la imagen incrustada (cid), diseño amable y remitente limpio', async () => {
  const s = await fakeSmtp()
  try {
    const mailer = createMailer({ EMAIL_MODE: 'smtp', APP_URL: 'http://localhost:5173', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(s.port), SMTP_SECURE: 'false', SMTP_USER: 'casafast@gmail.com', SMTP_PASS: 'abcdabcdabcdabcd', EMAIL_FROM_NAME: 'CasaFastEMAIL_FROM=CasaFast' }, mkdtempSync(join(tmpdir(), 'cf-smtp-')))
    await mailer.send({ email: 'v@example.com', name: 'Alfredo Vidrio', purpose: 'notice', subject: 'Recibimos tu documentación', text: 'texto', notice: { tone: 'info', icon: '📄', badge: 'En revisión', heading: '¡Gracias! Ya tenemos tus documentos', details: [['Folio', 'PUB-1234ABCD']], cta: { label: 'Ir a mis publicaciones', query: '?panel' } } })
    const raw = s.received[0].data
    assert.match(raw, /From: CasaFast <casafast@gmail.com>/)
    assert.match(raw, /multipart\/related/); assert.match(raw, /Content-ID: <casafast-logo>/)
    const htmlB64 = raw.split('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0]
    const html = Buffer.from(htmlB64.replace(/\r\n/g, ''), 'base64').toString('utf8')
    assert.ok(html.includes('src="cid:casafast-logo"')); assert.ok(html.includes('Hola, <strong>Alfredo</strong>'))
    assert.ok(html.includes('PUB-1234ABCD')); assert.ok(html.includes('href="http://localhost:5173/?panel"'))
  } finally { s.server.close() }
})
