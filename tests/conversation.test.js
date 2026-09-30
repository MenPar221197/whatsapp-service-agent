'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const example = require('../config/business.example.json');
const { conversation, extractDate, extractTime } = require('../src/conversation');
const NOW = '2026-09-30T02:00:00.000Z';
const CUSTOMER = 'whatsapp:+12025550101';
const MANAGER = 'whatsapp:+12025550102';
const config = () => ({ ...structuredClone(example), managerPhone: MANAGER });
const input = (text, eventId, extra = {}) => ({ phone: CUSTOMER, profileName: 'Cliente Demo',
  text, eventId, media: [], valid: true, isManager: false, ...extra });

function harness(settings = config()) {
  let sequence = 0;
  const rows = [];
  function send(text, extra = {}) {
    const result = conversation(input(text, `wamid.TEST-${++sequence}`, extra), rows, settings, NOW);
    const sessionIndex = rows.findIndex(row => row.Telefono === result.phone && row.Intencion === '_sesion');
    const session = { Telefono: result.phone, Intencion: '_sesion', Mensaje: result.sessionJson, Fecha: result.processedAt, Estado: 'Sesion' };
    if (sessionIndex < 0) rows.push(session); else rows[sessionIndex] = session;
    if (result.saveRequest) {
      const row = { Telefono: result.requestPhone, Intencion: result.requestKey, Mensaje: result.requestJson,
        Fecha: result.processedAt, Estado: result.requestState };
      const index = rows.findIndex(old => old.Telefono === row.Telefono && old.Intencion === row.Intencion);
      if (index < 0) rows.push(row); else rows[index] = row;
    }
    return result;
  }
  return { send, rows, settings };
}

function completeOrder(h) {
  for (const text of ['pedido', 'Ana Demo', '2 unidades del producto de prueba', '01/10/2026', '14:30', 'efectivo']) h.send(text);
  return h.send('sí');
}

test('an order is captured, reviewed and saved pending; it is not automatically approved', () => {
  const h = harness();
  const result = completeOrder(h);
  assert.equal(result.saveRequest, true);
  assert.equal(result.request.estado, 'Pendiente');
  assert.equal(result.request.datos.nombre, 'Ana Demo');
  assert.equal(result.request.datos.fecha, '2026-10-01');
  assert.equal(result.request.datos.hora, '14:30');
  assert.match(result.request.folio, /^REQ-[A-F0-9]{16}$/);
  assert.match(result.reply, /PENDIENTE/);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].to, MANAGER);
  assert.equal(h.rows.filter(row => row.Intencion !== '_sesion').length, 1);
});

test('a retried confirmation does not create another request or send another message', () => {
  const h = harness();
  const first = completeOrder(h);
  const retry = h.send('sí', { eventId: first.request.id });
  assert.equal(retry.saveRequest, false);
  assert.equal(retry.reply, '');
  assert.deepEqual(retry.notifications, []);
});

test('requests can be saved with notifications disabled', () => {
  const h = harness({ ...config(), managerPhone: '' });
  const result = completeOrder(h);
  assert.equal(result.saveRequest, true);
  assert.equal(result.request.avisoEncargado, 'sin_configurar');
  assert.deepEqual(result.notifications, []);
});

test('only the configured manager can approve and repeating a decision is harmless', () => {
  const h = harness();
  const first = completeOrder(h);
  const extra = { phone: MANAGER, isManager: true };
  const approved = h.send(`aprobar ${first.request.folio}`, extra);
  assert.equal(approved.requestState, 'Confirmado');
  assert.equal(approved.notifications[0].to, CUSTOMER);
  assert.equal(approved.requiresHuman, false);
  const repeated = h.send(`aprobar ${first.request.folio}`, extra);
  assert.equal(repeated.saveRequest, false);
  assert.deepEqual(repeated.notifications, []);
});

test('a forged manager flag does not grant access to requests', () => {
  const h = harness();
  const first = completeOrder(h);
  const denied = h.send(`aprobar ${first.request.folio}`, { isManager: true });
  assert.equal(denied.saveRequest, false);
  assert.match(denied.reply, /solo está disponible/);
  assert.equal(h.send('pendientes').reply.includes(first.request.folio), false);
});

test('rejecting a request requires a reason, then records and sends that reason', () => {
  const h = harness();
  const first = completeOrder(h);
  const manager = { phone: MANAGER, isManager: true };
  assert.equal(h.send(`rechazar ${first.request.folio}`, manager).saveRequest, false);
  const rejected = h.send(`rechazar ${first.request.folio} Sin disponibilidad`, manager);
  assert.equal(rejected.requestState, 'Rechazado');
  assert.match(rejected.notifications[0].body, /Sin disponibilidad/);
});

test('a customer cannot retrieve another customer request through status', () => {
  const h = harness();
  const first = completeOrder(h);
  const result = h.send('estado', { phone: 'whatsapp:+12025550103' });
  assert.equal(result.reply.includes(first.request.folio), false);
  assert.match(result.reply, /No encuentro/);
});

test('cancel resets an unfinished capture without saving a request', () => {
  const h = harness();
  h.send('pedido'); h.send('Ana Demo');
  const result = h.send('cancelar');
  assert.equal(result.saveRequest, false);
  assert.equal(JSON.parse(result.sessionJson).intent, '');
});

test('resetting a submitted conversation does not delete the saved request', () => {
  const h = harness();
  completeOrder(h);
  assert.match(h.send('inicio').reply, /sigue registrada/);
  assert.equal(h.rows.filter(row => row.Intencion !== '_sesion').length, 1);
});

test('numeric data during capture is not interpreted as menu navigation', () => {
  const h = harness();
  h.send('cotizacion'); h.send('Ana Demo'); h.send('Servicio de prueba');
  const result = h.send('50');
  assert.equal(JSON.parse(result.sessionJson).data.detalles, '50');
  assert.equal(JSON.parse(result.sessionJson).stage, 'confirmar');
});

test('appointment and quote forms complete using the configurable fields', () => {
  for (const sequence of [
    ['cita', 'Ana Demo', 'Servicio de prueba', 'mañana', '07:00', 'sí'],
    ['cotizacion', 'Ana Demo', 'Servicio de prueba', '50 unidades para entrega', 'sí'],
  ]) {
    const h = harness();
    let result;
    for (const text of sequence) result = h.send(text);
    assert.equal(result.saveRequest, true);
    assert.equal(result.request.tipo, sequence[0]);
  }
});

test('invalid dates and times do not advance capture', () => {
  const h = harness();
  h.send('cita'); h.send('Ana Demo'); h.send('Servicio de prueba');
  assert.equal(JSON.parse(h.send('31/02/2027').sessionJson).awaiting, 'fecha');
  h.send('mañana');
  assert.equal(JSON.parse(h.send('25:80').sessionJson).awaiting, 'hora');
});

test('invoice capture stores media references and hides fiscal fields in manager notifications', () => {
  const h = harness();
  for (const text of ['factura', 'Ana Demo', 'demo@example.com', 'XAXX010101000']) h.send(text);
  const media = [{ id: 'MEDIA-TEST-1', provider: 'meta', contentType: 'application/pdf', filename: 'demo.pdf' }];
  h.send('', { media }); h.send('', { media });
  h.send('listo');
  const result = h.send('sí');
  assert.equal(result.request.datos.archivos.length, 1);
  assert.equal(result.notifications[0].body.includes('demo@example.com'), false);
  assert.equal(result.notifications[0].body.includes('XAXX010101000'), false);
  assert.equal(result.request.tipo, 'facturacion');
});

test('unsupported attachments do not finish invoice capture', () => {
  const h = harness();
  for (const text of ['factura', 'Ana Demo', 'demo@example.com', 'XAXX010101000']) h.send(text);
  h.send('', { media: [{ id: 'AUDIO-TEST', contentType: 'audio/ogg' }] });
  assert.equal(JSON.parse(h.send('listo').sessionJson).awaiting, 'archivos');
});

test('an expired session resets without reusing its previous personal data', () => {
  const rows = [{ Telefono: CUSTOMER, Intencion: '_sesion', Fecha: '2026-09-01T00:00:00Z', Mensaje: JSON.stringify({
    version: 3, intent: 'pedido', stage: 'datos', awaiting: 'producto', data: { nombre: 'Old Demo' },
    seen: [], updatedAt: '2026-09-01T00:00:00Z',
  }) }];
  const result = conversation(input('hola', 'EXPIRED-TEST'), rows, config(), NOW);
  assert.deepEqual(JSON.parse(result.sessionJson).data, {});
});

test('relative dates use the configured local day and generic times support early appointments', () => {
  assert.equal(extractDate('hoy', NOW, 'America/Mexico_City'), '2026-09-29');
  assert.equal(extractDate('mañana', NOW, 'America/Mexico_City'), '2026-09-30');
  assert.equal(extractDate('29/02/2027', NOW), '');
  assert.equal(extractTime('07:00'), '07:00');
  assert.equal(extractTime('12:30 am'), '00:30');
  assert.equal(extractTime('99:00'), '');
});
