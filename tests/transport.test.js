'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMeta } = require('../src/normalize-meta');
const { prepareOutbound, splitText } = require('../src/prepare-outbound');
const { checkAcceptance } = require('../src/check-acceptance');
const business = require('../config/business.example.json');
const fixture = require('../examples/inbound-message.json');

const event = () => ({ json: { ...structuredClone(fixture), businessPhone: '12025550100',
  managerPhone: '12025550102', businessConfigJson: JSON.stringify(business) } });

test('official trigger payload is normalized with the authenticated metadata and customer text', () => {
  const result = normalizeMeta([event()]);
  assert.equal(result.length, 1);
  assert.equal(result[0].json.phone, 'whatsapp:+12025550101');
  assert.equal(result[0].json.text, 'hola');
  assert.equal(result[0].json.phoneNumberId, fixture.metadata.phone_number_id);
  assert.equal(result[0].json.isManager, false);
});

test('events for another business and self-sent messages are ignored', () => {
  const other = event(); other.json.metadata.display_phone_number = '12025550104';
  assert.deepEqual(normalizeMeta([other]), []);
  const self = event(); self.json.messages[0].from = self.json.businessPhone;
  assert.deepEqual(normalizeMeta([self]), []);
});

test('the responsible person cannot be the bot number and missing config fails before processing', () => {
  const bad = event(); bad.json.managerPhone = bad.json.businessPhone;
  assert.throws(() => normalizeMeta([bad]), /distinto/);
  const incomplete = event(); incomplete.json.businessPhone = 'REPLACE_WITH_BUSINESS_PHONE';
  assert.throws(() => normalizeMeta([incomplete]), /businessPhone/);
});

test('Meta delivery failure becomes an execution error', () => {
  const failed = event(); failed.json.messages = [];
  failed.json.statuses = [{ id: 'DELIVERY-TEST', status: 'failed' }];
  assert.throws(() => normalizeMeta([failed]), /fallo de entrega/);
});

test('manager identity is resolved from sender number and unsupported audio gets a text fallback', () => {
  const manager = event(); manager.json.messages[0].from = manager.json.managerPhone;
  assert.equal(normalizeMeta([manager])[0].json.isManager, true);
  const audio = event(); audio.json.messages[0] = { from: '12025550101', id: 'AUDIO-TEST', type: 'audio', audio: { id: 'MEDIA-TEST', mime_type: 'audio/ogg' } };
  assert.match(normalizeMeta([audio])[0].json.fallbackReply, /por escrito/);
});

test('empty replies skip transport; self-send attempts are blocked', () => {
  const input = normalizeMeta([event()])[0].json;
  assert.equal(prepareOutbound({ reply: '', notifications: [] }, input)[0].json.skipSend, true);
  assert.throws(() => prepareOutbound({ notifications: [{ to: input.businessPhone, body: 'Test' }] }, input), /autoenvío/);
});

test('long outbound messages are split without breaking emoji surrogate pairs', () => {
  const text = 'A'.repeat(3499) + '😀' + 'B'.repeat(4000);
  const parts = splitText(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(part => part.length <= 3500));
  assert.ok(parts.every(part => !/[\uD800-\uDBFF]$/.test(part)));
});

test('an accepted message ID is required; acceptance is not treated as delivery', () => {
  assert.throws(() => checkAcceptance([{ json: {} }]), /ID/);
  assert.throws(() => checkAcceptance([{ json: { error: { message: 'Test error' } } }]), /ID/);
  const accepted = [{ json: { messages: [{ id: 'ACCEPTED-TEST' }] } }];
  assert.deepEqual(checkAcceptance(accepted), accepted);
  assert.equal(accepted[0].json.delivered, undefined);
});
