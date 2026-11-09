"""WhatsApp bot for TRENO: answers frequent questions through the Meta WhatsApp Cloud API.

Meta calls /api/whatsapp. GET verifies the webhook, POST delivers messages. The bot needs no paid
service: it answers with a menu, keywords and a search over the live catalog (only products on
sale), and hands the chat to a person when it cannot help.
"""
import hashlib
import hmac
import json
import os
import re
import sys
import traceback
import unicodedata
import urllib.request

SITE_URL = os.environ.get("SITE_URL", "https://trenoperu.vercel.app").rstrip("/")
GRAPH_VERSION = os.environ.get("WHATSAPP_GRAPH_VERSION", "v23.0")
MAX_WEBHOOK_BYTES = 200_000
MAX_CUSTOMER_TEXT = 1500
MAX_PRODUCTS_SHOWN = 4
# Per customer: more than this in an hour hands the chat to a person.
MESSAGES_PER_PHONE_PER_HOUR = 20
HANDOFF_HOURS = 12
PHONE_RE = re.compile(r"^[0-9]{6,20}$")
MEDIA_KINDS = ("image", "document", "audio", "video", "location", "contacts")

# ---------- texts ----------

MENU = (
    "¡Hola! 👋 Soy el asistente automático de *TRENO Perú*. Escribe el número de lo que necesitas:\n\n"
    "1️⃣ Productos y precios\n"
    "2️⃣ Formas de pago\n"
    "3️⃣ Delivery y envíos\n"
    "4️⃣ Recojo en tienda\n"
    "5️⃣ Packs\n"
    "6️⃣ Hablar con una persona\n\n"
    "También puedes escribir el producto que buscas, por ejemplo: *chaleco*, *kettlebell* o *bandas*.\n"
    f"🛒 Tienda: {SITE_URL}"
)
PAYMENT = (
    "💳 *Formas de pago*\n\n"
    "• *Delivery:* solo con *Yape* o *Plin*, con el código QR que aparece al confirmar tu pedido en la web.\n"
    "• *Recojo en tienda (San Borja):* Yape, Plin o efectivo.\n\n"
    "Después de pagar, envíanos por aquí la captura de tu pago junto con tu *número de pedido*."
)
DELIVERY = (
    "🚚 *Delivery y envíos*\n\n"
    "• *Lima:* el delivery lo hace una empresa externa. El costo depende de tu distrito y lo coordinamos por este WhatsApp.\n"
    "• *Provincias:* enviamos por *Shalom*. Tarifas: shalom.com.pe/tarifas\n\n"
    "Los precios de los productos no incluyen el delivery ni el envío. "
    "Los pedidos con delivery se pagan con Yape o Plin."
)
PICKUP = (
    "🏬 *Recojo en tienda*\n\n"
    "Puedes recoger tu pedido en nuestra tienda en *San Borja, Lima*. "
    "Ahí puedes pagar con Yape, Plin o efectivo.\n"
    "Haz tu pedido en la web y te escribimos por aquí para coordinar la dirección exacta y la hora.\n"
    f"🛒 {SITE_URL}"
)
HOW_TO_BUY = (
    "🛒 *Cómo comprar*\n\n"
    f"1. Entra a {SITE_URL} y agrega tus productos al carrito.\n"
    "2. Elige delivery o recojo en tienda y confirma tu pedido.\n"
    "3. Paga con Yape o Plin con el QR que aparece (en recojo también aceptamos efectivo).\n"
    "4. Envíanos por aquí la captura de tu pago con tu *número de pedido*."
)
HANDOFF_TEXT = "Listo 🙌 Una persona del equipo de TRENO te responderá por aquí lo antes posible."
MEDIA_TEXT = (
    "¡Gracias! Recibimos tu archivo. Si es tu comprobante de pago, recuerda indicarnos tu número de pedido. "
    "Una persona del equipo lo revisará y te responderá por aquí."
)
FALLBACK = (
    "No encontré eso 🤔. Escribe el *número* de una opción o el nombre del producto:\n"
    "1️⃣ Productos  2️⃣ Pagos  3️⃣ Delivery  4️⃣ Recojo  5️⃣ Packs  6️⃣ Hablar con una persona"
)
NOT_AVAILABLE = (
    "Por ahora no tenemos ese producto disponible 😕. Escribe *1* para ver lo que tenemos en stock "
    "o *6* para hablar con una persona."
)
FOOTER = "Escribe *menú* para ver más opciones."

# ---------- understanding the customer ----------

# Phrases that need a person: orders, payments made, complaints, custom quotes.
HANDOFF_PHRASES = (
    "asesor", "asesora", "humano", "una persona", "persona real", "hablar con", "operador", "encargado",
    "encargada", "vendedor", "vendedora", "atiendame", "atencion personal",
    "mi pedido", "numero de pedido", "nro de pedido", "n de pedido", "pedido numero", "pedido nro",
    "ya pague", "ya yapee", "ya plinee", "ya transferi", "le yapee", "te yapee", "les yapee", "comprobante",
    "voucher", "constancia", "reclamo", "queja", "devolucion", "devolver", "garantia", "cambiar mi",
    "cambio de", "factura", "boleta", "por mayor", "al por mayor", "mayorista", "cotizacion", "cotizar",
    "armar un pack", "armar pack", "pack personalizado", "pack a medida", "no llego", "no me llego",
    "cuando llega mi", "estado de mi",
)
TOPICS = (
    ("payment", ("pago", "pagar", "pagos", "yape", "plin", "efectivo", "tarjeta", "transferencia", "deposito",
                 "qr", "metodo de pago", "medios de pago", "formas de pago", "cash")),
    ("delivery", ("delivery", "envio", "envios", "envian", "enviar", "envias", "despacho", "provincia",
                  "provincias", "shalom", "distrito", "costo de envio", "hacen envios", "llevan", "mandan")),
    ("pickup", ("recojo", "recoger", "recogerlo", "tienda fisica", "direccion", "ubicacion", "ubicados",
                "donde estan", "donde quedan", "san borja", "local", "horario", "atienden")),
    ("packs", ("pack", "packs", "combo", "combos", "promocion", "promo")),
    ("buy", ("comprar", "compro", "como hago", "hacer un pedido", "hacer pedido", "como pido", "ordenar",
             "carrito", "pedir")),
    ("catalog", ("productos", "catalogo", "precios", "lista", "que venden", "que tienen", "stock",
                 "disponible", "disponibles", "tienen de todo")),
)
GREETINGS = ("hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "info", "informacion",
             "menu", "inicio", "ayuda", "hi", "hello", "alo", "consulta", "una consulta")
MENU_NUMBERS = {"1": "catalog", "2": "payment", "3": "delivery", "4": "pickup", "5": "packs", "6": "human"}

# Customer word -> words to look for in product names and categories.
SYNONYMS = {
    "kettlebell": ("kettlebell", "rusa"), "kettle": ("kettlebell", "rusa"), "rusa": ("kettlebell", "rusa"),
    "mancuerna": ("mancuerna",), "pesa": ("mancuerna", "kettlebell", "rusa"), "pesas": ("mancuerna", "kettlebell", "rusa"),
    "chaleco": ("chaleco",), "tobillera": ("tobillera",), "tobilleras": ("tobillera",),
    "banda": ("banda", "tubo"), "liga": ("banda", "tubo"), "elastico": ("banda", "tubo"), "resistencia": ("banda", "tubo"),
    "tubo": ("tubo",), "mat": ("mat",), "colchoneta": ("mat",), "yoga": ("mat",), "tapete": ("mat",),
    "soga": ("soga",), "cuerda": ("soga",), "saltar": ("soga",), "step": ("step",), "stepper": ("step",),
    "trx": ("trx",), "suspension": ("trx",), "guante": ("guante",), "box": ("guante",), "boxeo": ("guante",),
    "rueda": ("rueda",), "abdominal": ("rueda",), "abdominales": ("rueda",), "abs": ("rueda",),
    "carver": ("carver",), "hierro": ("hierro",), "vinilo": ("vinilo",), "caucho": ("caucho",),
}


def fold(text):
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9ñ ]+", " ", text).split())


def singular(word):
    # "colores" -> "color", "guantes" -> "guante", "pesas" -> "pesa"
    if len(word) > 4 and word.endswith("es") and word[-3] in "lrndzj":
        return word[:-2]
    if len(word) > 3 and word.endswith("s"):
        return word[:-1]
    return word


def has_phrase(text, phrases):
    padded = f" {text} "
    return any(f" {phrase} " in padded for phrase in phrases)


def money(value):
    return f"S/ {value:g}" if value == int(value) else f"S/ {value:.2f}"


def product_words(product):
    return {singular(w) for w in fold(product["name"] + " " + product["cat"]).split()}


def find_products(text, products):
    """Products matching the most product words the customer wrote. Packs go after single items."""
    wanted = []
    for word in text.split():
        targets = set(SYNONYMS.get(word, ())) | set(SYNONYMS.get(singular(word), ()))
        if targets:
            wanted.append({singular(t) for t in targets})
    if not wanted:
        return [], False
    scored = []
    for position, p in enumerate(products):
        words = product_words(p)
        score = sum(1 for targets in wanted if targets & words)
        if score:
            scored.append((score, fold(p["cat"]) == "packs", position, p))
    if not scored:
        return [], True
    best = max(item[0] for item in scored)
    top = sorted((item for item in scored if item[0] == best), key=lambda item: item[1:3])
    return [item[3] for item in top], True


def product_card(p):
    lines = [f"*{p['name']}*"]
    if p.get("variants"):
        options = []
        for v in p["variants"]:
            label = f"{v['label']} {money(v['price'])}"
            options.append(label + (" (últimas unidades)" if v.get("low") else ""))
        lines.append("Opciones: " + ", ".join(options))
    else:
        price = money(p["price"])
        if p.get("discountPercent"):
            price += f" (antes {money(p['listPrice'])})"
        lines.append(price + (" · últimas unidades" if p.get("low") else ""))
    if p.get("colors"):
        lines.append("Colores: " + ", ".join(p["colors"]))
    lines.append(f"{SITE_URL}/producto/{p['id']}")
    return "\n".join(lines)


def products_answer(found):
    shown = found[:MAX_PRODUCTS_SHOWN]
    parts = [product_card(p) for p in shown]
    more = "" if len(found) <= len(shown) else f"\n\nTenemos {len(found) - len(shown)} opción(es) más en {SITE_URL}"
    return "\n\n".join(parts) + more + "\n\nLos precios no incluyen delivery. " + FOOTER


def catalog_answer(products):
    if not products:
        return "Ahora mismo estamos reponiendo stock. Escribe *6* para hablar con una persona."
    by_cat = {}
    for p in products:
        by_cat.setdefault(p["cat"], []).append(p)
    lines = ["🏋️ *Productos en stock*"]
    for cat, items in by_cat.items():
        lines.append(f"\n*{cat}*")
        for p in items:
            prefix = "desde " if p.get("variants") and p.get("priceFrom") else ""
            lines.append(f"• {p['name']}: {prefix}{money(p['price'])}")
    lines.append("\nEscribe el nombre de un producto para ver colores y el enlace, "
                 f"o compra en {SITE_URL}")
    return "\n".join(lines)


def packs_answer(products):
    packs = [p for p in products if fold(p["cat"]) == "packs"]
    lines = ["🎁 *Packs*"]
    for p in packs:
        lines.append(f"• {p['name']}: {money(p['price'])}\n  {SITE_URL}/producto/{p['id']}")
    if not packs:
        lines.append("Ahora mismo no tenemos packs armados en stock.")
    lines.append("\nTambién *armamos packs a pedido*: dinos qué productos quieres combinar "
                 "y una persona te confirma el precio.")
    return "\n".join(lines)


def answer_for(text, products, last_reply=""):
    """Returns (reply, hand_to_person) for one customer message."""
    clean = fold(text)
    if not clean:
        return MENU, False
    if clean in MENU_NUMBERS:
        topic = MENU_NUMBERS[clean]
    elif has_phrase(clean, HANDOFF_PHRASES):
        topic = "human"
    else:
        found, asked_product = find_products(clean, products)
        if found:
            return products_answer(found), False
        topic = next((name for name, words in TOPICS if has_phrase(clean, words)), None)
        if topic is None and asked_product:
            return NOT_AVAILABLE, False
        if topic is None and has_phrase(clean, GREETINGS):
            return MENU, False
    if topic == "human":
        return HANDOFF_TEXT, True
    if topic == "catalog":
        return catalog_answer(products), False
    if topic == "payment":
        return PAYMENT, False
    if topic == "delivery":
        return DELIVERY, False
    if topic == "pickup":
        return PICKUP, False
    if topic == "packs":
        return packs_answer(products), False
    if topic == "buy":
        return HOW_TO_BUY, False
    # Not understood twice in a row: a person takes over.
    if last_reply == FALLBACK:
        return HANDOFF_TEXT, True
    if not last_reply:
        return MENU, False
    return FALLBACK, False


# ---------- webhook security ----------

def signature_ok(raw_body, header):
    secret = os.environ.get("WHATSAPP_APP_SECRET", "")
    if not secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[len("sha256="):].strip())


def verify_subscription(query):
    """Meta's GET handshake. Returns the challenge to echo, or None."""
    token = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")
    mode = query.get("hub.mode", [""])[0]
    given = query.get("hub.verify_token", [""])[0]
    challenge = query.get("hub.challenge", [""])[0]
    if token and mode == "subscribe" and hmac.compare_digest(given.encode(), token.encode()) and challenge:
        return challenge[:200]
    return None


# ---------- storage ----------

def save_message(conn, phone, role, body, wa_id=None):
    """Stores a message. For incoming ones, returns False if Meta already delivered it."""
    found = conn.run(
        "INSERT INTO wa_messages (phone, role, body, wa_id) VALUES (:phone, :role, :body, :wa_id) "
        "ON CONFLICT (wa_id) DO NOTHING RETURNING id",
        phone=phone, role=role, body=body[:4000], wa_id=wa_id,
    )
    return bool(found)


def last_bot_reply(conn, phone):
    found = conn.run(
        "SELECT body FROM wa_messages WHERE phone = :phone AND role = 'assistant' "
        "AND created_at > now() - interval '24 hours' ORDER BY id DESC LIMIT 1",
        phone=phone,
    )
    return found[0][0] if found else ""


def handed_off(conn, phone):
    return bool(conn.run("SELECT 1 FROM wa_handoffs WHERE phone = :phone AND until > now()", phone=phone))


def hand_off(conn, phone, reason):
    conn.run(
        "INSERT INTO wa_handoffs (phone, until, reason) VALUES "
        "(:phone, now() + make_interval(hours => :h), :reason) "
        "ON CONFLICT (phone) DO UPDATE SET until = EXCLUDED.until, reason = EXCLUDED.reason",
        phone=phone, h=HANDOFF_HOURS, reason=reason,
    )


def too_many_from(conn, phone):
    count = conn.run(
        "SELECT count(*) FROM wa_messages WHERE phone = :phone AND role = 'user' "
        "AND created_at > now() - interval '1 hour'",
        phone=phone,
    )[0][0]
    return count > MESSAGES_PER_PHONE_PER_HOUR


def prune(conn):
    # Keep customer chats only for a week.
    conn.run("DELETE FROM wa_messages WHERE created_at < now() - interval '7 days'")
    conn.run("DELETE FROM wa_handoffs WHERE until < now() - interval '7 days'")


# ---------- WhatsApp sending ----------

def send_whatsapp(to, body):
    phone_id = os.environ["WHATSAPP_PHONE_NUMBER_ID"]
    request = urllib.request.Request(
        f"https://graph.facebook.com/{GRAPH_VERSION}/{phone_id}/messages",
        data=json.dumps({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {"preview_url": True, "body": body[:4000]},
        }).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["WHATSAPP_TOKEN"],
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        response.read()


# ---------- message handling ----------

def reply_to(conn, phone, text, products_loader, send):
    """Decides and sends the answer to one customer text. Returns what was sent, or None."""
    if handed_off(conn, phone):
        return None
    if too_many_from(conn, phone):
        answer, to_person = HANDOFF_TEXT, True
    else:
        answer, to_person = answer_for(text, products_loader(), last_bot_reply(conn, phone))
    if to_person:
        hand_off(conn, phone, "el bot lo pasó a una persona")
    send(phone, answer)
    save_message(conn, phone, "assistant", answer)
    return answer


def handle_webhook(payload, connect, products_loader, send=None):
    """Processes one Meta webhook delivery. Returns how many customer messages were handled."""
    send = send or send_whatsapp
    my_phone_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
    handled = 0
    conn = connect()
    try:
        for entry in payload.get("entry") or []:
            for change in entry.get("changes") or []:
                value = change.get("value") or {}
                if my_phone_id and (value.get("metadata") or {}).get("phone_number_id") != my_phone_id:
                    continue
                # Coexistence: the owner wrote from the WhatsApp Business app, so the bot steps aside.
                for echo in value.get("message_echoes") or []:
                    to = str(echo.get("to", ""))
                    if PHONE_RE.match(to):
                        hand_off(conn, to, "respondió el dueño desde la app")
                for message in value.get("messages") or []:
                    phone = str(message.get("from", ""))
                    wa_id = str(message.get("id", ""))[:200]
                    if not PHONE_RE.match(phone) or not wa_id:
                        continue
                    kind = message.get("type")
                    if kind == "text":
                        text = str((message.get("text") or {}).get("body", ""))
                    elif kind == "button":
                        text = str((message.get("button") or {}).get("text", ""))
                    elif kind == "interactive":
                        inner = message.get("interactive") or {}
                        picked = inner.get("button_reply") or inner.get("list_reply") or {}
                        text = str(picked.get("title", ""))
                    else:
                        text = ""
                    text = text.strip()[:MAX_CUSTOMER_TEXT]
                    try:
                        if kind in MEDIA_KINDS:
                            if not save_message(conn, phone, "user", f"[{kind}]", wa_id):
                                continue
                            handled += 1
                            if not handed_off(conn, phone):
                                hand_off(conn, phone, f"envió {kind}")
                                send(phone, MEDIA_TEXT)
                                save_message(conn, phone, "assistant", MEDIA_TEXT)
                            continue
                        if not text or not save_message(conn, phone, "user", text, wa_id):
                            continue
                        handled += 1
                        reply_to(conn, phone, text, products_loader, send)
                    except Exception:
                        # Already stored, so a retry from Meta is skipped; the owner sees it in the app.
                        traceback.print_exc(file=sys.stderr)
        prune(conn)
    finally:
        conn.close()
    return handled
