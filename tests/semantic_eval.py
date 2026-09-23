"""Which model answers semantic search best: a small graded benchmark.

Each model runs twice: on its own, and with the decomposition graph behind it
("+parts") -- asked also for the parts a described character is made of, whose
characters server/kanji_parts.py then finds and puts first.

Each query has the answers that count as right. A model scores top-1 when its
first suggestion is one of them, top-3 when one is among its first three --
kanji for the visual and comparison queries, words for the word queries.

    python tests/semantic_eval.py                     # every model below
    python tests/semantic_eval.py --only haiku-4.5    # some of them
    python tests/semantic_eval.py --budget 1.0        # stop spending past $1

Answers go to data/semantic-eval/<model>.json so they can be re-scored without
paying again. OPENROUTER_API_KEY must be set; the key's weekly limit is what
the site itself runs on, so keep --budget well under what is left of it.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from server import kanji_parts  # noqa: E402
from server import semantic as sem  # noqa: E402

OUT = Path(__file__).parent.parent / "data" / "semantic-eval"

# (group, query, answers that count as right)
CASES: list[tuple[str, str, set[str]]] = [
    # Described by shape or by parts -- the thing that gave mixed results.
    ("visual", "sun on the left and moon on the right", {"明"}),
    ("visual", "three trees", {"森"}),
    ("visual", "a person leaning against a tree", {"休"}),
    ("visual", "field on top and power underneath", {"男"}),
    ("visual", "a big mouth with a small mouth inside it", {"回"}),
    ("visual", "three mouths stacked in a pyramid", {"品"}),
    ("visual", "a roof with a woman under it", {"安"}),
    ("visual", "gate with an ear inside", {"聞"}),
    ("visual", "gate with a sun inside", {"間"}),
    ("visual", "like 大 but with a dot in the bottom middle", {"太"}),
    ("visual", "like 大 with a dot at the top right", {"犬"}),
    ("visual", "stand on top of sun", {"音"}),
    ("visual", "stand on top, sun in the middle, heart at the bottom", {"意"}),
    ("visual", "cow on the left and 勿 on the right", {"物"}),
    ("visual", "thread radical on the left and winter on the right", {"終"}),
    ("visual", "mouth next to a bird", {"鳴"}),
    ("visual", "three horizontal strokes crossed by one vertical stroke", {"王"}),
    ("visual", "grass radical on top of the kanji for change", {"花"}),
    ("visual", "speech on the left, and five over mouth on the right", {"語"}),
    ("visual", "tree on the left with public on the right", {"松"}),
    ("visual", "water drops on the left and blue on the right", {"清"}),
    ("visual", "a heart under a rice field", {"思"}),
    ("visual", "sun with a line under it, like the sun over the horizon", {"旦"}),
    ("visual", "roof with a pig under it", {"家"}),
    ("visual", "person radical next to speech", {"信"}),
    ("visual", "fish on the left and blue on the right", {"鯖"}),
    ("visual", "a box with a cross inside", {"田"}),
    ("visual", "two people sitting on the ground under a cliff roof", {"座"}),
    ("visual", "a woman next to a broom", {"婦"}),
    ("visual", "sun next to a temple", {"時"}),
    # Harder: parts in their squeezed or split forms, described as a learner sees them.
    ("hard", "king on top and clothes on the bottom", {"表"}),
    ("hard", "clothes radical on the left and valley on the right", {"裕"}),
    ("hard", "heart radical on the left and life on the right", {"性"}),
    ("hard", "dog and moon above four fire dots", {"然"}),
    ("hard", "rain on top of a rice field", {"雷"}),
    ("hard", "bamboo on top of temple", {"等"}),
    ("hard", "dog radical on the left and seedling on the right", {"猫"}),
    ("hard", "sheep on top of big", {"美"}),
    ("hard", "a net on top of a shell", {"買"}),
    ("hard", "a claw on top, a crown in the middle, again at the bottom", {"受"}),
    ("hard", "old man on top of a child", {"孝"}),
    ("hard", "clothes split open with a village in the middle", {"裏"}),
    ("hard", "clothes split open with a mouth in the middle", {"哀"}),
    ("hard", "the road radical wrapped under a neck", {"道"}),
    ("hard", "hill radical on the left and complete on the right", {"院"}),
    ("hard", "foot on the left and each on the right", {"路"}),
    ("hard", "car on the left and cloud-like 云 on the right", {"転"}),
    ("hard", "metal on the left and same on the right", {"銅"}),
    ("hard", "clothes radical and a sword", {"初"}),
    ("hard", "altar radical next to older brother", {"祝"}),
    # Which of several close kanji.
    ("compare", "which 'hot' is for the weather?", {"暑"}),
    ("compare", "which 'hot' do I use for a hot drink?", {"熱"}),
    ("compare", "which kanji for 'hard' meaning difficult", {"難"}),
    ("compare", "which 'to listen' for listening attentively to music", {"聴"}),
    ("compare", "which 'fast' kanji is for speed, like a fast car", {"速"}),
    ("compare", "which 'to meet' for running into an accident or disaster", {"遭"}),
    ("compare", "which 'to cry' is for birds or animals making sounds", {"鳴"}),
    # A word, described.
    ("word", "the feeling of missing the old days", {"懐かしい"}),
    ("word", "what you say before eating", {"頂きます", "いただきます"}),
    ("word", "what you say when you get back home", {"只今", "ただいま"}),
    ("word", "the rainy season in early summer", {"梅雨"}),
    ("word", "the paper sliding door in traditional houses", {"障子"}),
    ("word", "the heated low table with a blanket", {"炬燵", "こたつ", "火燵"}),
    ("word", "a person with no sense of direction", {"方向音痴"}),
]

LOW = {"effort": "low"}
# Small models, and the one in use now as the baseline, last so a budget cut drops it.
MODELS: dict[str, tuple[str, dict | None]] = {
    "gpt-6-luna": ("openai/gpt-6-luna", LOW),
    "qwen3.8-flash": ("qwen/qwen3.8-flash", LOW),
    "deepseek-v4.1-flash": ("deepseek/deepseek-v4.1-flash", LOW),
    "glm-5.3-flash": ("z-ai/glm-5.3-flash", LOW),
    "gemini-3.8-flash": ("google/gemini-3.8-flash", LOW),
    "haiku-4.5": ("anthropic/claude-haiku-4.5", None),
    "sonnet-5-low": ("anthropic/claude-sonnet-5", LOW),
}

def prompt(with_parts: bool) -> str:
    """The site's prompt, which asks for parts -- or, for the plain runs, the
    same with that rule and field taken out."""
    base = sem._PROMPT.replace("{language}", "English")
    if with_parts:
        return base
    base = base[: base.index('- "parts":')] + base[base.index('- Write "why"') :]
    return base.replace(', "parts": [["..."]]}', "}")


def parts_of(raw: dict) -> list[list[str]]:
    out = []
    for p in raw.get("parts") or []:
        if isinstance(p, str):
            p = [p]
        if isinstance(p, list):
            forms = [f.strip() for f in p if isinstance(f, str) and f.strip()]
            if forms:
                out.append(forms)
    return out


def ask(model: str, reasoning: dict | None, q: str, with_parts: bool) -> dict:
    body = {
        "model": model,
        "max_tokens": 4000,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": prompt(with_parts)},
            {"role": "user", "content": q},
        ],
    }
    if reasoning:
        body["reasoning"] = reasoning
    t = time.time()
    try:
        r = requests.post(sem.URL, headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"}, json=body, timeout=120)
        d = r.json()
        choice = d["choices"][0]
        raw = sem._parse(choice["message"]["content"] or "")
        answer = sem._clean(raw)
        answer["parts"] = parts_of(raw) if with_parts else []
        answer["model_kanji"] = [k["char"] for k in answer["kanji"]]
        if answer["parts"]:
            answer["kanji"] = [{"char": c, "why": None} for c in kanji_parts.rerank(answer["model_kanji"], answer["parts"])]
        error = None
    except Exception as e:  # noqa: BLE001 -- a failure is a result here
        d, answer, error = locals().get("d") or {}, {"kanji": [], "words": [], "note": None}, f"{type(e).__name__}: {e}"
    usage = d.get("usage") or {}
    return {
        "q": q,
        "seconds": round(time.time() - t, 1),
        "cost": usage.get("cost") or 0,
        "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
        "answer": answer,
        "error": error,
    }


def score(group: str, got: list[str], right: set[str]) -> tuple[bool, bool]:
    return bool(got[:1]) and got[0] in right, any(g in right for g in got[:3])


def picks(group: str, answer: dict, view: str) -> list[str]:
    """What the page would list first: words for word queries, else kanji --
    as the model gave them ("model"), or checked against the parts ("db")."""
    if group == "word":
        return [w["word"] for w in answer["words"]]
    model = answer.get("model_kanji") or [k["char"] for k in answer["kanji"]]
    if view == "db" and answer.get("parts"):
        return kanji_parts.rerank(model, answer["parts"])
    return model


GROUPS = ["visual", "hard", "compare", "word"]


def load(name: str) -> dict[str, dict]:
    path = OUT / f"{name}.json"
    return {r["q"]: r for r in json.loads(path.read_text(encoding="utf-8"))} if path.exists() else {}


def report(models: list[str]) -> None:
    print(f"\n{'model':32} " + " ".join(f"{g:>13}" for g in GROUPS) + f" {'all top1':>9} {'median s':>9} {'$ / 100':>8} {'fails':>6}")
    rows = [(f"{m}", m, "model") for m in models]
    rows += [(f"{m} +parts, model's own list", f"{m}+parts", "model") for m in models]
    rows += [(f"{m} +parts, checked by the db", f"{m}+parts", "db") for m in models]
    rows.sort(key=lambda r: models.index(r[1].removesuffix("+parts")))
    for label, name, view in rows:
        results = load(name)
        if not results:
            continue
        cells, top1_all = [], 0
        for g in GROUPS:
            cases = [c for c in CASES if c[0] == g and c[1] in results]
            s = [score(g, picks(g, results[q]["answer"], view), right) for _, q, right in cases]
            t1, t3 = sum(a for a, _ in s), sum(b for _, b in s)
            top1_all += t1
            cells.append(f"{t1:>2}/{t3:>2} of {len(cases):>2}")
        rs = [results[c[1]] for c in CASES if c[1] in results]
        secs = sorted(r["seconds"] for r in rs)
        cost = sum(r["cost"] for r in rs) / len(rs) * 100
        fails = sum(1 for r in rs if r["error"])
        print(f"{label:32} " + " ".join(f"{c:>13}" for c in cells) + f" {top1_all:>5}/{len(rs)} {secs[len(secs) // 2]:>9} {cost:>8.2f} {fails:>6}")
    print("\ncells are top-1/top-3 right of the group's queries; $ / 100 is the cost of 100 queries")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--budget", type=float, default=0.4)
    ap.add_argument("--report", action="store_true", help="only re-score what is saved")
    args = ap.parse_args()
    models = [n for n in MODELS if not args.only or n in args.only]
    OUT.mkdir(parents=True, exist_ok=True)
    if not args.report:
        spent = 0.0
        for name in [f"{n}{m}" for n in models for m in ("", "+parts")]:
            saved = load(name)
            # Only what is missing or failed: a new query, or one the provider dropped.
            todo = [c for c in CASES if c[1] not in saved or saved[c[1]]["error"]]
            if not todo:
                continue
            if spent >= args.budget:
                print(f"{name}: over the ${args.budget} budget, {len(todo)} left undone")
                continue
            model, reasoning = MODELS[name.removesuffix("+parts")]
            with_parts = name.endswith("+parts")
            with ThreadPoolExecutor(4) as ex:
                results = list(ex.map(lambda c: ask(model, reasoning, c[1], with_parts), todo))
            cost = sum(r["cost"] for r in results)
            spent += cost
            saved.update({r["q"]: r for r in results})
            (OUT / f"{name}.json").write_text(json.dumps(list(saved.values()), ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"{name}: {len(todo)} asked, ${cost:.3f} (total ${spent:.3f}), {sum(1 for r in results if r['error'])} failed", flush=True)
    report(models)


if __name__ == "__main__":
    main()
