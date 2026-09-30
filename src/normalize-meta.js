'use strict';

function normalizeMeta(items) {
  const digits = value => String(value ?? '').replace(/^whatsapp:/i, '').replace(/\D/g, '');
  const canonical = value => digits(value).replace(/^521(\d{10})$/, '52$1');
  const output = [];
  for (const [index, item] of items.entries()) {
    const value = item.json;
    const businessPhone = canonical(value.businessPhone);
    if (!/^[1-9]\d{6,14}$/.test(businessPhone)) throw new Error('Configura businessPhone con el número del negocio y código de país.');
    let config;
    try { config = JSON.parse(value.businessConfigJson); } catch { throw new Error('businessConfigJson debe contener JSON válido.'); }
    if (!config.businessName || !config.forms || !Object.keys(config.forms).length) throw new Error('Configura businessName y forms.');
    new Intl.DateTimeFormat('en', { timeZone: config.timeZone }).format();
    for (const form of Object.values(config.forms)) {
      if (!Array.isArray(form.aliases) || !Array.isArray(form.fields) || !form.fields.length) throw new Error('Cada formulario necesita aliases y fields.');
    }
    const phoneNumberId = String(value.metadata?.phone_number_id ?? '').trim();
    const displayedPhone = canonical(value.metadata?.display_phone_number);
    if (!displayedPhone || !/^\d+$/.test(phoneNumberId)) throw new Error('El evento de Meta no incluyó metadatos válidos del número.');
    if (displayedPhone !== businessPhone) continue;
    const manager = digits(value.managerPhone);
    if (manager && !/^[1-9]\d{6,14}$/.test(manager)) throw new Error('managerPhone debe incluir código de país o estar vacío.');
    if (manager && canonical(manager) === businessPhone) throw new Error('El número del responsable debe ser distinto al número del bot.');
    config.managerPhone = manager ? `whatsapp:+${manager}` : '';
    for (const status of value.statuses ?? []) {
      if (status.status === 'failed') throw new Error(`Meta notificó un fallo de entrega (${status.id || 'sin ID'}). Consulta los detalles en la ejecución.`);
    }
    for (const message of value.messages ?? []) {
      const from = digits(message.from);
      const eventId = String(message.id ?? '');
      if (!/^[1-9]\d{6,14}$/.test(from) || !eventId || eventId.length > 512 || canonical(from) === businessPhone) continue;
      const type = String(message.type ?? 'unknown');
      if (['reaction', 'system'].includes(type)) continue;
      let text = '';
      if (type === 'text') text = String(message.text?.body ?? '');
      if (type === 'button') text = String(message.button?.text ?? message.button?.payload ?? '');
      if (type === 'interactive') {
        const selected = message.interactive?.button_reply ?? message.interactive?.list_reply;
        text = String(selected?.title ?? selected?.id ?? '');
      }
      const attachment = ['image', 'document', 'audio', 'video', 'sticker'].includes(type) ? message[type] : null;
      const media = attachment?.id ? [{ id: String(attachment.id), provider: 'meta',
        contentType: String(attachment.mime_type ?? ''), filename: String(attachment.filename ?? '').slice(0, 255) }] : [];
      text = (text || attachment?.caption || '').trim();
      let fallbackReply = '';
      if (!['text', 'button', 'interactive', 'image', 'document'].includes(type)) fallbackReply = 'Por ahora necesito tus datos por escrito. Puedes escribir catálogo, pedido, cita, cotización o asesor.';
      else if (text.length > 4096) fallbackReply = 'Tu mensaje es muy largo. Envíalo en partes de menos de 4,000 caracteres.';
      else if (!text && !media.length) fallbackReply = 'No pude leer ese mensaje. Escribe tu solicitud en texto.';
      const profile = (value.contacts ?? []).find(contact => digits(contact.wa_id) === from);
      output.push({ json: { phone: `whatsapp:+${canonical(from)}`, metaRecipient: from, phoneNumberId, businessPhone,
        text: text.slice(0, 4096), eventId, messageType: type, isManager: !!manager && canonical(from) === canonical(manager),
        managerPhone: config.managerPhone, config, profileName: String(profile?.profile?.name ?? '').slice(0, 100),
        media, valid: true, fallbackReply }, pairedItem: { item: index } });
    }
  }
  return output;
}

// EXPORTS: removed when embedding this module in the n8n Code node.
module.exports = { normalizeMeta };
