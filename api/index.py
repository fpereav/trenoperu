"""TRENO API: catalog, order creation and the admin panel endpoints."""
import hashlib
import hmac
import html
import io
import json
import os
import re
import secrets
import ssl
import sys
import time
import traceback
import unicodedata
import zipfile
from http.server import BaseHTTPRequestHandler
from urllib.parse import unquote, urlsplit

import pg8000.native

MAX_BODY_BYTES = 20_000
MAX_LINES = 30
MAX_QTY = 20
MAX_STOCK = 100_000
MAX_IMAGE_BYTES = 2_000_000
MAIN_SLOT = "principal"
MAX_PHOTOS_PER_SLOT = 10
COLOR_NAMES = {
    "rosado": "Rosado", "negro": "Negro", "rojo": "Rojo", "morado": "Morado", "plomo": "Plomo", "verde": "Verde",
    "fucsia": "Fucsia", "marino": "Azul marino", "azul": "Azul", "celeste": "Celeste", "naranja": "Naranja",
    "amarillo": "Amarillo",
}
EXCEL_COLUMNS = (
    "ID", "Nombre", "Categoría", "Presentación", "Precio (S/)", "Descuento (S/)",
    "Precio final (S/)", "Stock", "Colores", "Descripción",
)
EXCEL_REQUIRED = ("ID", "Nombre", "Categoría", "Presentación", "Precio (S/)", "Descuento (S/)", "Stock", "Colores", "Descripción")
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_EXCEL_BYTES = 3_000_000
MAX_EXCEL_UNZIPPED = 40_000_000
MAX_EXCEL_ROWS = 2000
MAX_EXCEL_CHANGES_SHOWN = 300
VARIANT_LABEL_MAX = 40
MAX_VARIANTS_PER_PRODUCT = 30
# On sale: an option with stock if the product has options, otherwise its own stock.
ON_SALE_SQL = (
    "CASE WHEN EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id) "
    "THEN EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0) "
    "ELSE p.stock > 0 END"
)
SITE_URL = os.environ.get("SITE_URL", "https://trenoperu.vercel.app").rstrip("/")
IMAGES_WITHOUT_FILE = {"roller-pvc.jpg"}
COLOR_KEYS = (
    "rosado", "negro", "rojo", "morado", "plomo", "verde",
    "fucsia", "marino", "azul", "celeste", "naranja", "amarillo",
)
ORDERS_PER_IP_PER_HOUR = 5
SESSION_SECONDS = 12 * 60 * 60
COOKIE = "treno_admin"
LOCAL_HOSTS = ("127.0.0.1", "localhost")
STATUSES = ("pendiente", "pagado", "entregado", "cancelado")
PHONE_RE = re.compile(r"^[0-9+() \-]{7,20}$")
MAX_PRICE_CENTS = 10_000_000
PRODUCT_CATEGORY_MAX = 40
PRODUCT_NAME_MAX = 120
PRODUCT_DESCRIPTION_MAX = 500
FIELD_LIMITS = {"name": 120, "phone": 20, "address": 240, "city": 80, "notes": 500}


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def connect():
    url = urlsplit(os.environ["DATABASE_URL"])
    return pg8000.native.Connection(
        user=unquote(url.username),
        password=unquote(url.password),
        host=url.hostname,
        port=url.port or 5432,
        database=url.path.lstrip("/"),
        ssl_context=None if url.hostname in LOCAL_HOSTS else ssl.create_default_context(),
        timeout=15,
    )


def rows(conn, sql, **params):
    result = conn.run(sql, **params)
    names = [column["name"] for column in conn.columns]
    return [dict(zip(names, row)) for row in result]


def discount_percent(price_cents, discount_cents):
    return round(discount_cents * 100 / price_cents, 2) if price_cents else 0


def uploaded_photos(conn):
    photos = {}
    for row in rows(conn, "SELECT id, product_id, slot FROM product_images ORDER BY id"):
        slots = photos.setdefault(row["product_id"], {})
        slots.setdefault(row["slot"], []).append({"id": row["id"], "url": f"/api/images/{row['id']}"})
    return photos


def variants_by_product(conn, only_in_stock=False):
    where = "WHERE stock > 0 " if only_in_stock else ""
    grouped = {}
    for row in rows(
        conn,
        "SELECT id, product_id, label, price_cents, discount_cents, stock FROM product_variants "
        + where + "ORDER BY id",
    ):
        grouped.setdefault(row["product_id"], []).append(row)
    return grouped


def public_prices(price_cents, discount_cents):
    return {
        "price": (price_cents - discount_cents) / 100,
        "listPrice": price_cents / 100,
        "discountPercent": discount_percent(price_cents, discount_cents),
    }


def list_products():
    conn = connect()
    try:
        products = rows(
            conn,
            "SELECT p.id, p.name, p.description, p.category, p.price_cents, p.discount_cents, "
            "p.image, p.colors, p.stock, p.top FROM products p "
            f"WHERE {ON_SALE_SQL} ORDER BY p.sort_order",
        )
        photos = uploaded_photos(conn)
        variants = variants_by_product(conn, only_in_stock=True)
    finally:
        conn.close()
    result = []
    for p in products:
        options = variants.get(p["id"], [])
        # With options, the product shows its lowest current price.
        cheapest = min(options, key=lambda v: v["price_cents"] - v["discount_cents"]) if options else p
        stock = sum(v["stock"] for v in options) if options else p["stock"]
        finals = {v["price_cents"] - v["discount_cents"] for v in options}
        result.append(dict(
            public_prices(cheapest["price_cents"], cheapest["discount_cents"]),
            id=p["id"],
            name=p["name"],
            description=p["description"],
            cat=p["category"],
            img=p["image"],
            photos=photos.get(p["id"], {}),
            colors=p["colors"],
            inStock=stock > 0,
            low=0 < stock <= 2,
            top=p["top"],
            priceFrom=len(finals) > 1,
            variants=[
                dict(public_prices(v["price_cents"], v["discount_cents"]),
                     id=v["id"], label=v["label"], low=v["stock"] <= 2)
                for v in options
            ],
        ))
    return result


def clean_customer(raw):
    if not isinstance(raw, dict):
        raise ApiError(400, "Faltan tus datos de contacto.")
    customer = {}
    for field, limit in FIELD_LIMITS.items():
        value = raw.get(field, "")
        if not isinstance(value, str):
            raise ApiError(400, "Revisa tus datos de contacto.")
        value = value.strip()
        if len(value) > limit:
            raise ApiError(400, "Alguno de tus datos es demasiado largo.")
        customer[field] = value
    if not (customer["name"] and customer["address"] and customer["city"]):
        raise ApiError(400, "Completa tu nombre, dirección y distrito o ciudad.")
    if not PHONE_RE.match(customer["phone"]):
        raise ApiError(400, "Revisa tu número de teléfono.")
    return customer


def clean_items(raw):
    if not isinstance(raw, list) or not raw or len(raw) > MAX_LINES:
        raise ApiError(400, "Tu carrito está vacío o no es válido.")
    merged = {}
    for item in raw:
        if not isinstance(item, dict):
            raise ApiError(400, "Tu carrito no es válido.")
        product_id, color, qty = item.get("id"), item.get("color"), item.get("qty")
        variant = item.get("variant")
        if not isinstance(product_id, str) or not isinstance(color, str):
            raise ApiError(400, "Tu carrito no es válido.")
        if variant is not None and (isinstance(variant, bool) or not isinstance(variant, int)):
            raise ApiError(400, "Tu carrito no es válido.")
        if isinstance(qty, bool) or not isinstance(qty, int) or not 1 <= qty <= MAX_QTY:
            raise ApiError(400, "Revisa las cantidades de tu carrito.")
        key = (product_id, variant, color)
        merged[key] = merged.get(key, 0) + qty
    return merged


def create_order(payload, client_ip):
    customer = clean_customer(payload.get("customer"))
    items = clean_items(payload.get("items"))
    ip_hash = hashlib.sha256(
        (os.environ.get("ADMIN_SESSION_SECRET", "") + client_ip).encode()
    ).hexdigest()

    conn = connect()
    try:
        conn.run("START TRANSACTION")
        recent = conn.run(
            "SELECT count(*) FROM orders WHERE ip_hash = :ip "
            "AND created_at > now() - interval '1 hour'",
            ip=ip_hash,
        )[0][0]
        if recent >= ORDERS_PER_IP_PER_HOUR:
            raise ApiError(429, "Recibimos varios pedidos seguidos. Llámanos al 957 503 022.")

        products = {}
        options = {}
        # Sorted locking keeps two concurrent checkouts from deadlocking.
        for product_id in sorted({key[0] for key in items}):
            found = rows(
                conn,
                "SELECT id, name, price_cents, discount_cents, colors, stock FROM products "
                "WHERE id = :id FOR UPDATE",
                id=product_id,
            )
            if not found:
                raise ApiError(409, "Uno de los productos ya no está disponible.")
            products[product_id] = found[0]
            options[product_id] = {
                v["id"]: v
                for v in rows(
                    conn,
                    "SELECT id, label, price_cents, discount_cents, stock FROM product_variants "
                    "WHERE product_id = :id ORDER BY id FOR UPDATE",
                    id=product_id,
                )
            }

        # Quantity per stock holder: the chosen option, or the product without options.
        wanted = {}
        total = 0
        lines = []
        for (product_id, variant_id, color), qty in items.items():
            product = products[product_id]
            if color not in product["colors"]:
                raise ApiError(400, "Revisa el color elegido.")
            product_options = options[product_id]
            if product_options:
                if variant_id not in product_options:
                    raise ApiError(409, "Elige de nuevo la presentación de " + product["name"] + ".")
                holder = product_options[variant_id]
            else:
                if variant_id is not None:
                    raise ApiError(409, "Elige de nuevo " + product["name"] + ".")
                holder = product
            # Customers pay the discounted price, whatever the browser sent.
            price = holder["price_cents"] - holder["discount_cents"]
            total += price * qty
            wanted[(product_id, variant_id)] = wanted.get((product_id, variant_id), 0) + qty
            lines.append((product, holder, variant_id, color, price, qty))

        for (product_id, variant_id), qty in wanted.items():
            holder = options[product_id][variant_id] if variant_id is not None else products[product_id]
            if holder["stock"] < qty:
                label = products[product_id]["name"]
                if variant_id is not None:
                    label += " " + holder["label"]
                raise ApiError(409, "No hay stock suficiente de " + label + ".")

        order_id = conn.run(
            "INSERT INTO orders (customer_name, phone, address, city, notes, total_cents, ip_hash) "
            "VALUES (:name, :phone, :address, :city, :notes, :total, :ip) RETURNING id",
            total=total,
            ip=ip_hash,
            **customer,
        )[0][0]
        for product, holder, variant_id, color, price, qty in lines:
            params = dict(
                order_id=order_id,
                product_id=product["id"],
                name=product["name"],
                color=color,
                price=price,
                qty=qty,
            )
            if variant_id is None:
                conn.run(
                    "INSERT INTO order_items "
                    "(order_id, product_id, product_name, color, unit_price_cents, quantity) "
                    "VALUES (:order_id, :product_id, :name, :color, :price, :qty)",
                    **params,
                )
            else:
                conn.run(
                    "INSERT INTO order_items (order_id, product_id, product_name, color, "
                    "unit_price_cents, quantity, variant_id, variant_label) "
                    "VALUES (:order_id, :product_id, :name, :color, :price, :qty, :variant, :label)",
                    variant=variant_id,
                    label=holder["label"],
                    **params,
                )
        for (product_id, variant_id), qty in wanted.items():
            if variant_id is None:
                conn.run("UPDATE products SET stock = stock - :qty WHERE id = :id", qty=qty, id=product_id)
            else:
                conn.run("UPDATE product_variants SET stock = stock - :qty WHERE id = :id", qty=qty, id=variant_id)
        conn.run("COMMIT")
    except Exception:
        conn.run("ROLLBACK")
        raise
    finally:
        conn.close()
    return {"order": order_id, "total": total / 100}


def admin_orders():
    conn = connect()
    try:
        orders = rows(
            conn,
            "SELECT o.id, o.created_at, o.status, o.customer_name, o.phone, o.address, o.city, "
            "o.notes, o.total_cents, json_agg(json_build_object("
            "'name', i.product_name, 'variant', i.variant_label, 'color', i.color, 'qty', i.quantity, "
            "'price', i.unit_price_cents) ORDER BY i.id) AS items "
            "FROM orders o JOIN order_items i ON i.order_id = o.id "
            "GROUP BY o.id ORDER BY o.created_at DESC LIMIT 500",
        )
    finally:
        conn.close()
    return [
        {
            "id": o["id"],
            "createdAt": o["created_at"].isoformat(),
            "status": o["status"],
            "name": o["customer_name"],
            "phone": o["phone"],
            "address": o["address"],
            "city": o["city"],
            "notes": o["notes"],
            "total": o["total_cents"] / 100,
            "items": [
                {"name": (i["name"] + " " + i["variant"]).strip(), "color": i["color"], "qty": i["qty"],
                 "price": i["price"] / 100}
                for i in o["items"]
            ],
        }
        for o in orders
    ]


def set_order_status(order_id, status):
    if status not in STATUSES:
        raise ApiError(400, "Estado no válido.")
    conn = connect()
    try:
        conn.run("START TRANSACTION")
        found = conn.run("SELECT status FROM orders WHERE id = :id FOR UPDATE", id=order_id)
        if not found:
            raise ApiError(404, "Pedido no encontrado.")
        current = found[0][0]
        if current == "cancelado" and status != "cancelado":
            raise ApiError(409, "Un pedido cancelado no se puede reabrir: su stock ya se devolvió.")
        if status == "cancelado" and current != "cancelado":
            conn.run(
                "UPDATE products p SET stock = p.stock + i.quantity FROM ("
                "SELECT product_id, sum(quantity)::int AS quantity FROM order_items "
                "WHERE order_id = :id AND variant_label = '' GROUP BY product_id) i "
                "WHERE p.id = i.product_id",
                id=order_id,
            )
            # An option deleted since the sale has nowhere to return its stock.
            conn.run(
                "UPDATE product_variants v SET stock = v.stock + i.quantity FROM ("
                "SELECT variant_id, sum(quantity)::int AS quantity FROM order_items "
                "WHERE order_id = :id AND variant_id IS NOT NULL GROUP BY variant_id) i "
                "WHERE v.id = i.variant_id",
                id=order_id,
            )
        conn.run("UPDATE orders SET status = :status WHERE id = :id", status=status, id=order_id)
        conn.run("COMMIT")
    except Exception:
        conn.run("ROLLBACK")
        raise
    finally:
        conn.close()
    return {"id": order_id, "status": status}


def admin_products():
    conn = connect()
    try:
        products = rows(
            conn,
            "SELECT id, name, description, category, price_cents, discount_cents, stock, image, colors "
            "FROM products ORDER BY sort_order",
        )
        photos = uploaded_photos(conn)
        variants = variants_by_product(conn)
    finally:
        conn.close()
    return [
        {"id": p["id"], "name": p["name"], "description": p["description"], "cat": p["category"],
         "variants": [admin_variant(v) for v in variants.get(p["id"], [])],
         "price": p["price_cents"] / 100, "discount": p["discount_cents"] / 100,
         "stock": p["stock"], "img": p["image"],
         "colors": p["colors"], "photos": photos.get(p["id"], {})}
        for p in products
    ]


def clean_product_text(payload):
    name, description = payload.get("name"), payload.get("description")
    if not isinstance(name, str) or not isinstance(description, str):
        raise ApiError(400, "Revisa el nombre y la descripción.")
    name, description = name.strip(), description.strip()
    if not name:
        raise ApiError(400, "El producto debe tener un nombre.")
    if len(name) > PRODUCT_NAME_MAX:
        raise ApiError(400, f"El nombre admite hasta {PRODUCT_NAME_MAX} caracteres.")
    if len(description) > PRODUCT_DESCRIPTION_MAX:
        raise ApiError(400, f"La descripción admite hasta {PRODUCT_DESCRIPTION_MAX} caracteres.")
    return name, description


def clean_category(value):
    category = value.strip() if isinstance(value, str) else ""
    if not category or len(category) > PRODUCT_CATEGORY_MAX:
        raise ApiError(400, f"Escribe una categoría de hasta {PRODUCT_CATEGORY_MAX} caracteres.")
    return category


def clean_price_cents(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(400, "Escribe un precio válido.")
    cents = round(value * 100)
    if not 1 <= cents <= MAX_PRICE_CENTS:
        raise ApiError(400, "Escribe un precio mayor que 0 y hasta S/ 100000.")
    return cents


def clean_discount_cents(value, price_cents):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(400, "Escribe un descuento válido.")
    cents = round(value * 100)
    if not 0 <= cents < price_cents:
        raise ApiError(400, "El descuento debe ser menor que el precio.")
    return cents


def clean_colors(colors):
    if not isinstance(colors, list) or not all(isinstance(c, str) for c in colors):
        raise ApiError(400, "Revisa los colores.")
    if not colors:
        raise ApiError(400, "El producto debe tener al menos un color.")
    if len(set(colors)) != len(colors) or any(c not in COLOR_KEYS for c in colors):
        raise ApiError(400, "Revisa los colores.")
    return colors


def clean_stock(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_STOCK:
        raise ApiError(400, "Escribe una cantidad entera entre 0 y 100000.")
    return value


def default_description(name):
    return f"{name} para entrenar en casa, en el parque o donde quieras."[:PRODUCT_DESCRIPTION_MAX]


def create_product(payload):
    name, description = clean_product_text(payload)
    description = description or default_description(name)
    category = clean_category(payload.get("category"))
    price_cents = clean_price_cents(payload.get("price"))
    discount_cents = clean_discount_cents(payload.get("discount", 0), price_cents)
    stock = clean_stock(payload.get("stock"))
    colors = clean_colors(payload.get("colors"))
    product_id = "P" + secrets.token_hex(5).upper()
    conn = connect()
    try:
        rows_found = rows(
            conn,
            "INSERT INTO products (id, name, description, category, price_cents, discount_cents, image, colors, stock, sort_order) "
            "SELECT :id, :name, :description, :category, :price, :discount, '', CAST(:colors AS jsonb), :stock, "
            "coalesce(max(sort_order), 0) + 1 FROM products "
            "RETURNING id, name, description, category, price_cents, discount_cents, stock, image, colors",
            id=product_id,
            name=name,
            description=description,
            category=category,
            price=price_cents,
            discount=discount_cents,
            colors=json.dumps(colors),
            stock=stock,
        )
    finally:
        conn.close()
    p = rows_found[0]
    return {"id": p["id"], "name": p["name"], "description": p["description"], "cat": p["category"],
            "price": p["price_cents"] / 100, "discount": p["discount_cents"] / 100,
            "stock": p["stock"], "img": p["image"],
            "colors": p["colors"], "photos": {}, "variants": []}


def set_product_details(product_id, payload):
    name, description = clean_product_text(payload)
    conn = connect()
    try:
        found = rows(conn, "SELECT category, price_cents, discount_cents FROM products WHERE id = :id", id=product_id)
        if not found:
            raise ApiError(404, "Producto no encontrado.")
        category = clean_category(payload["category"]) if "category" in payload else found[0]["category"]
        price_cents = clean_price_cents(payload["price"]) if "price" in payload else found[0]["price_cents"]
        discount_cents = clean_discount_cents(
            payload["discount"] if "discount" in payload else found[0]["discount_cents"] / 100,
            price_cents,
        )
        conn.run(
            "UPDATE products SET name = :name, description = :description, category = :category, "
            "price_cents = :price, discount_cents = :discount WHERE id = :id",
            name=name,
            description=description,
            category=category,
            price=price_cents,
            discount=discount_cents,
            id=product_id,
        )
    finally:
        conn.close()
    return {"id": product_id, "name": name, "description": description, "cat": category,
            "price": price_cents / 100, "discount": discount_cents / 100}


def product_colors(conn, product_id):
    found = conn.run("SELECT colors FROM products WHERE id = :id", id=product_id)
    if not found:
        raise ApiError(404, "Producto no encontrado.")
    return found[0][0]


def photos_of(conn, product_id):
    return uploaded_photos(conn).get(product_id, {})


def set_product_colors(product_id, payload):
    colors = clean_colors(payload.get("colors"))
    conn = connect()
    try:
        conn.run("START TRANSACTION")
        product_colors(conn, product_id)
        conn.run(
            "UPDATE products SET colors = CAST(:colors AS jsonb) WHERE id = :id",
            colors=json.dumps(colors),
            id=product_id,
        )
        # Photos of a removed color can no longer be shown, so they go with it.
        for row in rows(conn, "SELECT DISTINCT slot FROM product_images WHERE product_id = :id", id=product_id):
            if row["slot"] != MAIN_SLOT and row["slot"] not in colors:
                conn.run(
                    "DELETE FROM product_images WHERE product_id = :id AND slot = :slot",
                    id=product_id,
                    slot=row["slot"],
                )
        conn.run("COMMIT")
        return {"id": product_id, "colors": colors, "photos": photos_of(conn, product_id)}
    except Exception:
        conn.run("ROLLBACK")
        raise
    finally:
        conn.close()


def add_product_photo(product_id, slot, data):
    if not data.startswith(b"\xff\xd8\xff"):
        raise ApiError(415, "La foto debe enviarse como JPG.")
    conn = connect()
    try:
        colors = product_colors(conn, product_id)
        if slot != MAIN_SLOT and slot not in colors:
            raise ApiError(400, "Ese color no pertenece al producto.")
        count = conn.run(
            "SELECT count(*) FROM product_images WHERE product_id = :id AND slot = :slot",
            id=product_id,
            slot=slot,
        )[0][0]
        if count >= MAX_PHOTOS_PER_SLOT:
            raise ApiError(409, f"Cada grupo admite hasta {MAX_PHOTOS_PER_SLOT} fotos.")
        conn.run(
            "INSERT INTO product_images (product_id, slot, data) VALUES (:id, :slot, :data)",
            id=product_id,
            slot=slot,
            data=data,
        )
        return {"id": product_id, "photos": photos_of(conn, product_id)}
    finally:
        conn.close()


def delete_product_photo(product_id, image_id):
    conn = connect()
    try:
        product_colors(conn, product_id)
        deleted = conn.run(
            "DELETE FROM product_images WHERE id = :image AND product_id = :id RETURNING id",
            image=image_id,
            id=product_id,
        )
        if not deleted:
            raise ApiError(404, "Foto no encontrada.")
        return {"id": product_id, "photos": photos_of(conn, product_id)}
    finally:
        conn.close()


def read_product_photo(image_id):
    conn = connect()
    try:
        found = conn.run("SELECT data FROM product_images WHERE id = :image", image=image_id)
    finally:
        conn.close()
    if not found:
        raise ApiError(404, "Foto no encontrada.")
    return bytes(found[0][0])


def admin_variant(v):
    return {"id": v["id"], "label": v["label"], "price": v["price_cents"] / 100,
            "discount": v["discount_cents"] / 100, "stock": v["stock"]}


def clean_variant(payload):
    label = payload.get("label")
    label = label.strip() if isinstance(label, str) else ""
    if not label or len(label) > VARIANT_LABEL_MAX:
        raise ApiError(400, f"Escribe la presentación, de hasta {VARIANT_LABEL_MAX} caracteres. Ejemplo: 10 kg.")
    price_cents = clean_price_cents(payload.get("price"))
    return label, price_cents, clean_discount_cents(payload.get("discount", 0), price_cents), clean_stock(payload.get("stock"))


def variants_of(conn, product_id):
    return [admin_variant(v) for v in variants_by_product(conn).get(product_id, [])]


def add_product_variant(product_id, payload):
    label, price_cents, discount_cents, stock = clean_variant(payload)
    conn = connect()
    try:
        product_colors(conn, product_id)
        existing = variants_of(conn, product_id)
        if len(existing) >= MAX_VARIANTS_PER_PRODUCT:
            raise ApiError(409, f"Cada producto admite hasta {MAX_VARIANTS_PER_PRODUCT} presentaciones.")
        if any(v["label"].lower() == label.lower() for v in existing):
            raise ApiError(409, "Ya existe esa presentación.")
        conn.run(
            "INSERT INTO product_variants (product_id, label, price_cents, discount_cents, stock) "
            "VALUES (:id, :label, :price, :discount, :stock)",
            id=product_id,
            label=label,
            price=price_cents,
            discount=discount_cents,
            stock=stock,
        )
        return {"id": product_id, "variants": variants_of(conn, product_id)}
    finally:
        conn.close()


def update_product_variant(product_id, variant_id, payload):
    label, price_cents, discount_cents, stock = clean_variant(payload)
    expected = clean_stock(payload.get("expected"))
    conn = connect()
    try:
        found = conn.run(
            "SELECT stock FROM product_variants WHERE id = :variant AND product_id = :id",
            variant=variant_id,
            id=product_id,
        )
        if not found:
            raise ApiError(404, "Presentación no encontrada.")
        if any(v["id"] != variant_id and v["label"].lower() == label.lower() for v in variants_of(conn, product_id)):
            raise ApiError(409, "Ya existe esa presentación.")
        # Only update if unchanged, so a sale made meanwhile is never overwritten.
        updated = conn.run(
            "UPDATE product_variants SET label = :label, price_cents = :price, discount_cents = :discount, "
            "stock = :stock WHERE id = :variant AND stock = :expected RETURNING id",
            label=label,
            price=price_cents,
            discount=discount_cents,
            stock=stock,
            variant=variant_id,
            expected=expected,
        )
        if not updated:
            current = conn.run("SELECT stock FROM product_variants WHERE id = :variant", variant=variant_id)[0][0]
            raise ApiError(409, "El stock cambió mientras editabas. Revisa la cantidad actual: " + str(current) + ".")
        return {"id": product_id, "variants": variants_of(conn, product_id)}
    finally:
        conn.close()


def delete_product_variant(product_id, variant_id):
    conn = connect()
    try:
        deleted = conn.run(
            "DELETE FROM product_variants WHERE id = :variant AND product_id = :id RETURNING id",
            variant=variant_id,
            id=product_id,
        )
        if not deleted:
            raise ApiError(404, "Presentación no encontrada.")
        return {"id": product_id, "variants": variants_of(conn, product_id)}
    finally:
        conn.close()


def colors_to_text(colors):
    return ", ".join(COLOR_NAMES.get(color, color) for color in colors)


def export_excel():
    # Imported here so public pages don't pay for loading it on a cold start.
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    conn = connect()
    try:
        products = rows(
            conn,
            "SELECT id, name, description, category, price_cents, discount_cents, stock, colors "
            "FROM products ORDER BY sort_order",
        )
        variants = variants_by_product(conn)
    finally:
        conn.close()

    book = Workbook()
    sheet = book.active
    sheet.title = "Productos"
    sheet.append(EXCEL_COLUMNS)
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="111111")
    sheet.freeze_panes = "A2"
    for column, width in zip("ABCDEFGHIJ", (16, 38, 16, 16, 12, 14, 16, 8, 30, 50)):
        sheet.column_dimensions[column].width = width

    def add_row(p, label, holder):
        values = (
            p["id"], p["name"], p["category"], label, holder["price_cents"] / 100, holder["discount_cents"] / 100,
            (holder["price_cents"] - holder["discount_cents"]) / 100, holder["stock"],
            colors_to_text(p["colors"]), p["description"],
        )
        sheet.append(values)
        # Text stays text: a name starting with "=" must not become a formula in Excel.
        for cell in sheet[sheet.max_row]:
            if isinstance(cell.value, str):
                cell.data_type = "s"

    for p in products:
        options = variants.get(p["id"], [])
        if options:
            for option in options:
                add_row(p, option["label"], option)
        else:
            add_row(p, "", p)

    help_sheet = book.create_sheet("Instrucciones")
    help_sheet.column_dimensions["A"].width = 110
    for line in (
        "Edita la hoja Productos y vuelve a importarla desde el admin. Antes de aplicar verás los cambios.",
        "Producto nuevo: deja ID vacío. Si tiene varias presentaciones, usa una fila por cada una con el mismo nombre.",
        "Presentación: peso o tamaño, por ejemplo 10 kg. Déjala vacía si el producto no tiene presentaciones.",
        "Presentación nueva: agrega una fila con el ID del producto y la nueva presentación.",
        "Colores: nombres separados por comas: " + ", ".join(COLOR_NAMES.values()) + ".",
        "Precio final es solo informativo: se calcula con Precio menos Descuento.",
        "El stock del archivo reemplaza al actual. Exporta de nuevo si hubo ventas desde tu última descarga.",
        "Quitar una fila no elimina el producto ni la presentación. Las fotos se gestionan en el admin.",
    ):
        help_sheet.append((line,))

    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


def plain_text(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def folded(text):
    decomposed = unicodedata.normalize("NFD", text.strip().lower())
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


def excel_number(value, label):
    if isinstance(value, bool):
        raise ApiError(400, f"{label} no es un número.")
    if isinstance(value, (int, float)):
        return value
    text = plain_text(value).replace("S/", "").replace(",", ".").strip()
    try:
        return float(text)
    except ValueError:
        raise ApiError(400, f"{label} no es un número.")


def excel_colors(text):
    by_name = {folded(name): key for key, name in COLOR_NAMES.items()}
    by_name.update({key: key for key in COLOR_NAMES})
    colors = []
    for part in text.split(","):
        if not part.strip():
            continue
        key = by_name.get(folded(part))
        if not key:
            raise ApiError(400, f"Color desconocido: {part.strip()}.")
        if key not in colors:
            colors.append(key)
    return colors


def read_excel_rows(data):
    from openpyxl import load_workbook

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(info.file_size for info in archive.infolist()) > MAX_EXCEL_UNZIPPED:
                raise ApiError(413, "El archivo es demasiado grande.")
        book = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        sheet = book.worksheets[0]
        table = list(sheet.iter_rows(values_only=True, max_row=MAX_EXCEL_ROWS + 2))
    except ApiError:
        raise
    except Exception:
        raise ApiError(400, "No se pudo leer el archivo. Usa un Excel .xlsx exportado desde el admin.")
    if not table:
        raise ApiError(400, "El archivo está vacío.")
    headers = {plain_text(name): index for index, name in enumerate(table[0]) if plain_text(name)}
    missing = [name for name in EXCEL_REQUIRED if name not in headers]
    if missing:
        raise ApiError(400, "Faltan columnas: " + ", ".join(missing) + ".")
    if len(table) > MAX_EXCEL_ROWS + 1:
        raise ApiError(400, f"El archivo admite hasta {MAX_EXCEL_ROWS} filas.")
    result = []
    for number, values in enumerate(table[1:], start=2):
        if all(plain_text(value) == "" for value in values):
            continue
        cell = lambda name: values[headers[name]] if headers[name] < len(values) else None
        result.append((number, {name: cell(name) for name in EXCEL_REQUIRED}))
    if not result:
        raise ApiError(400, "El archivo no tiene productos.")
    return result


def parse_excel_row(raw):
    product_id = plain_text(raw["ID"]).upper()
    name, description = clean_product_text({
        "name": plain_text(raw["Nombre"]),
        "description": plain_text(raw["Descripción"]),
    })
    category = clean_category(plain_text(raw["Categoría"]))
    label = plain_text(raw["Presentación"])
    if len(label) > VARIANT_LABEL_MAX:
        raise ApiError(400, f"La presentación admite hasta {VARIANT_LABEL_MAX} caracteres.")
    price_cents = clean_price_cents(excel_number(raw["Precio (S/)"], "Precio"))
    discount_raw = raw["Descuento (S/)"]
    discount = 0 if plain_text(discount_raw) == "" else excel_number(discount_raw, "Descuento")
    discount_cents = clean_discount_cents(discount, price_cents)
    stock_value = excel_number(raw["Stock"], "Stock")
    if float(stock_value) != int(stock_value):
        raise ApiError(400, "El stock debe ser un número entero.")
    return {
        "id": product_id, "name": name, "description": description, "category": category,
        "label": label, "price": price_cents, "discount": discount_cents,
        "stock": clean_stock(int(stock_value)), "colors": excel_colors(plain_text(raw["Colores"])),
    }


def money_text(cents):
    return f"S/ {cents / 100:.2f}"


def holder_changes(prefix, holder, row):
    changes = []
    if holder["price_cents"] != row["price"]:
        changes.append(f"{prefix}: precio {money_text(holder['price_cents'])} → {money_text(row['price'])}")
    if holder["discount_cents"] != row["discount"]:
        changes.append(f"{prefix}: descuento {money_text(holder['discount_cents'])} → {money_text(row['discount'])}")
    if holder["stock"] != row["stock"]:
        changes.append(f"{prefix}: stock {holder['stock']} → {row['stock']}")
    return changes


def import_excel(data, apply_changes):
    table = read_excel_rows(data)
    errors = []
    parsed = []
    for number, raw in table:
        try:
            parsed.append((number, parse_excel_row(raw)))
        except ApiError as error:
            errors.append({"row": number, "message": error.message})

    conn = connect()
    try:
        conn.run("START TRANSACTION")
        products = {
            p["id"]: p
            for p in rows(
                conn,
                "SELECT id, name, description, category, price_cents, discount_cents, stock, colors "
                "FROM products ORDER BY id FOR UPDATE",
            )
        }
        variants = {}
        for option in rows(
            conn,
            "SELECT id, product_id, label, price_cents, discount_cents, stock FROM product_variants "
            "ORDER BY id FOR UPDATE",
        ):
            variants.setdefault(option["product_id"], []).append(option)
        names = {folded(p["name"]): p["id"] for p in products.values()}

        groups = {}
        for number, row in parsed:
            key = row["id"] or "nuevo:" + folded(row["name"])
            groups.setdefault(key, []).append((number, row))

        changes = []
        created = updated = 0
        for key, group in groups.items():
            first_number, first = group[0]
            group_errors = []
            # Later rows may leave description and colors empty to share the product's.
            for field in ("description", "colors"):
                first[field] = next((row[field] for _, row in group if row[field]), first[field])
            for number, row in group[1:]:
                for field, label in (("name", "Nombre"), ("category", "Categoría"), ("description", "Descripción"), ("colors", "Colores")):
                    if row[field] != first[field] and (row[field] or field in ("name", "category")):
                        group_errors.append({"row": number, "message": f"{label} distinto al de la fila {first_number} del mismo producto."})
            labels = [folded(row["label"]) for _, row in group]
            if any(labels) and not all(labels):
                group_errors.append({"row": first_number, "message": "Todas las filas del producto deben indicar su presentación."})
            if len(group) > 1 and not all(labels):
                group_errors.append({"row": first_number, "message": "Este producto se repite sin indicar presentación."})
            for index, (number, row) in enumerate(group):
                if labels[index] and labels[index] in labels[:index]:
                    group_errors.append({"row": number, "message": "Presentación repetida."})

            is_new = not first["id"]
            if is_new:
                if folded(first["name"]) in names:
                    group_errors.append({"row": first_number, "message": "Ya existe un producto con ese nombre. Escribe su ID para actualizarlo."})
                if not first["colors"]:
                    group_errors.append({"row": first_number, "message": "Indica al menos un color."})
                current = None
            else:
                current = products.get(first["id"])
                if not current:
                    group_errors.append({"row": first_number, "message": "ID desconocido. Déjalo vacío para crear un producto nuevo."})
                else:
                    owner = names.get(folded(first["name"]))
                    if owner and owner != first["id"]:
                        group_errors.append({"row": first_number, "message": "Otro producto ya usa ese nombre."})
                    if variants.get(first["id"]) and not all(labels):
                        group_errors.append({"row": first_number, "message": "Este producto tiene presentaciones: indica cuál es en cada fila."})
            existing_labels = {folded(v["label"]) for v in variants.get(first["id"], [])}
            if len(existing_labels | set(filter(None, labels))) > MAX_VARIANTS_PER_PRODUCT:
                group_errors.append({"row": first_number, "message": f"Máximo {MAX_VARIANTS_PER_PRODUCT} presentaciones por producto."})
            if group_errors:
                errors.extend(group_errors)
                continue

            has_options = all(labels)
            if is_new:
                created += 1
                product_id = "P" + secrets.token_hex(5).upper()
                changes.append("Nuevo producto: " + first["name"])
                names[folded(first["name"])] = product_id
                if apply_changes:
                    conn.run(
                        "INSERT INTO products (id, name, description, category, price_cents, discount_cents, image, colors, stock, sort_order) "
                        "SELECT :id, :name, :description, :category, :price, :discount, '', CAST(:colors AS jsonb), :stock, "
                        "coalesce(max(sort_order), 0) + 1 FROM products",
                        id=product_id,
                        name=first["name"],
                        description=first["description"] or default_description(first["name"]),
                        category=first["category"],
                        price=first["price"],
                        discount=first["discount"],
                        colors=json.dumps(first["colors"]),
                        stock=0 if has_options else first["stock"],
                    )
            else:
                product_id = first["id"]
                colors = first["colors"] or current["colors"]
                product_changes = []
                if current["name"] != first["name"]:
                    product_changes.append(f"{current['name']}: nombre → {first['name']}")
                if current["category"] != first["category"]:
                    product_changes.append(f"{first['name']}: categoría {current['category']} → {first['category']}")
                if current["description"] != first["description"]:
                    product_changes.append(f"{first['name']}: descripción actualizada")
                if current["colors"] != colors:
                    product_changes.append(f"{first['name']}: colores {colors_to_text(current['colors'])} → {colors_to_text(colors)}")
                if not has_options:
                    product_changes.extend(holder_changes(first["name"], current, first))
                if product_changes:
                    updated += 1
                changes.extend(product_changes)
                if product_changes and apply_changes:
                    conn.run(
                        "UPDATE products SET name = :name, description = :description, category = :category, "
                        "colors = CAST(:colors AS jsonb), price_cents = :price, discount_cents = :discount, stock = :stock "
                        "WHERE id = :id",
                        id=product_id,
                        name=first["name"],
                        description=first["description"],
                        category=first["category"],
                        colors=json.dumps(colors),
                        price=first["price"] if not has_options else current["price_cents"],
                        discount=first["discount"] if not has_options else current["discount_cents"],
                        stock=first["stock"] if not has_options else current["stock"],
                    )

            if has_options:
                existing = {folded(v["label"]): v for v in variants.get(product_id, [])}
                for _, row in group:
                    option = existing.get(folded(row["label"]))
                    prefix = f"{first['name']} {row['label']}"
                    if option:
                        option_changes = holder_changes(prefix, option, row)
                        if option_changes:
                            changes.extend(option_changes)
                            if not is_new and not any(c.startswith(first["name"] + ":") for c in changes[-len(option_changes):]):
                                updated += 1
                            if apply_changes:
                                conn.run(
                                    "UPDATE product_variants SET price_cents = :price, discount_cents = :discount, "
                                    "stock = :stock WHERE id = :option",
                                    price=row["price"],
                                    discount=row["discount"],
                                    stock=row["stock"],
                                    option=option["id"],
                                )
                    else:
                        changes.append("Nueva presentación: " + prefix)
                        if apply_changes:
                            conn.run(
                                "INSERT INTO product_variants (product_id, label, price_cents, discount_cents, stock) "
                                "VALUES (:id, :label, :price, :discount, :stock)",
                                id=product_id,
                                label=row["label"],
                                price=row["price"],
                                discount=row["discount"],
                                stock=row["stock"],
                            )

        errors.sort(key=lambda error: error["row"])
        applied = apply_changes and not errors
        conn.run("COMMIT" if applied else "ROLLBACK")
    except Exception:
        conn.run("ROLLBACK")
        raise
    finally:
        conn.close()
    return {
        "applied": applied,
        "errors": errors[:MAX_EXCEL_CHANGES_SHOWN],
        "errorCount": len(errors),
        "changes": changes[:MAX_EXCEL_CHANGES_SHOWN],
        "changeCount": len(changes),
        "created": created,
        "rows": len(table),
    }


def set_product_stock(product_id, payload):
    stock, expected = clean_stock(payload.get("stock")), clean_stock(payload.get("expected"))
    conn = connect()
    try:
        # Only update if unchanged, so a sale made meanwhile is never overwritten.
        updated = conn.run(
            "UPDATE products SET stock = :stock WHERE id = :id AND stock = :expected RETURNING stock",
            stock=stock,
            id=product_id,
            expected=expected,
        )
        if updated:
            return {"id": product_id, "stock": updated[0][0]}
        found = conn.run("SELECT stock FROM products WHERE id = :id", id=product_id)
    finally:
        conn.close()
    if not found:
        raise ApiError(404, "Producto no encontrado.")
    raise ApiError(409, "El stock cambió mientras editabas. Revisa la cantidad actual: " + str(found[0][0]) + ".")


def product_for_page(product_id):
    conn = connect()
    try:
        found = rows(
            conn,
            "SELECT p.id, p.name, p.description, p.category, p.price_cents, p.discount_cents, p.image, p.colors "
            f"FROM products p WHERE p.id = :id AND {ON_SALE_SQL}",
            id=product_id,
        )
        photos = photos_of(conn, product_id) if found else {}
        options = variants_by_product(conn, only_in_stock=True).get(product_id, []) if found else []
    finally:
        conn.close()
    if not found:
        return None, None
    product = found[0]
    product["options"] = options
    for slot in [MAIN_SLOT] + list(product["colors"]):
        if photos.get(slot):
            return product, SITE_URL + photos[slot][0]["url"]
    if not product["image"] or product["image"] in IMAGES_WITHOUT_FILE:
        return product, None
    return product, f"{SITE_URL}/assets/img/{product['image']}"


def product_page(product_id):
    product, image = product_for_page(product_id)
    if not product:
        return None
    url = f"{SITE_URL}/producto/{product['id']}"
    name = product["name"]
    options = product["options"]
    cheapest = min(options, key=lambda v: v["price_cents"] - v["discount_cents"]) if options else product
    finals = [v["price_cents"] - v["discount_cents"] for v in options]
    price = f"{(cheapest['price_cents'] - cheapest['discount_cents']) / 100:.2f}"
    was = ""
    if cheapest["discount_cents"]:
        percent = discount_percent(cheapest["price_cents"], cheapest["discount_cents"])
        was = (
            f'<s class="price-was">S/ {cheapest["price_cents"] / 100:.2f}</s> '
            f'<span class="price-off">-{percent:g}%</span>'
        )
    price_prefix = "Desde " if len(set(finals)) > 1 else ""
    summary = product["description"] or f"{name} en TRENO Perú. Delivery a todo el Perú."
    data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": name,
        "description": summary,
        "category": product["category"],
        "sku": product["id"],
        "url": url,
        "offers": {
            "@type": "Offer",
            "url": url,
            "price": price,
            "priceCurrency": "PEN",
            "availability": "https://schema.org/InStock",
            "seller": {"@type": "Organization", "name": "TRENO Perú"},
        },
    }
    if image:
        data["image"] = image
    if len(options) > 1:
        data["offers"] = {
            "@type": "AggregateOffer",
            "url": url,
            "lowPrice": f"{min(finals) / 100:.2f}",
            "highPrice": f"{max(finals) / 100:.2f}",
            "offerCount": len(options),
            "priceCurrency": "PEN",
            "availability": "https://schema.org/InStock",
        }
    # Keep the JSON from closing its script tag when text contains "<".
    structured = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    esc = lambda text: html.escape(text, quote=True)
    options_tag = ""
    if options:
        names = ", ".join(esc(v["label"]) for v in options)
        options_tag = f'<div class="card__meta">Presentaciones: {names}</div>'
    image_meta = f'<meta property="og:image" content="{esc(image)}">' if image else ""
    image_tag = f'<img src="{esc(image)}" alt="{esc(name)}" width="800" height="800">' if image else ""
    description_tag = f'<p class="product__description">{esc(product["description"])}</p>' if product["description"] else ""
    return f"""<!doctype html>
<html lang="es-PE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(name)} | TRENO Perú</title>
<meta name="description" content="{esc(summary[:155])}">
<link rel="canonical" href="{esc(url)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="TRENO Perú">
<meta property="og:title" content="{esc(name)} | TRENO Perú">
<meta property="og:description" content="{esc(summary[:155])}">
<meta property="og:url" content="{esc(url)}">
{image_meta}
<link rel="icon" type="image/png" href="/assets/img/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&amp;family=Inter:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
<script type="application/ld+json">{structured}</script>
</head>
<body>
<div class="promo-bar">Delivery a todo el Perú · Pedidos al 957 503 022</div>
<header class="site-header"><div class="wrap site-header__row"><a class="logo" href="/"><img src="/assets/img/logo-treno.png" alt="TRENO" width="404" height="144"></a></div></header>
<main class="wrap"><article class="product__layout product__layout--page">
<div class="product__main">{image_tag}</div>
<div class="product__info">
<h1 class="display">{esc(name)}</h1>
<div class="card__meta">{esc(product["category"])}</div>
<div class="product__price">{price_prefix}S/ {price} {was}</div>
{options_tag}
{description_tag}
<a class="button" href="/#producto/{esc(product["id"])}">Comprar</a>
<a href="/">Ver todo el catálogo</a>
</div>
</article></main>
<footer class="site-footer"><div class="wrap site-footer__row"><a class="logo" href="/"><img src="/assets/img/logo-treno-blanco.png" alt="TRENO" width="404" height="144"></a><div class="site-footer__links"><a href="tel:+51957503022">Pedidos: 957 503 022</a><a href="https://www.instagram.com/treno_peru">Instagram: @treno_peru</a><a href="https://www.facebook.com/treno.peru">Facebook: TRENO Perú</a></div></div></footer>
</body>
</html>
"""


def sitemap():
    conn = connect()
    try:
        ids = [row[0] for row in conn.run(f"SELECT p.id FROM products p WHERE {ON_SALE_SQL} ORDER BY p.sort_order")]
    finally:
        conn.close()
    urls = [SITE_URL + "/"] + [f"{SITE_URL}/producto/{product_id}" for product_id in ids]
    entries = "".join(f"<url><loc>{html.escape(url)}</loc></url>" for url in urls)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    )


def session_secret():
    secret = os.environ.get("ADMIN_SESSION_SECRET")
    if not secret or not os.environ.get("ADMIN_PASSWORD"):
        raise ApiError(503, "El panel de administración no está configurado.")
    return secret.encode()


def sign(expires):
    return hmac.new(session_secret(), str(expires).encode(), hashlib.sha256).hexdigest()


def session_is_valid(token):
    expires, _, signature = (token or "").partition(".")
    if not expires.isdigit() or int(expires) < time.time():
        return False
    return hmac.compare_digest(signature, sign(int(expires)))


def cookie_header(value, max_age):
    secure = "; Secure" if os.environ.get("VERCEL") else ""
    return f"{COOKIE}={value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}"


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, body, cookie=None):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(data)

    def send_text(self, status, content_type, text):
        data = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=0, s-maxage=300")
        self.end_headers()
        self.wfile.write(data)

    def send_image(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        # Each upload gets a new id, so a stored photo at a given address never changes.
        self.send_header("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable")
        self.end_headers()
        self.wfile.write(data)

    def send_excel(self, data, filename):
        self.send_response(200)
        self.send_header("Content-Type", XLSX_TYPE)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_excel(self):
        if self.headers.get("Content-Type", "").split(";")[0].strip() != XLSX_TYPE:
            raise ApiError(415, "Sube un archivo Excel .xlsx.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(400, "Solicitud no válida.")
        if length <= 0:
            raise ApiError(400, "No se recibió ningún archivo.")
        if length > MAX_EXCEL_BYTES:
            raise ApiError(413, "El archivo es demasiado grande. Admite hasta 3 MB.")
        return self.rfile.read(length)

    def read_image(self):
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "image/jpeg":
            raise ApiError(415, "La foto debe enviarse como JPG.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(400, "Solicitud no válida.")
        if length <= 0:
            raise ApiError(400, "No se recibió ninguna foto.")
        if length > MAX_IMAGE_BYTES:
            raise ApiError(413, "La foto es demasiado grande.")
        return self.rfile.read(length)

    def read_json(self):
        if "application/json" not in self.headers.get("Content-Type", ""):
            raise ApiError(415, "Se esperaba JSON.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(400, "Solicitud no válida.")
        if length > MAX_BODY_BYTES:
            raise ApiError(413, "La solicitud es demasiado grande.")
        try:
            payload = json.loads(self.rfile.read(length))
        except ValueError:
            raise ApiError(400, "Solicitud no válida.")
        if not isinstance(payload, dict):
            raise ApiError(400, "Solicitud no válida.")
        return payload

    def client_ip(self):
        forwarded = self.headers.get("X-Forwarded-For", "")
        return forwarded.split(",")[0].strip() or self.client_address[0]

    def require_admin(self):
        session_secret()
        token = None
        for part in self.headers.get("Cookie", "").split(";"):
            name, _, value = part.strip().partition("=")
            if name == COOKIE:
                token = value
        if not session_is_valid(token):
            raise ApiError(401, "Inicia sesión.")

    def route(self):
        method = self.command
        path = urlsplit(self.path).path.rstrip("/")

        if method == "GET" and path == "/api/products":
            return self.send_json(200, list_products())
        if method == "GET" and path == "/sitemap.xml":
            return self.send_text(200, "application/xml", sitemap())
        page = re.fullmatch(r"/producto/([A-Z0-9]{1,20})", path)
        if method == "GET" and page:
            content = product_page(page.group(1))
            if content is None:
                raise ApiError(404, "Producto no disponible.")
            return self.send_text(200, "text/html", content)
        image = re.fullmatch(r"/api/images/(\d{1,18})", path)
        if method == "GET" and image:
            return self.send_image(read_product_photo(int(image.group(1))))
        if method == "POST" and path == "/api/orders":
            return self.send_json(201, create_order(self.read_json(), self.client_ip()))
        if method == "POST" and path == "/api/admin/login":
            credentials = self.read_json()
            username, password = credentials.get("username"), credentials.get("password")
            secret = session_secret()
            if not isinstance(username, str) or not isinstance(password, str):
                raise ApiError(401, "Usuario o contraseña incorrectos.")
            expected_username = os.environ.get("ADMIN_USERNAME", "admin").encode()
            # Compare both, so the response does not reveal which one was wrong.
            username_ok = hmac.compare_digest(username.strip().encode(), expected_username)
            password_ok = hmac.compare_digest(password.encode(), os.environ["ADMIN_PASSWORD"].encode())
            if not (username_ok and password_ok):
                raise ApiError(401, "Usuario o contraseña incorrectos.")
            expires = int(time.time()) + SESSION_SECONDS
            token = f"{expires}.{hmac.new(secret, str(expires).encode(), hashlib.sha256).hexdigest()}"
            return self.send_json(200, {"ok": True}, cookie_header(token, SESSION_SECONDS))
        if method == "POST" and path == "/api/admin/logout":
            return self.send_json(200, {"ok": True}, cookie_header("", 0))
        if method == "GET" and path == "/api/admin/orders":
            self.require_admin()
            return self.send_json(200, admin_orders())
        if method == "GET" and path == "/api/admin/products":
            self.require_admin()
            return self.send_json(200, admin_products())
        if method == "POST" and path == "/api/admin/products":
            self.require_admin()
            return self.send_json(201, create_product(self.read_json()))
        product = re.fullmatch(r"/api/admin/products/([A-Z0-9]{1,20})", path)
        if method == "PATCH" and product:
            self.require_admin()
            return self.send_json(200, set_product_stock(product.group(1), self.read_json()))
        if method == "GET" and path == "/api/admin/export":
            self.require_admin()
            stamp = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 5 * 3600))
            return self.send_excel(export_excel(), f"treno-productos-{stamp}.xlsx")
        if method == "POST" and path == "/api/admin/import/preview":
            self.require_admin()
            return self.send_json(200, import_excel(self.read_excel(), False))
        if method == "POST" and path == "/api/admin/import/apply":
            self.require_admin()
            return self.send_json(200, import_excel(self.read_excel(), True))
        new_variant = re.fullmatch(r"/api/admin/products/([A-Z0-9]{1,20})/variants", path)
        if method == "POST" and new_variant:
            self.require_admin()
            return self.send_json(201, add_product_variant(new_variant.group(1), self.read_json()))
        variant = re.fullmatch(r"/api/admin/products/([A-Z0-9]{1,20})/variants/(\d{1,18})", path)
        if method == "PATCH" and variant:
            self.require_admin()
            return self.send_json(200, update_product_variant(variant.group(1), int(variant.group(2)), self.read_json()))
        if method == "DELETE" and variant:
            self.require_admin()
            return self.send_json(200, delete_product_variant(variant.group(1), int(variant.group(2))))
        details = re.fullmatch(r"/api/admin/products/([A-Z0-9]{1,20})/details", path)
        if method == "PATCH" and details:
            self.require_admin()
            return self.send_json(200, set_product_details(details.group(1), self.read_json()))
        colors = re.fullmatch(r"/api/admin/products/([A-Z0-9]{1,20})/colors", path)
        if method == "PATCH" and colors:
            self.require_admin()
            return self.send_json(200, set_product_colors(colors.group(1), self.read_json()))
        photo = re.fullmatch(r"/api/admin/products/([A-Z0-9]{1,20})/photos/([a-z]{1,20})", path)
        if method == "POST" and photo:
            self.require_admin()
            return self.send_json(200, add_product_photo(photo.group(1), photo.group(2), self.read_image()))
        stored = re.fullmatch(r"/api/admin/products/([A-Z0-9]{1,20})/images/(\d{1,18})", path)
        if method == "DELETE" and stored:
            self.require_admin()
            return self.send_json(200, delete_product_photo(stored.group(1), int(stored.group(2))))
        match = re.fullmatch(r"/api/admin/orders/(\d{1,12})", path)
        if method == "PATCH" and match:
            self.require_admin()
            status = self.read_json().get("status")
            return self.send_json(200, set_order_status(int(match.group(1)), status))
        raise ApiError(404, "No encontrado.")

    def serve_api(self):
        try:
            self.route()
        except ApiError as error:
            self.send_json(error.status, {"error": error.message})
        except Exception:
            traceback.print_exc(file=sys.stderr)
            self.send_json(500, {"error": "Ocurrió un problema. Inténtalo de nuevo."})

    def do_GET(self):
        self.serve_api()

    def do_POST(self):
        self.serve_api()

    def do_PATCH(self):
        self.serve_api()

    def do_DELETE(self):
        self.serve_api()
