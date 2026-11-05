#!/usr/bin/env python3
"""Apply db/schema.sql to the database in DATABASE_URL. Safe to re-run."""
import os
import ssl
import sys
from urllib.parse import unquote, urlsplit

import pg8000.native

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    url = urlsplit(os.environ["DATABASE_URL"])
    conn = pg8000.native.Connection(
        user=unquote(url.username),
        password=unquote(url.password),
        host=url.hostname,
        port=url.port or 5432,
        database=url.path.lstrip("/"),
        ssl_context=None if url.hostname in ("127.0.0.1", "localhost") else ssl.create_default_context(),
    )
    try:
        with open(os.path.join(ROOT, "db", "schema.sql"), encoding="utf-8") as handle:
            for statement in handle.read().split(";"):
                lines = [l for l in statement.splitlines() if not l.strip().startswith("--")]
                sql = "\n".join(lines).strip()
                if sql:
                    conn.run(sql)
        print("products:", conn.run("SELECT count(*) FROM products")[0][0])
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
