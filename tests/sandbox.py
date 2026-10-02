"""The whole app, on a copy of the mutable data, for trying things in a browser.

    python tests/sandbox.py [--port 8010] [--owner admin@example.com]

Accounts, notes and review decisions go to a temporary directory (a copy of
data/associations to start from, and empty accounts), so signing in as a test
admin or accepting test decisions never touches data/. The database is the
real, read-only one. No mail is sent: sign-in links are returned to the page.

Point the dev frontend at it with `VITE_API=http://127.0.0.1:8010 npm run dev`,
or open http://127.0.0.1:8010 after `npm run build`.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8010)
    ap.add_argument("--owner", default="admin@example.com")
    ap.add_argument("--dir", help="keep the sandbox here instead of a fresh temporary directory")
    args = ap.parse_args()

    tmp = Path(args.dir) if args.dir else Path(tempfile.mkdtemp(prefix="bkd-sandbox-"))
    tmp.mkdir(parents=True, exist_ok=True)
    os.environ["BETTERRTK_OWNER_EMAIL"] = args.owner
    os.environ.pop("RESEND_API_KEY", None)
    os.environ.pop("APP_URL", None)

    from server import auth, store

    auth.AUTH_DIR = tmp / "auth"
    auth.AUTH_FILE = auth.AUTH_DIR / "auth.json"
    auth.AVATARS = auth.AUTH_DIR / "avatars"

    assoc = tmp / "associations"
    if not assoc.exists() and store.ASSOC_DIR.exists():
        shutil.copytree(store.ASSOC_DIR, assoc)
    store.ASSOC_DIR, store.STORE, store.IMAGES = assoc, assoc / "store.json", assoc / "images"
    store.OVERRIDE_FILE = tmp / "decomp_overrides.json"

    try:
        from server import review
    except ImportError:
        review = None
    if review is not None:
        review.use_dir(tmp / "review")

    print(f"sandbox in {tmp}; admin is {args.owner}", flush=True)
    import uvicorn

    from server.app import app

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
