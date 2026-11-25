// POST /api/meta/event — recebe o ViewContent da página de vendas e repassa
// para a API de Conversões com o MESMO eventID do pixel (deduplicação).
const { sendMetaEvent } = require('../../lib/metaCapi');

// Só eventos que a própria página de vendas dispara. Purchase nunca entra por aqui:
// ele precisa vir do pagamento aprovado, senão qualquer pessoa poderia forjar vendas.
const ALLOWED_EVENTS = new Set(['ViewContent']);

function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress;
}

function readCookie(header, name) {
  const match = String(header || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function shortString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const eventName = body.eventName;
  const eventId = shortString(body.eventId, 100);
  if (!ALLOWED_EVENTS.has(eventName) || !eventId) {
    return res.status(400).json({ ok: false, error: 'invalid_event' });
  }

  const value = Number(body.value);
  const result = await sendMetaEvent({
    eventName,
    eventId,
    eventSourceUrl: shortString(body.url, 2000) || req.headers.referer,
    user: {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      fbp: shortString(body.fbp, 200) || readCookie(req.headers.cookie, '_fbp'),
      fbc: shortString(body.fbc, 500) || readCookie(req.headers.cookie, '_fbc'),
    },
    custom: {
      value: Number.isFinite(value) && value > 0 && value < 10000 ? value : undefined,
      contentName: 'Kit Body Splash',
    },
  });

  // Sempre 200 para o navegador: falha da Meta fica só no log do servidor.
  return res.status(200).json({ ok: result.ok });
};
