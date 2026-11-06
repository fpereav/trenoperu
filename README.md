# TRENO

Catálogo y pedidos de TRENO: página estática (`public/`), API en Python (`api/index.py`) y base de datos Neon, desplegados en Vercel.

## Variables de entorno

- `DATABASE_URL`: la crea la integración de Neon en Vercel.
- `ADMIN_USERNAME`: usuario del panel `/admin` (por defecto, `admin`).
- `ADMIN_PASSWORD`: contraseña del panel `/admin`.
- `ADMIN_SESSION_SECRET`: clave con la que se firman las sesiones del panel.

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
