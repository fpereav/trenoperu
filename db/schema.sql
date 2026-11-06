CREATE TABLE IF NOT EXISTS products (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  category    text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  image       text NOT NULL,
  colors      jsonb NOT NULL,
  stock       integer NOT NULL CHECK (stock >= 0),
  top         boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0);

-- Photos uploaded in the admin panel. slot is 'principal' or a product color.
CREATE TABLE IF NOT EXISTS product_images (
  product_id text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  slot       text NOT NULL,
  data       bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, slot)
);

-- Each slot (a color or 'principal') can hold several photos.
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS id bigserial;
ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_pkey;
ALTER TABLE product_images ADD PRIMARY KEY (id);
CREATE INDEX IF NOT EXISTS product_images_slot_idx ON product_images (product_id, slot, id);

CREATE TABLE IF NOT EXISTS orders (
  id            bigserial PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'pendiente'
                CHECK (status IN ('pendiente', 'pagado', 'entregado', 'cancelado')),
  customer_name text NOT NULL,
  phone         text NOT NULL,
  address       text NOT NULL,
  city          text NOT NULL,
  notes         text NOT NULL DEFAULT '',
  total_cents   integer NOT NULL CHECK (total_cents >= 0),
  ip_hash       text NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_ip_hash_idx ON orders (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id               bigserial PRIMARY KEY,
  order_id         bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id       text NOT NULL REFERENCES products (id),
  product_name     text NOT NULL,
  color            text NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  quantity         integer NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);

-- Options of a product, such as 10 kg or 20 kg, each with its own price and stock.
-- A product with options sells only through them, ignoring its own price and stock.
CREATE TABLE IF NOT EXISTS product_variants (
  id             bigserial PRIMARY KEY,
  product_id     text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  label          text NOT NULL,
  price_cents    integer NOT NULL CHECK (price_cents > 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  stock          integer NOT NULL CHECK (stock >= 0)
);

CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants (product_id, id);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id bigint REFERENCES product_variants (id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_label text NOT NULL DEFAULT '';

-- Initial catalog. ON CONFLICT keeps current stock and prices when re-run.
INSERT INTO products (id, name, category, price_cents, image, colors, stock, top, sort_order) VALUES
  ('PACKCH', 'Pack chaleco 10 kg + tobilleras 1 kg', 'Packs', 6900, 'pack-chaleco-tobilleras.jpg', '["negro"]', 8, false, 0),
  ('KETPVC', 'Kettlebell PVC 4 kg', 'Pesas', 5900, 'kettlebell-pvc.jpg', '["rosado","negro","rojo"]', 4, true, 1),
  ('MANVIN', 'Mancuerna vinilo 1 kg', 'Pesas', 6900, 'mancuerna-vinilo.jpg', '["rosado","morado","rojo"]', 4, true, 2),
  ('MATGOM', 'Mat goma EVA 8 mm', 'Yoga', 6900, 'mat-goma-eva.jpg', '["rosado","fucsia","plomo","verde","marino"]', 6, false, 3),
  ('TOBPLA', 'Tobillera con peso 2 kg', 'Accesorios', 6900, 'tobillera-peso.jpg', '["rosado","negro","azul"]', 8, false, 4),
  ('BANLAT', 'Bandas de látex arcoíris x5', 'Resistencia', 6900, 'bandas-latex.jpg', '["rojo","amarillo","verde","azul"]', 22, true, 5),
  ('SOGPVC', 'Soga para saltar PVC 2.75 m', 'Cardio', 5900, 'soga-pvc.jpg', '["celeste","naranja"]', 10, false, 6),
  ('CHASIN', 'Chaleco con peso 10 kg', 'Accesorios', 16900, 'chaleco-peso.jpg', '["rosado","negro","verde","plomo"]', 8, false, 7),
  ('ROLPVC', 'Roller PVC para masaje', 'Recuperación', 6900, 'roller-pvc.jpg', '["rosado","morado","negro","azul"]', 2, false, 8),
  ('PESHIE', 'Pesa rusa hierro 12 kg', 'Pesas', 12000, 'pesa-rusa-hierro.jpg', '["negro"]', 1, false, 9),
  ('MANCAU', 'Mancuerna hexagonal caucho 2 kg', 'Pesas', 11900, 'mancuerna-hexagonal.jpg', '["negro"]', 1, false, 10),
  ('STEPVC', 'Step PVC 2 niveles', 'Cardio', 12900, 'step-pvc.jpg', '["plomo","azul","rojo"]', 3, false, 11),
  ('TRXSIN', 'TRX entrenamiento en suspensión', 'Funcional', 15900, 'trx.jpg', '["amarillo"]', 4, false, 12),
  ('GUAPLA', 'Guantes de box 14 oz', 'Box', 19900, 'guantes-box.jpg', '["rojo","negro"]', 4, false, 13)
ON CONFLICT (id) DO NOTHING;

-- One-time data changes, so editing or clearing the result later is respected.
CREATE TABLE IF NOT EXISTS data_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

UPDATE products SET description = CASE id
  WHEN 'PACKCH' THEN 'Pack con chaleco lastrado de 10 kg y tobilleras de 1 kg, ajustables, para sumar resistencia a tus entrenamientos.'
  WHEN 'KETPVC' THEN 'Pesa rusa de PVC de 4 kg para ejercicios de fuerza y resistencia en casa.'
  WHEN 'MANVIN' THEN 'Mancuerna de vinilo de 1 kg para tonificar brazos y hombros.'
  WHEN 'MATGOM' THEN 'Mat de goma EVA de 8 mm para yoga, estiramientos y ejercicios en el piso.'
  WHEN 'TOBPLA' THEN 'Tobillera con peso para añadir resistencia a tus ejercicios de piernas y caminatas.'
  WHEN 'BANLAT' THEN 'Set de 5 bandas de látex de colores para ejercicios de fuerza y tonificación.'
  WHEN 'SOGPVC' THEN 'Soga para saltar de PVC de 2.75 m para cardio y coordinación.'
  WHEN 'CHASIN' THEN 'Chaleco con peso para aumentar la intensidad de tus entrenamientos.'
  WHEN 'ROLPVC' THEN 'Roller de PVC para masaje y recuperación muscular después de entrenar.'
  WHEN 'PESHIE' THEN 'Pesa rusa de hierro de 12 kg para entrenamientos de fuerza y ejercicios funcionales.'
  WHEN 'MANCAU' THEN 'Mancuerna hexagonal de caucho de 2 kg. Su forma evita que ruede en el piso.'
  WHEN 'STEPVC' THEN 'Step de PVC con 2 niveles de altura para ejercicios de cardio y tonificación.'
  WHEN 'TRXSIN' THEN 'Sistema de entrenamiento en suspensión para ejercitar todo el cuerpo con tu propio peso.'
  WHEN 'GUAPLA' THEN 'Guantes de box de 14 oz para entrenar golpes en saco y mitts.'
END
WHERE description = ''
  AND id IN ('PACKCH', 'KETPVC', 'MANVIN', 'MATGOM', 'TOBPLA', 'BANLAT', 'SOGPVC', 'CHASIN', 'ROLPVC', 'PESHIE', 'MANCAU', 'STEPVC', 'TRXSIN', 'GUAPLA')
  AND NOT EXISTS (SELECT 1 FROM data_migrations WHERE name = 'default_descriptions');

INSERT INTO data_migrations (name) VALUES ('default_descriptions') ON CONFLICT (name) DO NOTHING;
