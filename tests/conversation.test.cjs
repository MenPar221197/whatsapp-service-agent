const {test}=require('node:test');
const assert=require('node:assert/strict');
const {conversation,managerConversation,extractDate,extractTime}=require('../src/conversation.cjs');
const now='2030-10-01T18:00:00Z';
const input=(text,eventId='test-1')=>({text,eventId,phone:'whatsapp:+15555550100',valid:true,profileName:'',media:[],isManager:false,managerCommand:false});
test('captura pedido, solicita confirmación y evita duplicar el evento',()=>{
 let rows=[],result;
 ['pedido','Ana Ejemplo','2 porciones de comida','2030-10-05','10:00','efectivo','sí'].forEach((text,i)=>{
  result=conversation(input(text,'event-'+i),rows,{},now);
  rows=[{Telefono:result.phone,Intencion:'_sesion',Mensaje:result.sessionJson,Fecha:now}];
 });
 assert.equal(result.saveRequest,true);assert.equal(result.request.estado,'Pendiente');assert.equal(result.request.datos.producto,'2 porciones de comida');
 assert.match(result.request.folio,/^REQ-/);
 const retry=conversation(input('sí','event-6'),rows,{},now);assert.equal(retry.saveRequest,false);assert.equal(retry.reply,'');
});
test('no permite comandos del encargado a otro número',()=>{
 const r=managerConversation(input('pendientes'),[],{managerPhone:'whatsapp:+15555550101'},now);
 assert.match(r.reply,/autorizado/);assert.equal(r.saveRequest,false);
});
test('rechaza fecha imposible y conserva hora válida',()=>{
 assert.equal(extractDate('2030-02-30',now),'');assert.equal(extractTime('14:30',true),'14:30');assert.equal(extractTime('25:00',true),'');
});
test('configuración comercial reemplazable',()=>{
 assert.match(conversation(input('hola'),[],{businessName:'Demo'},now).reply,/Demo/);
 assert.match(conversation(input('menú'),[],{},now).reply,/no tengo cargados/);
});
