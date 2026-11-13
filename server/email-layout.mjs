// Diseño común de los correos de CasaFast (visitas, documentación y cuenta).
// HTML con tablas y estilos en línea para que se vea bien en Gmail, Outlook y Apple Mail.

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const TONES = {
  success: { band: '#e7f1e1', chip: '#d5e8cb', ink: '#2f5a2a', icon: '#ffffff' },
  info: { band: '#edf2ea', chip: '#dfe9da', ink: '#2c4f3b', icon: '#ffffff' },
  warning: { band: '#fbf1df', chip: '#f4e2bf', ink: '#8a5a1f', icon: '#ffffff' },
  danger: { band: '#fbe9e5', chip: '#f4d3cc', ink: '#9b3f33', icon: '#ffffff' }
}

/**
 * @param {object} o
 * @param {string} o.subject
 * @param {string} [o.preheader]   texto de vista previa en la bandeja
 * @param {string} [o.logoSrc]     cid:… o data:… del logo; si falta se usa el nombre en texto
 * @param {'success'|'info'|'warning'|'danger'} [o.tone]
 * @param {string} [o.icon]        emoji del encabezado
 * @param {string} [o.badge]       etiqueta corta (estado)
 * @param {string} o.heading
 * @param {string} [o.name]        nombre para el saludo
 * @param {string} [o.intro]       párrafo principal (texto)
 * @param {Array<[string,string]>} [o.details]  filas etiqueta/valor (texto)
 * @param {{label:string,value:string,sub?:string}} [o.highlight]  dato grande (fecha y hora)
 * @param {string[]} [o.notes]     párrafos adicionales (texto)
 * @param {{href:string,label:string}} [o.cta]
 * @param {string} [o.ctaHint]
 * @param {{href:string,label:string}} [o.secondary]
 * @param {string} [o.footer]      motivo por el que recibe el correo
 */
export function emailLayout(o) {
  const t = TONES[o.tone] || TONES.info
  const logo = o.logoSrc
    ? `<img src="${esc(o.logoSrc)}" width="168" height="52" alt="CasaFast" style="display:block;border:0;outline:none;width:168px;height:auto">`
    : `<span style="font-size:26px;font-weight:800;letter-spacing:-1px;color:#234f3c">casa<span style="font-weight:400">fast</span><span style="color:#b0be79">.</span></span>`
  const details = (o.details || []).filter(([, v]) => v).map(([label, value], i) => `
      <tr><td style="padding:${i ? '12px' : '0'} 0 0;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#869181">${esc(label)}</td></tr>
      <tr><td style="padding:3px 0 0;font-size:15px;line-height:1.5;color:#22392c;font-weight:600">${esc(value)}</td></tr>`).join('')
  const box = (o.highlight || details) ? `
  <tr><td style="padding:22px 32px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8f3;border:1px solid #e6ece1;border-radius:14px">
      <tr><td style="padding:18px 20px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${o.highlight ? `<tr><td style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#869181">${esc(o.highlight.label)}</td></tr>
        <tr><td style="padding:4px 0 0;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-.5px;color:#1f3a2c">${esc(o.highlight.value)}</td></tr>
        ${o.highlight.sub ? `<tr><td style="padding:3px 0 ${details ? '14px' : '0'};font-size:12px;color:#7a8676">${esc(o.highlight.sub)}</td></tr>` : ''}
        ${details ? '<tr><td style="border-top:1px solid #e3e9de;padding:0;height:12px;line-height:12px;font-size:0">&nbsp;</td></tr>' : ''}` : ''}
        ${details}
        </table>
      </td></tr>
    </table>
  </td></tr>` : ''
  const notes = (o.notes || []).filter(Boolean).map(n => `<p style="margin:14px 0 0;font-size:14px;line-height:1.7;color:#5f6d62">${esc(n)}</p>`).join('')

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f5ef;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#22392c;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(o.preheader || o.heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5ef"><tr><td align="center" style="padding:28px 14px 36px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
  <tr><td style="padding:0 6px 18px">${logo}</td></tr>
  <tr><td style="background:#ffffff;border:1px solid #e3e8dd;border-radius:22px;overflow:hidden">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="background:${t.band};padding:28px 32px 26px;border-radius:22px 22px 0 0">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          ${o.icon ? `<td valign="middle" style="padding-right:14px"><div style="width:48px;height:48px;border-radius:14px;background:#ffffff;text-align:center;line-height:48px;font-size:24px">${o.icon}</div></td>` : ''}
          ${o.badge ? `<td valign="middle"><span style="display:inline-block;padding:6px 12px;border-radius:30px;background:${t.chip};color:${t.ink};font-size:12px;font-weight:700">${esc(o.badge)}</span></td>` : ''}
        </tr></table>
        <h1 style="margin:18px 0 0;font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-.6px;color:#1f3a2c">${esc(o.heading)}</h1>
      </td></tr>
      <tr><td style="padding:24px 32px 0">
        ${o.name ? `<p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#22392c">Hola, <strong>${esc(o.name.split(' ')[0])}</strong> 👋</p>` : ''}
        ${o.intro ? `<p style="margin:0;font-size:15px;line-height:1.7;color:#4f5e53">${esc(o.intro)}</p>` : ''}
      </td></tr>
      ${box}
      ${notes ? `<tr><td style="padding:4px 32px 0">${notes}</td></tr>` : ''}
      ${o.cta ? `<tr><td style="padding:26px 32px 0">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#28583f">
          <a href="${esc(o.cta.href)}" target="_blank" style="display:inline-block;padding:15px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;border-radius:12px">${esc(o.cta.label)} &rarr;</a>
        </td></tr></table>
        ${o.ctaHint ? `<p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#86917f">${esc(o.ctaHint)}</p>` : ''}
      </td></tr>` : ''}
      ${o.secondary ? `<tr><td style="padding:14px 32px 0"><a href="${esc(o.secondary.href)}" target="_blank" style="font-size:13px;font-weight:700;color:#28583f;text-decoration:none">${esc(o.secondary.label)} &rarr;</a></td></tr>` : ''}
      <tr><td style="padding:28px 32px 28px"><div style="border-top:1px solid #edf0e8;padding-top:16px;font-size:12px;line-height:1.6;color:#8b9485">¿Tienes dudas? Responde a este correo y con gusto te ayudamos.</div></td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:20px 10px 0;font-size:12px;line-height:1.7;color:#97a091">
    <strong style="color:#5f7a62">CasaFast</strong> · Un espacio para cada nuevo comienzo.<br>${esc(o.footer || 'Recibes este correo porque tienes una cuenta en CasaFast.')}
  </td></tr>
</table></td></tr></table></body></html>`
}
