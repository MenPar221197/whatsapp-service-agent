'use strict';

function splitText(value, max = 3500) {
  let rest = String(value ?? '').trim();
  const parts = [];
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    if (/[\uD800-\uDBFF]/.test(rest.charAt(cut - 1))) cut--;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function prepareOutbound(result, input) {
  const digits = value => String(value ?? '').replace(/^whatsapp:/i, '').replace(/\D/g, '');
  const canonical = value => digits(value).replace(/^521(\d{10})$/, '52$1');
  const messages = [{ to: input.metaRecipient, body: result.reply, purpose: 'respuesta' },
    ...(result.notifications || []).map(notification => ({ to: digits(notification.to), body: notification.body, purpose: 'aviso' }))];
  const items = [];
  for (const message of messages) {
    if (!String(message.body ?? '').trim()) continue;
    if (!/^[1-9]\d{6,14}$/.test(message.to)) throw new Error('Destinatario inválido.');
    if (canonical(message.to) === canonical(input.businessPhone)) throw new Error('Se bloqueó un intento de autoenvío al número del bot.');
    for (const text of splitText(message.body)) items.push({ json: { skipSend: false,
      phoneNumberId: input.phoneNumberId, to: message.to, text, purpose: message.purpose,
      inboundMessageId: input.eventId }, pairedItem: { item: 0 } });
  }
  return items.length ? items : [{ json: { skipSend: true }, pairedItem: { item: 0 } }];
}

// EXPORTS: removed when embedding this module in the n8n Code node.
module.exports = { prepareOutbound, splitText };
