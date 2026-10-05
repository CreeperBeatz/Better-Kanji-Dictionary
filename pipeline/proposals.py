"""What the scripts that fill the review queue share: review_sources,
form_drafts, meaning_drafts and meaning_prune.

Each reads the database read-only and loads into the server's review state
(server/review.py), or a sandbox's with --review-dir. The drafting ones keep
a folder under data/drafts -- in/ the batches a subagent is given, out/ what
it wrote -- or another one with --drafts.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections.abc import Iterator
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
DB = ROOT / "data" / "betterrtk.sqlite"
DRAFTS = ROOT / "data" / "drafts"

from server import review  # noqa: E402
from server.review import CATCH_ALL  # noqa: E402

SOURCE = "ai:claude-sonnet"  # what the subagents' drafts are filed under


def connect() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True)


def folders(drafts: Path) -> tuple[Path, Path, Path]:
    """A drafts folder (absolute, or under the repository) and its in/ and out/."""
    drafts = drafts if drafts.is_absolute() else ROOT / drafts
    return drafts, drafts / "in", drafts / "out"


def asked_before(prefix: str, pattern: str, current: Path) -> Iterator[dict]:
    """The input batches of every other drafts folder named `prefix`*: what was asked there is not asked again."""
    for folder in DRAFTS.glob(f"{prefix}*"):
        if folder == current:
            continue
        for f in (folder / "in").glob(pattern):
            yield json.loads(f.read_text(encoding="utf-8"))


def outputs(inp: Path, out: Path, pattern: str, problems: list[str]) -> Iterator[tuple[Path, dict, dict]]:
    """Each input batch with what its subagent wrote; a missing or broken output is listed in `problems`."""
    for f in sorted(inp.glob(pattern)):
        batch = json.loads(f.read_text(encoding="utf-8"))
        path = out / f.name
        if not path.exists():
            problems.append(f"{f.stem}: no output")
            continue
        try:
            got = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            problems.append(f"{f.stem}: not JSON ({e})")
            continue
        yield f, batch, got


def sense_id(char: str, short: str) -> str:
    """A drafted group's id as the review store keeps it: life -> 生.life; the catch-all as it is."""
    return short if short == CATCH_ALL else f"{char}.{short}"


def short_id(sense: str) -> str:
    """生.life -> life, as the drafts write it."""
    return sense.split(".", 1)[1]


def use_review_dir(review_dir: Path | None) -> None:
    if review_dir:
        review.use_dir(review_dir)


def drafts_arg(ap: argparse.ArgumentParser, default: str) -> None:
    ap.add_argument("--drafts", type=Path, help=f"keep these drafts in another folder (default {default})")


def load_parser(sub, name: str, review_dir: bool = True) -> argparse.ArgumentParser:
    """A subcommand that writes to the review state: --dry-run only counts, --review-dir writes elsewhere."""
    p = sub.add_parser(name)
    p.add_argument("--dry-run", action="store_true")
    if review_dir:
        p.add_argument("--review-dir", type=Path)
    return p
