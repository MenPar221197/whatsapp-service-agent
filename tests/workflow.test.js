'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../workflows/whatsapp-service-agent.json');
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));

test('all connection targets and source nodes exist and Code nodes parse', () => {
  assert.equal(new Set(workflow.nodes.map(node => node.id)).size, workflow.nodes.length);
  for (const [name, outputs] of Object.entries(workflow.connections)) {
    assert.ok(nodes.has(name));
    for (const branches of Object.values(outputs)) for (const edges of branches) for (const edge of edges) assert.ok(nodes.has(edge.node));
  }
  for (const node of workflow.nodes.filter(node => node.type === 'n8n-nodes-base.code')) {
    new vm.Script(`(function () {\n${node.parameters.jsCode}\n})`);
  }
});

test('the public workflow is inactive and contains no credentials, pinned payloads or instance metadata', () => {
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.pinData, {});
  for (const key of ['id', 'versionId', 'meta', 'tags']) assert.equal(workflow[key], undefined);
  for (const node of workflow.nodes) assert.equal(node.credentials, undefined);
  const assignments = nodes.get('Configurar negocio').parameters.assignments.assignments;
  assert.equal(assignments.find(value => value.name === 'businessPhone').value, 'REPLACE_WITH_BUSINESS_PHONE');
  assert.equal(assignments.find(value => value.name === 'managerPhone').value, '');
});

test('both persistence paths use configured table IDs and sending has an explicit error branch', () => {
  for (const node of workflow.nodes.filter(node => node.type === 'n8n-nodes-base.dataTable')) {
    assert.match(node.parameters.dataTableId.value, /Configurar negocio/);
  }
  const outputs = workflow.connections['Enviar por Meta'].main;
  assert.equal(outputs[1][0].node, 'Error al enviar por Meta');
  assert.equal(nodes.get('Enviar por Meta').onError, 'continueErrorOutput');
});

test('the generated normalizer and conversation Code wrappers can process a synthetic event together', () => {
  const fixture = require('../examples/inbound-message.json');
  const business = require('../config/business.example.json');
  const configured = { json: { ...fixture, businessPhone: '12025550100', managerPhone: '', businessConfigJson: JSON.stringify(business) } };
  const run = (name, context) => vm.runInNewContext(`(function () {\n${nodes.get(name).parameters.jsCode}\n})()`, context);
  const messages = run('Normalizar Meta', { $input: { all: () => [configured] } });
  const result = run('Procesar conversacion', { $runIndex: 0, $input: { all: () => [] },
    $: name => ({ first: () => ({ json: { message: messages[0].json, rows: [] } }) }) });
  assert.match(result[0].json.reply, /Negocio de demostración/);
  assert.equal(result[0].json.saveRequest, false);
});

test('tracked source and documentation do not contain common embedded secret formats', () => {
  const root = path.resolve(__dirname, '..');
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full); else files.push(full);
    }
  }
  visit(root);
  const patterns = [new RegExp('EA' + 'A[A-Za-z0-9]{50,}'), new RegExp('gh' + '[pousr]_[A-Za-z0-9]{30,}'),
    new RegExp('-----BEGIN ' + '(?:RSA |EC |OPENSSH )?PRIVATE KEY-----')];
  for (const file of files) for (const pattern of patterns) assert.equal(pattern.test(fs.readFileSync(file, 'utf8')), false, path.relative(root, file));
});
