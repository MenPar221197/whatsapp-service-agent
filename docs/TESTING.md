# Pruebas y validación

## Validación local

```bash
npm run build
npm run check
npm test
```

Las pruebas utilizan el ejecutor integrado de Node.js, eventos sintéticos y almacenamiento simulado en memoria. No necesitan tokens, conexión a Meta ni tablas reales. Se cubren:

- Captura y confirmación de pedidos, citas y cotizaciones.
- Solicitudes pendientes, consulta de estado y aislamiento entre clientes.
- Aprobación autorizada, rechazo con motivo y decisiones repetidas.
- Reintentos del mensaje de confirmación y deduplicación reciente.
- Expiración, reinicio y cancelación de conversaciones.
- Fechas inválidas, zona horaria y horas para negocios de distintos horarios.
- Referencias de documentos, deduplicación de adjuntos y protección de campos fiscales en avisos.
- Normalización del evento, bloqueo de autoenvíos y mensajes de audio no admitidos.
- División de textos largos y comprobación de aceptación por Meta.
- Conexiones del workflow, sintaxis de nodos Code, configuración pública y detección de formatos comunes de secretos.
- Ejecución de los wrappers JavaScript generados con un evento sintético.

GitHub Actions ejecuta `npm run check` y `npm test` en cada push o pull request. Estas pruebas no demuestran importación, enlazado de items ni entrega real dentro de n8n.

## Matriz de pruebas en n8n

Completa [`SETUP.md`](SETUP.md) y realiza estas pruebas en una aplicación de Meta de prueba. Usa **Execute workflow** para escuchar el evento y revisa **Executions** después de escribir desde otro número.

| Caso | Mensajes o acción | Resultado esperado |
| --- | --- | --- |
| Inicio | `hola` | Menú con el nombre del negocio configurado |
| Pedido | `pedido` → nombre → producto y cantidad → fecha → hora → pago → `sí` | Una solicitud `Pendiente` y sesión en `pendiente` |
| Cita | `cita` → nombre → servicio → fecha → hora → `sí` | Solicitud de cita pendiente |
| Cotización | `cotizacion` → nombre → servicio → detalles → `sí` | Solicitud de cotización pendiente |
| Facturación | `factura` → nombre → correo → RFC → PDF/imagen → `listo` → `sí` | Referencias guardadas; no se emite una factura |
| Atención humana | `asesor` → nombre → motivo → `sí` | Solicitud de atención humana pendiente |
| Revisión | Responsable: `pendientes` → `aprobar FOLIO` | La solicitud cambia a `Confirmado` y se intenta avisar al cliente |
| Rechazo | Responsable: `rechazar FOLIO motivo` | Estado `Rechazado` con motivo registrado |
| Acceso indebido | Otro número: `aprobar FOLIO` | Mensaje de acceso restringido; solicitud sin cambios |
| Seguimiento | Cliente: `estado` | Solo su solicitud más reciente |
| Reintento | Repetir el mismo evento/ID | Sin segunda respuesta si el ID sigue en la sesión |
| Audio | Enviar nota de voz | Solicitud de continuar por escrito |
| Error de envío | Probar credencial o destinatario inválidos en entorno de prueba | Ejecución con error visible |
| Varios mensajes | Evento con dos mensajes del mismo cliente | Se procesa cada mensaje en orden con su contexto |
| Fallo parcial | Interrumpir entre escritura de solicitud y sesión | Evaluar recuperación y posibles avisos duplicados |

Para avisos, tanto el responsable como el cliente deben tener una ventana de atención válida. Prueba también la operación sin `managerPhone`: debe guardar solicitudes sin generar avisos al responsable.

Antes de utilizarlo con clientes, comprueba el recorrido completo en tu versión de n8n, el enlazado de items al regresar al bucle, las columnas de Data Tables y la recuperación después de errores. Los resultados reales de estas pruebas deben registrarse en tu propia implementación; este repositorio no atribuye resultados de producción al prototipo.
