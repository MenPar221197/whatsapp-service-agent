'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const workflow = readJson('config/workflow-layout.json');
const business = readJson('config/business.example.json');
const code = (relative, wrapper) => fs.readFileSync(path.join(root, relative), 'utf8')
  .split('// EXPORTS:')[0].trim() + '\n\n' + wrapper + '\n';

const sources = {
  'Normalizar Meta': code('src/normalize-meta.js', 'return normalizeMeta($input.all());'),
  'Procesar conversacion': code('src/conversation.js', "const bundle = $('Agrupar sesion').first(0, $runIndex).json;\nconst rows = [...bundle.rows, ...$input.all().map(item => item.json)].filter(row => row.Telefono);\nreturn [{ json: conversation(bundle.message, rows, bundle.message.config), pairedItem: { item: 0 } }];"),
  'Preparar respuestas Meta': code('src/prepare-outbound.js', "const result = $('Procesar conversacion').first(0, $runIndex).json;\nconst input = $('Mensaje actual').first(0, $runIndex).json;\nreturn prepareOutbound(result, input);"),
  'Comprobar aceptacion de Meta': code('src/check-acceptance.js', 'return checkAcceptance($input.all());'),
};
for (const node of workflow.nodes) if (sources[node.name]) node.parameters.jsCode = sources[node.name];
const config = workflow.nodes.find(node => node.name === 'Configurar negocio');
config.parameters.assignments.assignments.find(field => field.name === 'businessConfigJson').value = JSON.stringify(business, null, 2);
const target = path.join(root, 'workflows/whatsapp-service-agent.json');
const content = JSON.stringify(workflow, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
    console.error('Workflow out of date. Run npm run build.');
    process.exitCode = 1;
  } else console.log('Workflow matches the source modules and example configuration.');
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  console.log('Built workflows/whatsapp-service-agent.json');
}
