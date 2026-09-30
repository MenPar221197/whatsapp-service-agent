'use strict';

// Pure conversation logic. No network calls, tokens or business-specific content.
const normalizeText = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const canonicalPhone = value => String(value ?? '').replace(/^whatsapp:/i, '')
  .replace(/\D/g, '').replace(/^521(\d{10})$/, '52$1');
const parseJson = value => { try { return JSON.parse(value); } catch { return null; } };

function localDate(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now));
  const get = key => parts.find(part => part.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function extractDate(value, now, timeZone = 'UTC') {
  const text = normalizeText(value);
  const today = localDate(now, timeZone);
  const day = new Date(`${today}T12:00:00Z`);
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let candidate = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  if (!candidate) {
    match = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (match) candidate = `${match[3] || today.slice(0, 4)}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  if (candidate) {
    const parsed = new Date(`${candidate}T12:00:00Z`);
    return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === candidate && candidate >= today ? candidate : '';
  }
  if (text === 'hoy') return today;
  if (text === 'manana' || text === 'pasado manana') {
    day.setUTCDate(day.getUTCDate() + (text === 'manana' ? 1 : 2));
    return day.toISOString().slice(0, 10);
  }
  const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const index = days.indexOf(text.replace(/^(proximo|siguiente)\s+/, ''));
  if (index < 0) return '';
  let delta = (index - day.getUTCDay() + 7) % 7;
  if (!delta && /^(proximo|siguiente)\s/.test(text)) delta = 7;
  day.setUTCDate(day.getUTCDate() + delta);
  return day.toISOString().slice(0, 10);
}

function extractTime(value) {
  const match = normalizeText(value).match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (!match) return '';
  let hour = +match[1];
  if (+match[2] > 59 || hour > 23 || (match[3] && (hour < 1 || hour > 12))) return '';
  if (match[3]) hour = hour % 12 + (match[3] === 'pm' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function createFolio(id, prefix = 'REQ') {
  // Compact reference only: the persistence key retains the full provider event ID.
  let hash = 14695981039346656037n;
  for (const char of String(id)) {
    hash ^= BigInt(char.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return `${prefix.replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'REQ'}-${hash.toString(16).padStart(16, '0').toUpperCase()}`;
}

function requestSummary(intent, data, config, hideSensitive = false) {
  const form = config.forms[intent];
  const lines = [`Solicitud de ${form?.title || intent}:`];
  for (const field of form?.fields || []) {
    if (hideSensitive && field.sensitive) continue;
    const value = data[field.key];
    if (value === undefined || value === '') continue;
    lines.push(`${field.label}: ${Array.isArray(value) ? `${value.length} referencia(s), pendientes de revisión` : value}`);
  }
  return lines.join('\n');
}

function mainMenu(config) {
  const forms = Object.values(config.forms).map((form, index) => `${index + 4}. ${form.title}`);
  return `Soy el asistente de ${config.businessName}. ¿En qué puedo ayudarte?\n` +
    ['1. Catálogo', '2. Horarios', '3. Ubicación', ...forms].join('\n') +
    '\nTambién puedes escribir estado, inicio o asesor.';
}

function acceptField(field, input, session, config, now) {
  const text = String(input.text ?? '').trim();
  const normalized = normalizeText(text);
  let value;
  switch (field.type) {
    case 'name':
      if (/^[\p{L}][\p{L}\p{M} .'-]{1,79}$/u.test(text)) value = text.replace(/^(me llamo|mi nombre es)\s+/i, '').trim();
      break;
    case 'date': value = extractDate(text, now, config.timeZone); break;
    case 'time': value = extractTime(text); break;
    case 'choice': value = (field.options || []).find(option => normalizeText(option) === normalized); break;
    case 'number':
      if (/^\d+$/.test(text) && +text >= (field.min ?? 1) && +text <= (field.max ?? 100000)) value = +text;
      break;
    case 'email':
      if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(text) && text.length <= 254) value = text;
      break;
    case 'rfc':
      if (/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(text)) value = text.toUpperCase();
      break;
    case 'documents': {
      const accepted = (input.media || []).filter(media => media.id && /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(media.contentType));
      const existing = session.data[field.key] || [];
      session.data[field.key] = [...existing, ...accepted.filter(media => !existing.some(old => old.id === media.id))].slice(0, 10);
      if (/^(listo|terminado|ya envie todo)$/.test(normalized) && session.data[field.key].length) {
        session.completedDocuments = true;
        value = session.data[field.key];
      }
      break;
    }
    case 'text':
      if (text.length >= 2 && text.length <= (field.maxLength || 1000)) value = text;
      break;
    default: throw new Error(`Tipo de campo no soportado: ${field.type}`);
  }
  if (value === undefined || value === '') return false;
  session.data[field.key] = value;
  return true;
}

function conversation(input, rows = [], config = {}, now = new Date().toISOString()) {
  if (!config.businessName || !config.forms || !Object.keys(config.forms).length) throw new Error('Configura el negocio y al menos un formulario.');
  const text = normalizeText(input.text);
  const ownRows = rows.filter(row => canonicalPhone(row.Telefono) === canonicalPhone(input.phone));
  const latestFirst = list => [...list].sort((a, b) => String(b.Fecha).localeCompare(String(a.Fecha)));
  const saved = latestFirst(ownRows.filter(row => row.Intencion === '_sesion'))[0];
  let session = parseJson(saved?.Mensaje);
  const fresh = seen => ({ version: 3, intent: '', stage: 'inicio', data: {}, seen, awaiting: '' });
  if (!session || session.version !== 3 || !session.data || typeof session.data !== 'object' || Array.isArray(session.data) ||
      !['inicio', 'datos', 'confirmar', 'pendiente'].includes(session.stage) || (session.intent && !config.forms[session.intent])) session = fresh([]);
  session = JSON.parse(JSON.stringify(session));
  session.seen = Array.isArray(session.seen) ? session.seen.slice(-80) : [];
  let reply = '', request = null, notifications = [];
  const finish = () => {
    session.updatedAt = now;
    session.seen = [...new Set([...session.seen, input.eventId].filter(Boolean))].slice(-80);
    session.lastReply = reply;
    return {
      phone: input.phone, customerName: session.data.nombre || input.profileName || 'Cliente',
      intent: session.intent || 'general', reply, sessionJson: JSON.stringify(session), processedAt: now,
      saveRequest: !!request, requiresHuman: !!request?.requiereIntervencionHumana, request,
      requestKey: request ? `${request.tipo}:${request.id}` : '', requestJson: request ? JSON.stringify(request) : '',
      requestPhone: request?.telefono || input.phone, requestCustomerName: request?.datos?.nombre || input.profileName || 'Cliente',
      requestState: request?.estado || '', notifications,
    };
  };
  if (!input.valid) { reply = input.ignoredReply || ''; return finish(); }
  if (input.eventId && session.seen.includes(input.eventId)) return finish();
  if (input.fallbackReply) { reply = input.fallbackReply; return finish(); }
  if (/^(panel|pendientes|aprobar|rechazar)(\s|$)/.test(text)) {
    const authorized = input.isManager && config.managerPhone && canonicalPhone(input.phone) === canonicalPhone(config.managerPhone);
    if (!authorized) { reply = 'Este comando solo está disponible para la persona autorizada.'; return finish(); }
    const requests = latestFirst(rows.filter(row => row.Intencion && row.Intencion !== '_sesion'))
      .map(row => ({ row, value: parseJson(row.Mensaje) })).filter(item => item.value?.folio && item.value?.telefono);
    if (/^(panel|pendientes)$/.test(text)) {
      const pending = requests.filter(item => item.row.Estado === 'Pendiente');
      reply = `PANEL\nSolicitudes pendientes: ${pending.length}\n` + pending.slice(0, 10).map(item =>
        `${item.value.folio} | ${item.value.tipo} | ${item.value.datos?.nombre || 'Cliente'}`).join('\n') +
        '\nComandos: aprobar FOLIO; rechazar FOLIO motivo.';
    } else {
      const match = String(input.text).trim().match(/^(aprobar|rechazar)\s+([A-Z0-9]+-[A-F0-9]{16})(?:\s+([\s\S]+))?$/i);
      const found = match && requests.find(item => item.value.folio.toUpperCase() === match[2].toUpperCase());
      if (!match) reply = 'Usa aprobar FOLIO o rechazar FOLIO motivo.';
      else if (!found) reply = 'No encontré ese folio. Escribe pendientes para consultar la lista.';
      else if (found.row.Estado !== 'Pendiente') reply = `La solicitud ${found.value.folio} ya está en estado ${found.row.Estado}.`;
      else if (normalizeText(match[1]) === 'rechazar' && !match[3]?.trim()) reply = 'Incluye el motivo del rechazo; se compartirá con el cliente.';
      else {
        const reason = (match[3] || '').trim().slice(0, 500);
        request = { ...found.value, estado: normalizeText(match[1]) === 'aprobar' ? 'Confirmado' : 'Rechazado',
          decidedAt: now, decidedBy: config.managerPhone, decisionMessageId: input.eventId,
          motivo: reason, requiereIntervencionHumana: false };
        reply = `Solicitud ${request.folio}: ${request.estado}. La decisión se guardará antes de enviar el aviso.`;
        notifications.push({ to: request.telefono, body: `${config.businessName}\nSolicitud ${request.folio}: ${request.estado}.` +
          (reason ? `\nMotivo: ${reason}` : '') +
          (request.tipo === 'facturacion' ? '\nSe refiere a la recepción de la solicitud; no significa que la factura esté emitida.' : '') +
          '\nPara aclaraciones escribe asesor.' });
      }
    }
    return finish();
  }
  if (session.updatedAt && Date.parse(now) - Date.parse(session.updatedAt) > (config.sessionTtlHours || 24) * 3600000) session = fresh(session.seen);
  if (/^(inicio|reiniciar|cancelar|salir)$/.test(text)) {
    const submitted = session.stage === 'pendiente';
    session = fresh(session.seen);
    reply = (submitted ? 'Reinicié la conversación. Una solicitud enviada sigue registrada; escribe asesor para solicitar su cancelación.\n\n' : '') + mainMenu(config);
    return finish();
  }
  if (/^(estado|estatus|seguimiento)$/.test(text)) {
    const latest = latestFirst(ownRows.filter(row => row.Intencion !== '_sesion' && parseJson(row.Mensaje)?.folio))[0];
    reply = latest ? `Solicitud ${parseJson(latest.Mensaje).folio}: ${latest.Estado || 'Pendiente'}.` +
      (latest.Estado === 'Pendiente' ? ' Aún requiere revisión humana.' : '') : 'No encuentro una solicitud enviada para este número.';
    return finish();
  }
  const navigating = session.stage !== 'datos' || !session.awaiting;
  if (/^(catalogo|productos|precios)$/.test(text) || (navigating && text === '1')) {
    reply = config.catalog?.length ? config.catalog.map(product => `${product.name}: ${product.price} ${product.currency || 'MXN'}`).join('\n') +
      '\nPrecio final y disponibilidad sujetos a revisión humana.' : config.catalogUrl ? `Consulta el catálogo: ${config.catalogUrl}` : 'El catálogo está pendiente de configurar. Escribe asesor para consultarlo.';
    return finish();
  }
  if (/^(horario|horarios)$/.test(text) || (navigating && text === '2')) {
    reply = config.hours || 'El horario está pendiente de configurar. Escribe asesor para consultarlo.';
    return finish();
  }
  if (/^(ubicacion|direccion|maps)$/.test(text) || (navigating && text === '3')) {
    reply = [config.address, config.mapsUrl].filter(Boolean).join('\n') || 'La ubicación está pendiente de configurar. Escribe asesor para consultarla.';
    return finish();
  }
  const intents = Object.keys(config.forms);
  const selected = intents.find((key, index) => config.forms[key].aliases.some(alias => normalizeText(alias) === text) || (navigating && text === String(index + 4)));
  if (selected) {
    session = { ...fresh(session.seen), intent: selected, stage: 'datos', startedAt: now, awaiting: config.forms[selected].fields[0].key };
    reply = config.forms[selected].fields[0].question;
    return finish();
  }
  if (!session.intent) { reply = mainMenu(config); return finish(); }
  if (session.stage === 'pendiente') {
    reply = `Tu solicitud ${session.lastFolio} está registrada. Escribe estado o inicio.`;
    return finish();
  }
  const form = config.forms[session.intent];
  if (session.stage === 'confirmar') {
    if (/^(si|confirmo|confirmar|enviar|correcto)$/.test(text)) {
      const id = input.eventId;
      if (!id) throw new Error('Falta el ID del mensaje entrante; no se guardó la solicitud.');
      request = { version: 3, id, folio: createFolio(id, config.folioPrefix), tipo: session.intent,
        telefono: input.phone, datos: { ...session.data }, estado: 'Pendiente', createdAt: now,
        requiereIntervencionHumana: true, avisoEncargado: config.managerPhone ? 'preparado_entrega_no_verificada' : 'sin_configurar' };
      session.stage = 'pendiente'; session.lastFolio = request.folio; session.awaiting = '';
      reply = `Solicitud ${request.folio} registrada como PENDIENTE. La disponibilidad y el precio requieren revisión humana. Escribe estado para consultar el seguimiento.`;
      if (config.managerPhone) notifications.push({ to: config.managerPhone,
        body: `${config.businessName}\nNueva solicitud PENDIENTE\nFolio: ${request.folio}\n` +
          requestSummary(request.tipo, request.datos, config, true) + `\n\naprobar ${request.folio}\nrechazar ${request.folio} motivo` });
    } else if (/^(no|corregir|cambiar)$/.test(text)) {
      session = { ...fresh(session.seen), intent: session.intent, stage: 'datos', startedAt: now, awaiting: form.fields[0].key };
      reply = form.fields[0].question;
    } else reply = requestSummary(session.intent, session.data, config) + '\nResponde sí, corregir o cancelar.';
    return finish();
  }
  const field = form.fields.find(candidate => candidate.key === session.awaiting);
  if (!field) throw new Error('La sesión no coincide con los campos configurados. Reinicia la conversación.');
  if (!acceptField(field, input, session, config, now)) {
    reply = field.type === 'documents' && session.data[field.key]?.length ?
      `Referencias recibidas: ${session.data[field.key].length}. Al terminar escribe listo; los documentos requieren revisión humana.` : field.question;
    return finish();
  }
  const next = form.fields[form.fields.indexOf(field) + 1];
  session.awaiting = next?.key || '';
  if (next) reply = next.question;
  else {
    session.stage = 'confirmar';
    reply = requestSummary(session.intent, session.data, config) + '\n¿Los datos son correctos? Responde sí para enviar, corregir o cancelar.';
  }
  return finish();
}

// EXPORTS: removed when embedding this module in the n8n Code node.
module.exports = { conversation, extractDate, extractTime, createFolio, canonicalPhone };
