// API de Conversões da Meta (somente servidor).
// O token vem de META_CAPI_TOKEN e o pixel de META_PIXEL_ID (variáveis de ambiente).
// Nunca importe este arquivo no front-end.
const crypto = require('node:crypto');

const GRAPH_VERSION = 'v21.0';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Minúsculo e sem espaços, depois SHA-256. Vazio vira undefined (campo não enviado).
function hashNormalized(value) {
  if (value === undefined || value === null) return undefined;
  const clean = String(value).trim().toLowerCase().replace(/\s+/g, '');
  return clean ? sha256(clean) : undefined;
}

// Telefone: só dígitos, com 55 na frente.
function hashPhone(value) {
  if (!value) return undefined;
  let digits = String(value).replace(/\D/g, '');
  if (!digits) return undefined;
  if (!digits.startsWith('55')) digits = '55' + digits;
  return sha256(digits);
}

// CEP: só dígitos.
function hashZip(value) {
  if (!value) return undefined;
  const digits = String(value).replace(/\D/g, '');
  return digits ? sha256(digits) : undefined;
}

function clean(object) {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

/**
 * Envia um evento para a API de Conversões.
 * Nunca lança erro: uma falha da Meta não pode quebrar a página nem o checkout.
 *
 * @param {object} event
 * @param {string} event.eventName       ex.: 'ViewContent', 'InitiateCheckout', 'Purchase'
 * @param {string} event.eventId         o MESMO eventID usado no fbq do navegador
 * @param {string} [event.eventSourceUrl]
 * @param {number} [event.eventTime]     em segundos (padrão: agora)
 * @param {object} [event.user]          { ip, userAgent, fbp, fbc, email, phone, firstName, lastName, city, state, zip, externalId }
 * @param {object} [event.custom]        { value, numItems, contentName }
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
async function sendMetaEvent({ eventName, eventId, eventSourceUrl, eventTime, user = {}, custom = {} }) {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) {
    console.error('[Meta CAPI] META_PIXEL_ID ou META_CAPI_TOKEN não configurado.');
    return { ok: false, error: 'missing_env' };
  }

  const userData = clean({
    client_ip_address: user.ip,
    client_user_agent: user.userAgent,
    fbp: user.fbp,
    fbc: user.fbc,
    em: hashNormalized(user.email),
    ph: hashPhone(user.phone),
    fn: hashNormalized(user.firstName),
    ln: hashNormalized(user.lastName),
    ct: hashNormalized(user.city),
    st: hashNormalized(user.state),
    zp: hashZip(user.zip),
    country: sha256('br'),
    external_id: hashNormalized(user.externalId),
  });

  const customData = clean({
    currency: 'BRL',
    value: typeof custom.value === 'number' ? Number(custom.value.toFixed(2)) : undefined,
    num_items: custom.numItems,
    content_name: custom.contentName,
  });

  const body = {
    data: [clean({
      event_name: eventName,
      event_time: eventTime || Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: eventSourceUrl,
      user_data: userData,
      custom_data: customData,
    })],
  };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) {
      // Loga só o motivo; nunca o token.
      console.error('[Meta CAPI] Evento recusado', { eventName, eventId, status: response.status, error: result.error && result.error.message });
      return { ok: false, status: response.status, error: result.error && result.error.message };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    console.error('[Meta CAPI] Falha de rede', { eventName, eventId, error: error && error.message });
    return { ok: false, error: 'network' };
  }
}

module.exports = { sendMetaEvent, hashNormalized, hashPhone };
