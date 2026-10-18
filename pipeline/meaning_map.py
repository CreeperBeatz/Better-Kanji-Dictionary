"""A map of kanji by meaning: each kanji where its meanings put it (Dani, 2026-10-18).

    .venv/Scripts/python pipeline/meaning_map.py texts    # what the site says about each kanji
    python pipeline/meaning_map.py embed [--method umap]  # vectors, 2D, clusters (needs torch, umap-learn)
    python pipeline/meaning_map.py html                   # pipeline/data/meaning-map/map.html

A prototype, to judge by eye before anything goes into the app. Each kanji is
embedded from its hero sentence and its meaning groups (label + about), as the
page shows them, not from KANJIDIC's keywords: those are what put 右 by 権 via
"right". t-SNE takes the vectors to 2D; only neighbourhoods mean anything there,
not the distance between two far clusters. Of each kanji's 10 nearest in the
vectors, t-SNE (perplexity 30) keeps 45% among its 10 nearest on the plane,
UMAP 33-41% (n_neighbors 15 -> 5, min_dist 0), 2026-10-18. Size is the map's own: newspaper
frequency, the same formula as web/src/map/mapData.ts.

`texts` imports the server, so it runs in the project venv; `embed` needs torch,
which the venv does not have.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pipeline" / "data" / "meaning-map"
TEXTS, VECTORS, POINTS, HTML = OUT / "texts.json", OUT / "vectors.npy", OUT / "points.json", OUT / "map.html"
MODEL = "Qwen/Qwen3-Embedding-0.6B"


def texts() -> None:
    sys.path.insert(0, str(ROOT))
    sys.path.insert(0, str(ROOT / "pipeline"))
    import proposals
    from server import scope
    from server.routes.search import kanji_page

    conn = proposals.connect()
    rows = []
    for c in scope.kanji(conn):
        page = kanji_page(c)
        freq, jlpt, kd = conn.execute("SELECT freq, jlpt, meanings FROM kanji WHERE char = ?", (c,)).fetchone()
        groups = [(m["en"], m["about"] or "") for m in page["meanings"]]
        parts = [page.get("hero") or ""] + [f"{en}: {about}" for en, about in groups]
        text = " ".join(p for p in parts if p).strip()
        if not text:  # nothing of ours yet: fall back to KANJIDIC
            text = "; ".join(json.loads(kd or "[]"))
        if text:
            rows.append({"char": c, "freq": freq, "jlpt": jlpt, "hero": page.get("hero"),
                         "groups": [en for en, _ in groups], "text": text})
    OUT.mkdir(parents=True, exist_ok=True)
    TEXTS.write_text(json.dumps(rows, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(rows)} kanji -> {TEXTS}")


def embed(method: str, neighbours: int, min_dist: float) -> None:
    import numpy as np

    rows = json.loads(TEXTS.read_text(encoding="utf-8"))
    if VECTORS.exists() and len(np.load(VECTORS)) == len(rows):
        vec = np.load(VECTORS)
    else:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(MODEL, device="cuda")
        vec = model.encode([r["text"] for r in rows], batch_size=32, normalize_embeddings=True, show_progress_bar=True)
        np.save(VECTORS, vec)

    import umap
    from sklearn.cluster import HDBSCAN
    from sklearn.feature_extraction.text import TfidfVectorizer

    if method == "tsne":
        from sklearn.manifold import TSNE
        xy = TSNE(perplexity=30, metric="cosine", init="pca", random_state=7).fit_transform(vec)
    else:
        xy = umap.UMAP(n_neighbors=neighbours, min_dist=min_dist, metric="cosine", random_state=7).fit_transform(vec)
    # Clusters on a 10-D UMAP, not the 2-D one: steadier, and not fooled by the squash to a plane.
    lab = HDBSCAN(min_cluster_size=8, min_samples=4).fit_predict(
        umap.UMAP(n_neighbors=neighbours, n_components=10, min_dist=0.0, metric="cosine", random_state=7).fit_transform(vec))

    # A cluster's name: the words its kanji's group labels use more than the rest do.
    docs = {}
    for r, l in zip(rows, lab):
        if l >= 0:
            docs.setdefault(int(l), []).append(" ".join(r["groups"]) or r["text"])
    keys = sorted(docs)
    tf = TfidfVectorizer(stop_words="english", token_pattern=r"[a-z]{3,}", sublinear_tf=True)
    m = tf.fit_transform([" ".join(docs[k]) for k in keys])
    vocab = tf.get_feature_names_out()
    names = {k: " · ".join(vocab[j] for j in m[i].toarray()[0].argsort()[::-1][:3]) for i, k in enumerate(keys)}

    pts = [{"c": r["char"], "f": r["freq"], "j": r["jlpt"], "x": round(float(p[0]), 4), "y": round(float(p[1]), 4),
            "k": int(l), "h": r["hero"] or "", "g": r["groups"]} for r, p, l in zip(rows, xy, lab)]
    POINTS.write_text(json.dumps({"points": pts, "clusters": names}, ensure_ascii=False), encoding="utf-8")
    print(f"{len(pts)} points, {len(names)} clusters, {sum(l < 0 for l in lab)} unclustered -> {POINTS}")


def html() -> None:
    data = POINTS.read_text(encoding="utf-8")
    HTML.write_text(PAGE.replace("/*DATA*/null", data), encoding="utf-8")
    print(HTML)


PAGE = r"""<!doctype html>
<meta charset="utf-8">
<title>Kanji by meaning</title>
<style>
  html, body { margin: 0; height: 100%; background: #faf8f4; font: 13px system-ui, sans-serif; overflow: hidden }
  canvas { display: block; cursor: grab }
  #tip { position: fixed; pointer-events: none; max-width: 320px; background: #fff; border: 1px solid #ddd;
         border-radius: 6px; padding: 8px 10px; box-shadow: 0 2px 10px #0002; display: none }
  #tip b { font-size: 28px; font-family: "Noto Serif JP", serif; margin-right: 6px }
  #tip .g { color: #666; margin: 2px 0 6px } #tip .h { color: #222 }
  #bar { position: fixed; top: 8px; left: 8px; background: #fffd; padding: 6px 10px; border-radius: 6px; border: 1px solid #ddd }
</style>
<div id="bar">Kanji by meaning · size = frequency · colour = cluster ·
  <label><input type="checkbox" id="names" checked> cluster names</label>
  <input id="q" placeholder="find 海" size="5"></div>
<canvas id="cv"></canvas><div id="tip"></div>
<script type="module">
import { forceSimulation, forceX, forceY, forceCollide } from 'https://cdn.jsdelivr.net/npm/d3-force@3/+esm'
const D = /*DATA*/null
const P = D.points
// The map's own size (web/src/map/mapData.ts sizeOf, frequency part)
const size = f => f ? 4 + 9 * (1 - Math.log(f) / Math.log(2600)) : 3
// Spread UMAP's units so the kanji fill about a third of the area, then let collisions settle them
let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y) }
const area = P.reduce((a, p) => a + Math.PI * size(p.f) ** 2, 0) * 3
const s = Math.sqrt(area / ((x1 - x0) * (y1 - y0)))
for (const p of P) { p.r = size(p.f); p.tx = (p.x - x0) * s; p.ty = (p.y - y0) * s; p.x = p.tx; p.y = p.ty }
const sim = forceSimulation(P).force('x', forceX(p => p.tx).strength(0.4)).force('y', forceY(p => p.ty).strength(0.4))
  .force('c', forceCollide(p => p.r + 0.6).iterations(2)).stop()
for (let i = 0; i < 200; i++) sim.tick()

const K = Object.keys(D.clusters).length
const colour = k => k < 0 ? '#b5b0a8' : `hsl(${(k * 137.508) % 360} 55% 40%)`
const centres = {}
for (const p of P) if (p.k >= 0) { const c = centres[p.k] ??= { x: 0, y: 0, n: 0 }; c.x += p.x; c.y += p.y; c.n++ }

const cv = document.getElementById('cv'), ctx = cv.getContext('2d'), tip = document.getElementById('tip')
let W, H, dpr, z, ox, oy, hot = null, found = null
function fit() {
  dpr = devicePixelRatio; W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr
  cv.style.width = W + 'px'; cv.style.height = H + 'px'
}
fit()
{ const w = (x1 - x0) * s, h = (y1 - y0) * s; z = Math.min(W / w, H / h) * 0.95; ox = (W - w * z) / 2; oy = (H - h * z) / 2 }
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  for (const p of P) {
    const r = p.r * z, X = p.x * z + ox, Y = p.y * z + oy
    if (X < -r || Y < -r || X > W + r || Y > H + r) continue
    ctx.fillStyle = colour(p.k)
    if (r < 3) { ctx.fillRect(X - r * .6, Y - r * .6, r * 1.2, r * 1.2); continue }
    ctx.font = `${(r * 1.7) | 0}px "Noto Serif JP", "Yu Mincho", serif`
    ctx.fillText(p.c, X, Y)
  }
  if (document.getElementById('names').checked) {
    ctx.font = '600 12px system-ui'
    for (const [k, c] of Object.entries(centres)) {
      if (c.n < 8) continue
      const X = c.x / c.n * z + ox, Y = c.y / c.n * z + oy, t = D.clusters[k]
      ctx.fillStyle = '#fffc'; const w = ctx.measureText(t).width; ctx.fillRect(X - w / 2 - 3, Y - 8, w + 6, 16)
      ctx.fillStyle = colour(+k); ctx.fillText(t, X, Y)
    }
  }
  for (const p of [hot, found]) if (p) {
    ctx.strokeStyle = '#e34234'; ctx.lineWidth = 2; ctx.beginPath()
    ctx.arc(p.x * z + ox, p.y * z + oy, Math.max(6, p.r * z * 1.2), 0, 7); ctx.stroke()
  }
}
draw()
let drag = null
cv.onmousedown = e => drag = { x: e.clientX - ox, y: e.clientY - oy }
onmouseup = () => drag = null
onmousemove = e => {
  if (drag) { ox = e.clientX - drag.x; oy = e.clientY - drag.y; draw(); return }
  const wx = (e.clientX - ox) / z, wy = (e.clientY - oy) / z
  let best = null, bd = Infinity
  for (const p of P) { const d = (p.x - wx) ** 2 + (p.y - wy) ** 2; if (d < bd) { bd = d; best = p } }
  hot = best && Math.sqrt(bd) < best.r * 1.3 + 4 / z ? best : null
  if (hot) {
    tip.innerHTML = `<b>${hot.c}</b>${hot.f ? '#' + hot.f : ''} ${hot.j ? 'N' + hot.j : ''}
      <div class="g">${hot.g.join(' · ')}</div><div class="h">${hot.h}</div>
      <div class="g">${hot.k >= 0 ? D.clusters[hot.k] : 'no cluster'}</div>`
    tip.style.display = 'block'
    tip.style.left = Math.min(e.clientX + 14, W - 340) + 'px'; tip.style.top = Math.min(e.clientY + 14, H - 160) + 'px'
  } else tip.style.display = 'none'
  draw()
}
cv.onwheel = e => {
  e.preventDefault(); const f = Math.exp(-e.deltaY * 0.0015)
  ox = e.clientX - (e.clientX - ox) * f; oy = e.clientY - (e.clientY - oy) * f; z *= f; draw()
}
onresize = () => { fit(); draw() }
document.getElementById('names').onchange = draw
document.getElementById('q').oninput = e => {
  found = P.find(p => p.c === e.target.value.trim()) ?? null
  if (found) { z = Math.max(z, 4); ox = W / 2 - found.x * z; oy = H / 2 - found.y * z }
  draw()
}
</script>
"""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("texts")
    e = sub.add_parser("embed")
    e.add_argument("--method", choices=("tsne", "umap"), default="tsne")
    e.add_argument("--neighbours", type=int, default=10, help="umap only")
    e.add_argument("--min-dist", type=float, default=0.0, help="umap only")
    sub.add_parser("html")
    a = ap.parse_args()
    if a.cmd == "texts":
        texts()
    elif a.cmd == "embed":
        embed(a.method, a.neighbours, a.min_dist)
    else:
        html()


if __name__ == "__main__":
    main()
