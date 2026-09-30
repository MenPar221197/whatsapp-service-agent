'use strict';

function checkAcceptance(items) {
  if (!items.length) throw new Error('Meta no devolvió una respuesta de envío.');
  for (const item of items) {
    if (item.json.error || !item.json.messages?.[0]?.id) throw new Error('Meta no devolvió un ID de mensaje aceptado. Revisa Enviar por Meta.');
  }
  // Acceptance is not delivery: a subsequent failed status is handled by the trigger.
  return items;
}

// EXPORTS: removed when embedding this module in the n8n Code node.
module.exports = { checkAcceptance };
