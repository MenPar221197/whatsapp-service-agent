// Motor conversacional por reglas con estado persistente.
function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function canonicalPhone(phone) {
  return String(phone || '').replace(/^whatsapp:/, '').replace(/^\+521(\d{10})$/, '+52$1');
}

function conversation(input, rows = [], config = {}, now = new Date().toISOString()) {
  const message = normalizeText(input.text);
  const parse = value => { try { return JSON.parse(value); } catch { return null; } };
  const ownRows = rows.filter(r => canonicalPhone(r.Telefono) === canonicalPhone(input.phone));
  const saved = ownRows.filter(r => r.Intencion === '_sesion')
    .sort((a, b) => String(b.Fecha).localeCompare(String(a.Fecha)))[0];
  let session = parse(saved?.Mensaje);
  if (!session || typeof session !== 'object' || session.version !== 2) {
    session = { version: 2, intent: '', stage: 'inicio', data: {}, seen: [] };
  }
  session = JSON.parse(JSON.stringify(session));
  session.seen = Array.isArray(session.seen) ? session.seen : [];
  let reply = '', request = null, notifications = [];
  const finish = () => {
    session.updatedAt = now;
    if (input.eventId && !session.seen.includes(input.eventId)) {
      session.seen = [...session.seen, input.eventId].slice(-80);
    }
    session.lastReply = reply;
    return {
      phone: input.phone, customerName: session.data?.nombre || input.profileName || 'Cliente',
      intent: session.intent || 'general', reply,
      sessionJson: JSON.stringify(session), processedAt: now,
      saveRequest: !!request, requiresHuman: !!request, request,
      requestKey: request ? `${request.tipo}:${request.id}` : '',
      requestJson: request ? JSON.stringify(request) : '',
      requestPhone: request?.telefono || input.phone,
      requestCustomerName: request?.datos?.nombre || session.data?.nombre || input.profileName || 'Cliente',
      requestState: request?.estado || 'Pendiente',
      notifications,
    };
  };
  if (!input.valid) { reply = input.ignoredReply || ''; return finish(); }
  if (input.eventId && session.seen.includes(input.eventId)) {
    // Acknowledge Meta retries without re-creating a request or sending a second reply.
    const result = finish(); result.reply = ''; result.notifications = []; result.sessionJson = JSON.stringify(session); return result;
  }
  if (input.fallbackReply) { reply = input.fallbackReply; return finish(); }
  if (input.managerCommand) {
    const result = managerConversation(input, rows, config, now);
    const managerSession = JSON.parse(result.sessionJson);
    managerSession.seen = [...new Set([...session.seen, input.eventId].filter(Boolean))].slice(-80);
    managerSession.lastReply = result.reply;
    result.sessionJson = JSON.stringify(managerSession);
    return result;
  }
  if (session.updatedAt && Date.parse(now) - Date.parse(session.updatedAt) > 24 * 3600 * 1000) {
    session = { version: 2, intent: '', stage: 'inicio', data: {}, seen: session.seen };
  }
  const menu = `Soy el asistente de ${config.businessName || 'nuestro negocio'}. ¿En qué puedo ayudarte?\n` +
    '1. Menú\n2. Horarios\n3. Ubicación\n4. Pedido para recoger\n5. Reservación\n6. Evento o cotización\n7. Facturación\n' +
    'También puedes escribir estado, reiniciar o asesor.';
  const hours = config.hours || 'Consulta el horario con el encargado.';
  const navigationNumber = session.stage !== 'datos' || !session.awaiting;
  const start = intent => {
    session.intent = intent; session.stage = 'datos'; session.data = {};
    session.startedAt = now; session.awaiting = '';
  };
  if (/^(reiniciar|cancelar|salir|inicio)$/.test(message)) {
    const submitted = session.stage === 'pendiente';
    start('');
    reply = (submitted ? 'Reinicié la conversación. Esto NO cancela una solicitud ya enviada; escribe asesor para pedir su cancelación.\n\n' :
      'Listo, dejamos esta captura sin enviar.\n\n') + menu;
    return finish();
  }
  if (/^(estado|estatus|seguimiento)(\s.*)?$/.test(message)) {
    const latest = ownRows.filter(r => r.Intencion !== '_sesion' && parse(r.Mensaje)?.folio)
      .sort((a, b) => String(b.Fecha).localeCompare(String(a.Fecha)))[0];
    if (latest) {
      const detail = parse(latest.Mensaje);
      const status = ['Pendiente', 'Confirmado', 'Rechazado', 'Cancelado'].includes(latest.Estado) ? latest.Estado : 'Pendiente';
      reply = `Solicitud ${detail.folio}: ${status}.` +
        (status === 'Pendiente' ? ' Aún requiere revisión del encargado; no está confirmada.' : '') +
        ' Para aclaraciones escribe asesor.';
    } else reply = 'No encuentro una solicitud enviada para este número. Escribe pedido, reservación, evento o facturación para comenzar.';
    return finish();
  }
  const section = Object.keys(config.menuSections || {}).find(key => message === key || message === 'menu ' + key || message === 'precios ' + key);
  if (config.menuSections && /\b(cuanto|cuestan|precio|precios|costo|costos)\b/.test(message) && !/^(precios?)$/.test(message) && !section) {
    const terms = message.replace(/\b(kilo|kilos|kilogramo|kilogramos)\b/g, 'kg').split(/\W+/)
      .filter(word => (word.length > 2 || word === 'kg') && !['cuanto','cuesta','cuestan','precio','precios','costo','costos','tiene','tienen','del','las','los','una','uno','por','que','vale','cuanto','quiero','saber','favor'].includes(word));
    const lines = Object.values(config.menuSections).flatMap(value => value.split('\n')).filter(line => line.includes('$'));
    const matches = lines.filter(line => terms.length && terms.every(term => normalizeText(line).includes(term)));
    reply = matches.length ? matches.join('\n') + '\nPrecios en MXN del menú configurado. Disponibilidad y total por confirmar con el encargado.' :
      'No encontré ese producto exacto en el menú cargado. Escribe menú para ver las opciones o asesor para consultarlo.';
    return finish();
  }
  if (/^(menu|carta|precios?|menu completo)$/.test(message) || (navigationNumber && message === '1') || section) {
    reply = config.menuSections ? (section ? config.menuSections[section] : Object.values(config.menuSections).join('\n\n')) +
      '\n\nPrecios en MXN según el menú configurado proporcionado por el restaurante. Disponibilidad y total se confirman con el encargado. Escribe pedido para solicitar comida para recoger.' :
      config.menuUrl ? 'Consulta nuestro menú actualizado: ' + config.menuUrl :
      'Todavía no tengo cargados los precios ni el enlace oficial del menú. Escribe asesor para solicitar esa información.';
    if (session.awaiting && session.stage === 'datos') reply += '\nTu captura sigue guardada. ' + question(session.awaiting);
    return finish();
  }
  if (/\b(horario|abren|cierran)\b/.test(message) || (navigationNumber && message === '2')) {
    reply = hours + ' La disponibilidad se confirma con el encargado.';
    return finish();
  }
  if (/\b(ubicacion|direccion|como llego|maps)\b/.test(message) || (navigationNumber && message === '3')) {
    reply = config.mapsUrl ? [config.address, config.mapsUrl].filter(Boolean).join('\n') :
      'Todavía no tengo la dirección y el enlace oficial de Maps cargados. Escribe asesor para solicitar la ubicación exacta.';
    return finish();
  }
  let newIntent = '';
  if (/^(asesor|encargado|humano|ayuda humana)$/.test(message)) newIntent = 'asesor';
  else if (/\b(factur[a-z]*|constancia fiscal|rfc)\b/.test(message) || message === '7') newIntent = 'facturacion';
  else if (/\b(evento|fiesta|rentar|cotizacion|servicio completo|servicio parcial)\b/.test(message) || message === '6') newIntent = 'evento';
  else if (/\b(reserv[a-z]*|mesa)\b/.test(message) || message === '5') newIntent = 'reservacion';
  else if (/\b(pedido|ordenar)\b/.test(message) || message === '4' ||
    (!session.intent && /\b(kilo|kg|producto|comida|bebida)\b/.test(message))) newIntent = 'pedido';
  // A numbered answer during a capture is data, not a navigation command.
  if (/^[1-7]$/.test(message) && session.stage === 'datos' && session.awaiting) newIntent = '';
  if (newIntent && (newIntent !== session.intent || session.stage === 'pendiente' || session.stage === 'inicio')) start(newIntent);
  if (!session.intent) { reply = menu; return finish(); }
  if (session.stage === 'pendiente') {
    reply = `Tu solicitud ${session.lastFolio || ''} ya está registrada para revisión. Escribe estado para consultarla o reiniciar para iniciar otra.`;
    return finish();
  }
  if (session.stage === 'confirmar' && /^(si|confirmo|confirmar|enviar|correcto|de acuerdo)$/.test(message)) {
    const id = input.eventId || `${input.phone.replace(/\D/g, '')}-${Date.parse(session.startedAt)}`;
    const folio = 'REQ-' + id.replace(/[^a-z0-9-]/gi, '').toUpperCase();
    request = {
      version: 2, id, folio, tipo: session.intent, telefono: input.phone,
      datos: session.data, estado: 'Pendiente', requiereIntervencionHumana: true,
      createdAt: now, avisoEncargado: config.notificationsEnabled ? 'preparado_para_Meta_entrega_no_verificada' : 'pendiente_de_configurar',
      adjuntos: 'IDs de medios de Meta; descarga privada y revisión pendientes',
    };
    session.stage = 'pendiente'; session.lastFolio = folio; session.awaiting = '';
    reply = `Solicitud ${folio} registrada como PENDIENTE en la bandeja del restaurante. No es una confirmación de disponibilidad, reservación ni precio. Escribe estado para consultar el seguimiento.`;
    if (config.notificationsEnabled && config.managerPhone) {
      notifications.push({ to: config.managerPhone, body:
        `NEGOCIO DE EJEMPLO\nNueva solicitud PENDIENTE\nFolio: ${folio}\nCliente: ${session.data.nombre}\nWhatsApp: ${input.phone.replace('whatsapp:', '')}\n` +
        summary({ ...session, data: Object.fromEntries(Object.entries(session.data).filter(([k]) => !['rfc', 'correo', 'archivos'].includes(k))) }) +
        (session.data.archivos?.length ? `\nDocumentos fiscales: ${session.data.archivos.length} referencia(s) en n8n; revisar allí, no se descargaron automáticamente.` : '') +
        `\n\nPara decidir, responde:\naprobar ${folio}\no\nrechazar ${folio} motivo\n\nLa entrega de este aviso depende de la sesión activa de WhatsApp.` });
    }
    return finish();
  }
  if (session.stage === 'confirmar') {
    if (/^(no|corregir|cambiar)$/.test(message)) {
      start(session.intent); reply = 'Vamos a capturar los datos otra vez. ' + question('nombre');
      session.awaiting = 'nombre'; return finish();
    }
    reply = summary(session) + '\n¿Los datos son correctos? Responde sí para enviar, corregir para empezar de nuevo o cancelar.';
    return finish();
  }
  const d = session.data;
  const explicitName = input.text.match(/(?:me llamo|mi nombre es|a nombre de|soy)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{2,60})(?=[,;.]|$)/i);
  const firstPart = input.text.split(/[,;\n]/)[0].trim();
  const possibleName = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{2,60}$/.test(firstPart) &&
    !/\b(hola|buenos|buenas|quiero|pedido|reserv|mesa|domingo|sabado|lunes|martes|miercoles|jueves|viernes|hoy|manana|factura|evento|asesor|efectivo|tarjeta|transferencia|comida|bebida|kilo|sin preferencia)\b/.test(normalizeText(firstPart));
  if (explicitName) d.nombre = explicitName[1].trim();
  else if ((!d.nombre && (session.awaiting === 'nombre' || input.text.includes(','))) && possibleName) d.nombre = firstPart;

  const dateResult = extractDate(message, now);
  if (dateResult) d.fecha = dateResult;
  const timeResult = extractTime(message, session.awaiting === 'hora');
  if (timeResult) d.hora = timeResult;
  const people = message.match(/\b(\d{1,3})\s*(personas?|comensales?|adultos?)\b/) ||
    (session.awaiting === 'personas' ? message.match(/^(\d{1,3})$/) : null);
  if (people && +people[1] > 0 && +people[1] <= 300) d.personas = +people[1];
  const zone = message.match(/\b(interior|exterior|sin preferencia)\b/);
  if (zone) d.zona = zone[1];
  const pay = message.match(/\b(efectivo|transferencia|tarjeta)\b/);
  if (pay) d.pago = pay[1];
  if (session.intent === 'pedido') {
    const quantity = /\b(\d+(?:[.,]\d+)?|un|uno|una|medio|media|dos|tres|cuatro|cinco|seis|diez)\s*(kg|kilos?|litros?|tacos?|porciones?|ordenes?|bebidas?)\b/.test(message);
    // Durante la captura se acepta texto libre con cantidad.
    const product = input.text.trim().length >= 3;
    if (quantity && product) d.producto = input.text.split(/[,;\n]/).find(p => /\b(producto|comida|bebida|taco)/.test(normalizeText(p)))?.trim() || input.text;
    if (session.awaiting === 'producto' && quantity) d.producto = input.text;
  }
  if (session.intent === 'evento' && session.awaiting === 'servicio' && !newIntent && input.text.length >= 5) d.servicio = input.text;
  if (session.intent === 'asesor' && session.awaiting === 'motivo' && !newIntent && input.text.length >= 3) d.motivo = input.text;
  if (session.intent === 'facturacion') {
    const email = input.text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (email) d.correo = email[0];
    const rfc = input.text.toUpperCase().match(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/);
    if (rfc) d.rfc = rfc[0];
    if (input.media.length) {
      const accepted = input.media.filter(m => /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(m.contentType));
      const existing = d.archivos || [];
      d.archivos = [...existing, ...accepted.filter(m => !existing.some(e => (e.id || e.url) === (m.id || m.url)))].slice(0, 10);
      if (!accepted.length) {
        reply = 'Para facturación envía archivos PDF o imágenes JPG/PNG. No puedo leer audios ni verificar documentos automáticamente.';
        return finish();
      }
    }
    if (session.awaiting === 'documentos' && (/^(listo|ya envie|ya envie todo|terminado)$/.test(message)) && d.archivos?.length) d.documentosListos = true;
  } else if (input.media.length && !input.text) {
    reply = 'Recibí un archivo, pero para esta solicitud necesito los datos por escrito. ' + question(session.awaiting || 'nombre');
    return finish();
  }
  const required = {
    pedido: ['nombre', 'producto', 'fecha', 'hora', 'pago'],
    reservacion: ['nombre', 'fecha', 'hora', 'personas', 'zona'],
    evento: ['nombre', 'fecha', 'personas', 'servicio'],
    facturacion: ['nombre', 'correo', 'rfc', 'documentos'],
    asesor: ['nombre', 'motivo'],
  }[session.intent];
  const missing = required.find(key => key === 'documentos' ? !d.documentosListos : !d[key]);
  if (missing) {
    session.awaiting = missing;
    reply = (d.nombre ? '' : 'Con gusto. ') + question(missing);
    if (missing === 'documentos' && d.archivos?.length) reply = `Tengo ${d.archivos.length} referencia(s) de archivo de WhatsApp. ` +
      'Envía la constancia fiscal y el ticket que falten. Al terminar escribe listo; el encargado debe abrirlos y verificar que sean correctos.';
  } else {
    session.stage = 'confirmar'; session.awaiting = '';
    reply = summary(session) + '\n¿Los datos son correctos? Responde sí para enviar, corregir para empezar de nuevo o cancelar.';
  }
  return finish();
}

function managerConversation(input, rows, config, now) {
  const parse = value => { try { return JSON.parse(value); } catch { return null; } };
  let reply = '', request = null, notifications = [];
  const requests = rows.filter(r => r.Intencion !== '_sesion').map(row => ({ row, value: parse(row.Mensaje) }))
    .filter(x => x.value?.folio && x.value?.telefono && /^whatsapp:\+\d{7,15}$/.test(x.value.telefono));
  if (!input.isManager || canonicalPhone(input.phone) !== canonicalPhone(config.managerPhone)) {
    reply = 'Este comando solo está disponible para el encargado autorizado.';
  } else if (/^(panel|encargado|pendientes)$/i.test(input.text.trim())) {
    const pending = requests.filter(x => x.row.Estado === 'Pendiente').sort((a, b) => String(b.row.Fecha).localeCompare(String(a.row.Fecha)));
    reply = 'PANEL DEL ENCARGADO\n' + (pending.length ? `Solicitudes pendientes: ${pending.length}\n` + pending.slice(0, 10).map(x =>
      `${x.value.folio}\n${x.value.tipo} | ${x.value.datos.nombre} | ${x.value.datos.fecha || 'sin fecha'} ${x.value.datos.hora || ''}`
    ).join('\n\n') : 'No hay solicitudes pendientes.') +
      '\n\nComandos:\naprobar FOLIO\nrechazar FOLIO motivo\npendientes\n\nLa aprobación confirma los datos capturados. No cobra ni emite facturas. Las notificaciones por WhatsApp requieren ventanas de atención abiertas.';
  } else {
    const match = input.text.trim().match(/^(aprobar|rechazar)\s+(REQ-[A-Z0-9-]+)(?:\s+([\s\S]+))?$/i);
    const found = match && requests.find(x => x.value.folio.toUpperCase() === match[2].toUpperCase());
    if (!match) reply = 'Usa aprobar FOLIO o rechazar FOLIO motivo. Escribe pendientes para ver los folios.';
    else if (!found) reply = 'No encontré ese folio. Escribe pendientes y copia el folio completo.';
    else if (found.row.Estado !== 'Pendiente') reply = `La solicitud ${found.value.folio} ya está en estado ${found.row.Estado}. No la cambié ni repetí la notificación.`;
    else if (match[1].toLowerCase() === 'rechazar' && !match[3]) reply = 'Incluye el motivo: rechazar FOLIO motivo. El motivo se compartirá con el cliente.';
    else {
      const state = match[1].toLowerCase() === 'aprobar' ? 'Confirmado' : 'Rechazado';
      const reason = (match[3] || '').trim().slice(0, 500);
      request = { ...found.value, estado: state, decidedAt: now, decidedBy: config.managerDisplayPhone,
        decisionMessageId: input.eventId, motivo: reason, requiereIntervencionHumana: false,
        avisoCliente: config.notificationsEnabled ? 'preparado_para_Meta_entrega_no_verificada' : 'pendiente_de_configurar' };
      reply = `Solicitud ${request.folio}: ${state}. Se guardó la decisión.` +
        (config.notificationsEnabled ? ' El aviso al cliente se intentará por WhatsApp; su entrega aún no está verificada.' : ' El envío automático al cliente no está configurado.');
      if (config.notificationsEnabled) notifications.push({
        to: request.telefono,
        body: `${config.businessName || 'Nuestro negocio'}\nTu solicitud ${request.folio} (${request.tipo}) fue ${state === 'Confirmado' ? 'CONFIRMADA' : 'RECHAZADA'} por el encargado.` +
          (state === 'Confirmado' ? '\n' + summary({ intent: request.tipo, data: request.datos }).replace(/\nSujeta a revisión del encargado\.$/, '') : '') +
          (reason ? '\nMotivo: ' + reason : '') +
          (request.tipo === 'facturacion' ? '\nEsta es una confirmación de recepción de la solicitud; no significa que la factura esté emitida.' : '') +
          '\nPara aclaraciones escribe asesor.',
      });
    }
  }
  return {
    phone: input.phone, customerName: 'Encargado', intent: 'administracion', reply,
    sessionJson: JSON.stringify({
      version: 2, intent: '', stage: 'inicio', data: {}, seen: [input.eventId].filter(Boolean), updatedAt: now,
    }), processedAt: now, saveRequest: !!request, requiresHuman: false,
    request, requestKey: request ? `${request.tipo}:${request.id}` : '', requestJson: request ? JSON.stringify(request) : '',
    requestPhone: request?.telefono || input.phone, requestCustomerName: request?.datos?.nombre || 'Encargado',
    requestState: request?.estado || '', notifications,
  };
}

function question(key) {
  return {
    nombre: '¿A nombre de quién registramos la solicitud?',
    producto: '¿Qué producto y cantidad deseas? Por ejemplo: 2 porciones de comida.',
    fecha: '¿Para qué fecha? Puedes escribir 27/09/2026, mañana o el día de la semana.',
    hora: '¿A qué hora? Usa formato de 24 horas, por ejemplo 10:00 o 14:00.',
    personas: '¿Para cuántas personas? Envía un número entre 1 y 300.',
    zona: '¿Qué zona prefieres? Puedes escribir interior, exterior o sin preferencia. Sujeta a disponibilidad.',
    pago: '¿Qué forma de pago prefieres: efectivo, transferencia o tarjeta? No envíes datos de tu tarjeta.',
    servicio: 'Describe el servicio para el evento: comida, renta del lugar u otro.',
    correo: '¿A qué correo deseas recibir la factura?',
    rfc: 'Escribe tu RFC, por favor.',
    documentos: 'Envía la constancia de situación fiscal y el ticket en PDF o imagen. Cuando hayas enviado ambos escribe listo. Solo registraré las referencias; un encargado debe revisar los archivos.',
    motivo: '¿Qué necesitas que revise el encargado?',
  }[key] || 'Cuéntame qué necesitas.';
}

function extractDate(text, now) {
  text = normalizeText(text);
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const today = new Date(local + 'T12:00:00Z');
  const iso = d => d.toISOString().slice(0, 10);
  let match = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  let candidate = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  if (!candidate) {
    match = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
    if (match) candidate = `${match[3] || local.slice(0, 4)}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  if (candidate) {
    const date = new Date(candidate + 'T12:00:00Z');
    return Number.isFinite(+date) && iso(date) === candidate && candidate >= local ? candidate : '';
  }
  if (/\bpasado manana\b/.test(text)) { today.setUTCDate(today.getUTCDate() + 2); return iso(today); }
  if (/\bmanana\b/.test(text.replace(/\bde la manana\b/g, ''))) { today.setUTCDate(today.getUTCDate() + 1); return iso(today); }
  if (/\bhoy\b/.test(text)) return iso(today);
  const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const index = days.findIndex(day => new RegExp('\\b' + day + '\\b').test(text));
  if (index >= 0) {
    let delta = (index - today.getUTCDay() + 7) % 7;
    if (!delta && /\b(proximo|siguiente)\b/.test(text)) delta = 7;
    today.setUTCDate(today.getUTCDate() + delta);
    return iso(today);
  }
  return '';
}

function extractTime(text, isAnswer) {
  text = normalizeText(text);
  let m = text.match(/\b(?:a las?\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/) ||
    text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/) ||
    text.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (m && /^(am|pm)$/.test(m[2] || '')) m = [m[0], m[1], '00', m[2]];
  if (!m && isAnswer) m = text.match(/^(\d{1,2})$/);
  if (!m) return '';
  let h = +m[1], min = +(m[2] || 0);
  const suffix = (m[3] || '').replace(/\./g, '');
  if (min > 59 || h > 23 || (suffix && (h < 1 || h > 12))) return '';
  if (suffix) h = h % 12 + (suffix === 'pm' ? 12 : 0);
  // Bare 1..7 is ambiguous for a daytime restaurant; ask for 24-hour time.
  if (!suffix && h > 0 && h < 8) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function summary(session) {
  const labels = { nombre: 'Nombre', producto: 'Producto y cantidad', fecha: 'Fecha', hora: 'Hora',
    personas: 'Personas', zona: 'Zona solicitada', pago: 'Pago preferido', servicio: 'Servicio',
    correo: 'Correo', rfc: 'RFC', motivo: 'Motivo' };
  return `Revisa tu solicitud de ${session.intent}:\n` +
    Object.entries(labels).filter(([k]) => session.data[k]).map(([k, label]) => `${label}: ${session.data[k]}`).join('\n') +
    (session.data.archivos?.length ? `\nReferencias de archivos: ${session.data.archivos.length} (pendientes de revisión y descarga)` : '') +
    (session.intent === 'pedido' ? '\nModalidad: recoger en restaurante. Precio y disponibilidad por confirmar.' : '') +
    '\nSujeta a revisión del encargado.';
}


module.exports = { conversation, managerConversation, extractDate, extractTime };
