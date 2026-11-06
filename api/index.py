"""TRENO API: catalog, order creation and the admin panel endpoints."""
import hashlib
import hmac
import json
import os
import re
import ssl
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler
from urllib.parse import unquote, urlsplit

import pg8000.native

MAX_BODY_BYTES = 20_000
MAX_LINES = 30
MAX_QTY = 20
MAX_STOCK = 100_000
ORDERS_PER_IP_PER_HOUR = 5
SESSION_SECONDS = 12 * 60 * 60
COOKIE = "treno_admin"
LOCAL_HOSTS = ("127.0.0.1", "localhost")
STATUSES = ("pendiente", "pagado", "entregado", "cancelado")
PHONE_RE = re.compile(r"^[0-9+() \-]{7,20}$")
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


def list_products():
    conn = connect()
    try:
        products = rows(
            conn,
            "SELECT id, name, category, price_cents, image, colors, stock, top "
            "FROM products ORDER BY sort_order",
        )
    finally:
        conn.close()
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "cat": p["category"],
            "price": p["price_cents"] / 100,
            "img": p["image"],
            "colors": p["colors"],
            "inStock": p["stock"] > 0,
            "low": 0 < p["stock"] <= 2,
            "top": p["top"],
        }
        for p in products
    ]


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
        if not isinstance(product_id, str) or not isinstance(color, str):
            raise ApiError(400, "Tu carrito no es válido.")
        if isinstance(qty, bool) or not isinstance(qty, int) or not 1 <= qty <= MAX_QTY:
            raise ApiError(400, "Revisa las cantidades de tu carrito.")
        merged[(product_id, color)] = merged.get((product_id, color), 0) + qty
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

        quantities = {}
        for (product_id, _), qty in items.items():
            quantities[product_id] = quantities.get(product_id, 0) + qty

        products = {}
        # Sorted locking keeps two concurrent checkouts from deadlocking.
        for product_id in sorted(quantities):
            found = rows(
                conn,
                "SELECT id, name, price_cents, colors, stock FROM products "
                "WHERE id = :id FOR UPDATE",
                id=product_id,
            )
            if not found:
                raise ApiError(409, "Uno de los productos ya no está disponible.")
            product = found[0]
            if product["stock"] < quantities[product_id]:
                raise ApiError(409, "No hay stock suficiente de " + product["name"] + ".")
            products[product_id] = product

        total = 0
        for (product_id, color), qty in items.items():
            if color not in products[product_id]["colors"]:
                raise ApiError(400, "Revisa el color elegido.")
            total += products[product_id]["price_cents"] * qty

        order_id = conn.run(
            "INSERT INTO orders (customer_name, phone, address, city, notes, total_cents, ip_hash) "
            "VALUES (:name, :phone, :address, :city, :notes, :total, :ip) RETURNING id",
            total=total,
            ip=ip_hash,
            **customer,
        )[0][0]
        for (product_id, color), qty in items.items():
            product = products[product_id]
            conn.run(
                "INSERT INTO order_items "
                "(order_id, product_id, product_name, color, unit_price_cents, quantity) "
                "VALUES (:order_id, :product_id, :name, :color, :price, :qty)",
                order_id=order_id,
                product_id=product_id,
                name=product["name"],
                color=color,
                price=product["price_cents"],
                qty=qty,
            )
        for product_id, qty in quantities.items():
            conn.run(
                "UPDATE products SET stock = stock - :qty WHERE id = :id",
                qty=qty,
                id=product_id,
            )
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
            "'name', i.product_name, 'color', i.color, 'qty', i.quantity, "
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
                {"name": i["name"], "color": i["color"], "qty": i["qty"], "price": i["price"] / 100}
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
                "WHERE order_id = :id GROUP BY product_id) i WHERE p.id = i.product_id",
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
            "SELECT id, name, category, price_cents, stock FROM products ORDER BY sort_order",
        )
    finally:
        conn.close()
    return [
        {"id": p["id"], "name": p["name"], "cat": p["category"],
         "price": p["price_cents"] / 100, "stock": p["stock"]}
        for p in products
    ]


def set_product_stock(product_id, payload):
    stock, expected = payload.get("stock"), payload.get("expected")
    for value in (stock, expected):
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_STOCK:
            raise ApiError(400, "Escribe una cantidad entera entre 0 y 100000.")
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
        if method == "POST" and path == "/api/orders":
            return self.send_json(201, create_order(self.read_json(), self.client_ip()))
        if method == "POST" and path == "/api/admin/login":
            password = self.read_json().get("password")
            secret = session_secret()
            expected = os.environ["ADMIN_PASSWORD"].encode()
            if not isinstance(password, str) or not hmac.compare_digest(password.encode(), expected):
                raise ApiError(401, "Contraseña incorrecta.")
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
        product = re.fullmatch(r"/api/admin/products/([A-Z0-9]{1,20})", path)
        if method == "PATCH" and product:
            self.require_admin()
            return self.send_json(200, set_product_stock(product.group(1), self.read_json()))
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
