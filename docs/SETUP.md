# Configuración de la plantilla

## Requisitos

- Una instancia de n8n que incluya los nodos Data Table, WhatsApp Trigger y WhatsApp Business Cloud de la plantilla.
- Una aplicación de Meta configurada para WhatsApp Cloud API y un número autorizado.
- Una URL HTTPS pública para recibir eventos. Si n8n está alojado por cuenta propia detrás de un proxy o túnel, configura `WEBHOOK_URL` con la URL pública correcta. En n8n Cloud se utiliza la URL proporcionada por la plataforma.
- Un segundo número para el responsable, únicamente si se usarán avisos y comandos de revisión.

Los tipos y versiones de nodos se conservan en el JSON. La ejecución real debe comprobarse en la versión de n8n utilizada; las pruebas locales ejecutan la lógica JavaScript y no levantan un servidor n8n.

## Importación

En n8n crea un workflow e importa `workflows/whatsapp-service-agent.json` mediante **Import from File**. También puedes copiar el JSON completo y pegarlo en el lienzo, si tu versión admite esa operación. La plantilla se distribuye desactivada.

## Tablas

Crea dos Data Tables: por ejemplo, `agent_sessions` y `agent_requests`. Ambas necesitan las siguientes columnas de tipo **string**, respetando mayúsculas y nombres:

| Columna | Uso |
| --- | --- |
| `Telefono` | Identificador canónico del remitente, con formato `whatsapp:+...` |
| `Cliente` | Nombre capturado o nombre del perfil |
| `Intencion` | `_sesion` para sesiones; `tipo:ID-del-evento` para solicitudes |
| `Mensaje` | Estado o solicitud serializados como JSON |
| `Respuesta` | Respuesta generada para esa operación |
| `Fecha` | Fecha ISO de la última escritura |
| `Estado` | `Sesion`, `Pendiente`, `Confirmado` o `Rechazado` |

Copia el ID de cada tabla al nodo **Configurar negocio**. **Leer sesion** y **Guardar sesion** utilizan `sessionsTableId`; **Leer solicitudes** y **Guardar solicitud** utilizan `requestsTableId`. Los nodos ya contienen expresiones que leen esos valores. Si el editor muestra una tabla sin resolver, confirma el ID y vuelve a cargar el esquema de columnas del nodo.

## Configurar negocio

| Campo del nodo | Valor que debes proporcionar |
| --- | --- |
| `businessPhone` | Número del bot con código de país, preferentemente solo dígitos |
| `managerPhone` | Número autorizado del responsable; vacío para guardar sin avisos |
| `sessionsTableId` | ID de tu tabla de sesiones |
| `requestsTableId` | ID de tu tabla de solicitudes |
| `businessConfigJson` | JSON basado en `config/business.example.json` |

Personaliza `businessName`, `timeZone`, `hours`, `address`, `mapsUrl`, `catalogUrl` y `catalog`. Los datos comerciales del ejemplo están vacíos. Un elemento de catálogo puede usar la estructura `{"name":"Producto de demostración","price":100,"currency":"MXN"}`; estos valores son ilustrativos y no forman un cálculo automático del pedido.

Los formularios se definen en `forms`. Cada uno necesita `title`, `aliases` y una lista ordenada de `fields`. Un campo contiene `key`, `label`, `type` y `question`. Tipos disponibles: `name`, `text`, `date`, `time`, `choice`, `number`, `email`, `rfc` y `documents`. `sensitive: true` excluye el campo de los avisos resumidos al responsable.

El formulario de factura es un ejemplo para México. La validación de RFC verifica su formato; no consulta registros fiscales. Ajusta o retira ese formulario para otros países.

Para cambios privados, modifica `businessConfigJson` en tu instancia de n8n. `config/business.local.json` está excluido de Git para facilitar trabajo local, pero el generador público utiliza exclusivamente `business.example.json`. No publiques exportaciones que contengan la configuración privada.

## Credenciales de Meta

| Nodo | Tipo de credencial de n8n | Datos requeridos |
| --- | --- | --- |
| **Recibir WhatsApp Meta** | `WhatsApp OAuth API` / WhatsApp OAuth account | Client ID (App ID) y Client Secret (App Secret) |
| **Enviar por Meta** | `WhatsApp API` / WhatsApp account | Access Token y Business Account ID |

Los nombres visibles pueden variar según la versión o idioma del editor. Son dos tipos distintos de credencial, como describe la [documentación oficial](https://docs.n8n.io/integrations/builtin/credentials/whatsapp/).

El **Phone Number ID** para enviar se obtiene de `metadata.phone_number_id` del evento, después de comprobar que `metadata.display_phone_number` corresponde a `businessPhone`. No confundas ese ID con el número telefónico o el Business Account ID.

## Webhook y prueba real

El nodo oficial registra el webhook de la aplicación. WhatsApp permite un único webhook por app: alternar entre prueba y producción cambia la URL registrada. Consulta la [documentación del trigger](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.whatsapptrigger/) y usa una aplicación de prueba independiente cuando haya tráfico real.

Ejecuta **Execute workflow** o escucha el evento de prueba, y escribe desde otro WhatsApp. Revisa cada nodo en **Executions**. Cuando las pruebas pasen, activa o publica el workflow según tu versión de n8n y comprueba nuevamente el recorrido con el webhook de producción.

Los avisos al responsable y al cliente son textos ordinarios. Esta plantilla no prepara mensajes de plantilla para iniciar conversaciones fuera de una ventana válida de WhatsApp; ese caso requiere una integración adicional.
