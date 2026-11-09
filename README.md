# TRENO

Catálogo y pedidos de TRENO: página estática (`public/`), API en Python (`api/index.py`) y base de datos Neon, desplegados en Vercel.

## Variables de entorno

- `DATABASE_URL`: la crea la integración de Neon en Vercel.
- `ADMIN_USERNAME`: usuario del panel `/admin` (por defecto, `admin`).
- `ADMIN_PASSWORD`: contraseña del panel `/admin`.
- `ADMIN_SESSION_SECRET`: clave con la que se firman las sesiones del panel.

### Bot de WhatsApp (`/api/whatsapp`, código en `api/whatsapp_bot.py`)

- `WHATSAPP_VERIFY_TOKEN`: texto que inventas y repites en Meta al configurar el webhook.
- `WHATSAPP_APP_SECRET`: clave secreta de la app de Meta; con ella se comprueba que los mensajes vienen de Meta.
- `WHATSAPP_TOKEN`: token de acceso permanente (usuario del sistema) de WhatsApp Cloud API.
- `WHATSAPP_PHONE_NUMBER_ID`: identificador del número en WhatsApp Manager.
- `ANTHROPIC_API_KEY`: clave de la API de Claude.
- Opcionales: `WHATSAPP_BOT_MODEL` (por defecto `claude-opus-5-5`), `WHATSAPP_BOT_DAILY_LIMIT` (respuestas de IA por día, por defecto 400), `WHATSAPP_GRAPH_VERSION`.

El bot responde con el catálogo en stock. Pasa el chat a una persona (se calla 12 horas para ese cliente) si el cliente pide un asesor, pregunta por un pedido o un pago, envía una foto o un archivo, escribe más de 20 mensajes en una hora, o si el dueño responde desde la app. Los chats se guardan 7 días.

## Desarrollo local

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
DATABASE_URL=... ADMIN_PASSWORD=... ADMIN_SESSION_SECRET=... .venv/bin/python scripts/dev_server.py
```

`scripts/migrate.py` aplica `db/schema.sql`; se puede ejecutar más de una vez.

## Excel

En `/admin`, sección Productos: **Exportar Excel** descarga los productos y **Importar Excel** muestra los cambios antes de aplicarlos. Si hay errores no se aplica nada. El importe no elimina productos ni fotos.

## Imágenes

Van en `public/assets/img/`, con los nombres de la columna `image` de `db/schema.sql` y los que usa `public/index.html`.
