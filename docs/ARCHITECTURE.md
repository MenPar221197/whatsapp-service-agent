# Arquitectura y contratos de datos

## Separación de responsabilidades

| Módulo | Responsabilidad |
| --- | --- |
| `src/normalize-meta.js` | Validar número del negocio y metadatos, resolver remitente autorizado, normalizar texto y referencias de medios |
| `src/conversation.js` | Aplicar reglas, validar campos, conservar sesión, generar solicitudes y decisiones humanas |
| `src/prepare-outbound.js` | Preparar destinatarios, bloquear autoenvíos y dividir textos largos |
| `src/check-acceptance.js` | Exigir un ID de mensaje aceptado por Meta |
| `scripts/build-workflow.js` | Incorporar módulos y configuración de ejemplo en el JSON de n8n |

El motor de conversación es una función pura: recibe mensaje, filas, configuración y fecha; devuelve una respuesta, estado de sesión, solicitud opcional y avisos. No realiza llamadas HTTP ni lee credenciales. El envío y la persistencia pertenecen a los nodos de n8n.

## Recorrido de nodos

1. **Recibir WhatsApp Meta → Configurar negocio → Normalizar Meta:** recibir eventos y agregar configuración independiente.
2. **Procesar uno por uno → Mensaje actual → Leer sesion → Agrupar sesion → Leer solicitudes:** recuperar contexto persistente para el mensaje actual.
3. **Procesar conversacion → Hay solicitud para guardar:** generar respuesta y decidir si corresponde crear o actualizar una solicitud.
4. **Guardar solicitud, cuando corresponde → Guardar sesion:** escribir antes de intentar los envíos.
5. **Preparar respuestas Meta → Hay mensaje para enviar → Enviar por Meta:** enviar la respuesta y los avisos aplicables.
6. **Comprobar aceptacion de Meta → siguiente iteración:** comprobar aceptación; **Error al enviar por Meta** detiene la ejecución cuando el envío falla.

## Sesiones

La clave lógica es `Telefono + _sesion`. El JSON de sesión usa `version: 3`, `intent`, `stage`, `data`, `awaiting`, `seen`, `updatedAt` y, después del envío, `lastFolio`.

| Estado | Comportamiento |
| --- | --- |
| `inicio` | Mostrar opciones y seleccionar formulario |
| `datos` | Validar y capturar un campo a la vez |
| `confirmar` | Mostrar resumen y exigir confirmación explícita |
| `pendiente` | Indicar que la solicitud fue enviada y ofrecer consulta de estado |

La expiración se controla con `sessionTtlHours`. Las fechas relativas usan `timeZone`. Los comandos de información no borran una captura en curso. `cancelar` descarta la captura actual; una solicitud ya enviada conserva su registro y requiere intervención humana para cancelarla.

La normalización acepta el prefijo `whatsapp:` y elimina símbolos del teléfono. Conserva una regla de compatibilidad para números mexicanos antiguos con `521` seguido de diez dígitos, tratándolos como `52` seguido de esos mismos dígitos.

## Solicitudes y autorización

La clave lógica de solicitud conserva el ID completo del mensaje de confirmación: `tipo:ID-del-evento`. El folio visible usa el prefijo configurado y un hash de 64 bits para ser más corto; el folio no sustituye el ID del proveedor como clave de persistencia.

Las solicitudes comienzan en `Pendiente`. El responsable puede consultar pendientes y registrar una decisión. Se comprueba tanto `isManager` como la coincidencia del teléfono con `managerPhone`; una bandera aislada no concede acceso. Una decisión ya registrada no genera una segunda modificación ni repite el aviso.

Las consultas de estado filtran por el teléfono que escribe. Los datos fiscales marcados como sensibles se conservan en la solicitud, pero se excluyen del resumen enviado al responsable. Los archivos se guardan como referencias de Meta; no se descargan ni se verifica su contenido.

## Errores e idempotencia

La sesión guarda hasta 80 IDs de mensajes recientes. Un reintento registrado no genera otra respuesta ni solicitud. Esta protección es acotada y depende de que la sesión se haya escrito correctamente.

La API de envío utiliza una rama de error explícita. Una respuesta sin ID aceptado también detiene la ejecución. Un evento posterior con estado `failed` produce un error visible. La aceptación por Meta y la entrega al destinatario son eventos diferentes.

La escritura de solicitud y sesión no es una transacción. Si falla después de guardar una solicitud y antes de guardar la sesión, un reintento puede repetir un aviso aunque el upsert reutilice la clave de solicitud. La plantilla no tiene una bandeja de salida duradera ni estados independientes por cada destinatario.

## Límites y mejoras previstas

- El procesamiento es secuencial dentro de un evento. Ejecuciones simultáneas para el mismo remitente pueden competir al escribir la sesión.
- `Leer solicitudes` obtiene la tabla de solicitudes completa para soportar el panel del responsable. El motor filtra el estado del cliente, pero una instalación con volumen necesita consultas más selectivas, paginación y control de acceso en el almacenamiento.
- La deduplicación reciente no garantiza procesamiento único global. Una evolución puede utilizar SQL con una restricción única por ID de evento y una cola de salida.
- Falta incorporar plantillas de WhatsApp, reintentos controlados y seguimiento persistente de entrega por destinatario.
- La descarga privada de archivos y su revisión necesitan un servicio específico y permisos adecuados.
- Una futura capa de IA puede ayudar a interpretar intenciones. Las decisiones y validaciones deben seguir pasando por el contrato de solicitudes y la aprobación humana. Esa capa no está implementada aquí.

Estas mejoras son trabajo pendiente, no capacidades comprobadas de la plantilla publicada.
