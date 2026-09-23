"""SQLite access for the explorer API.

One read-only connection per request thread. The database is built offline by
pipeline/build_db.py, so nothing here writes to it -- the only mutable state in
the app is the association store, which lives on disk as JSON, not in SQLite.
"""

import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "betterrtk.sqlite"

_local = threading.local()


class DatabaseMissing(RuntimeError):
    pass


def get_db() -> sqlite3.Connection:
    """Thread-local read-only connection."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        return conn

    if not DB_PATH.exists():
        raise DatabaseMissing(
            f"{DB_PATH} not found. Run:\n"
            f"  python pipeline/fetch_sources.py\n"
            f"  python pipeline/build_db.py"
        )

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'sense_bg'").fetchone():
        conn.close()
        raise DatabaseMissing(
            f"{DB_PATH} predates the Bulgarian tables. Run:\n"
            f"  python pipeline/build_db.py bg"
        )
    _local.conn = conn
    return conn


def query(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    return get_db().execute(sql, params).fetchall()


def query_one(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    return get_db().execute(sql, params).fetchone()
