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
