"""The map by meaning: each kanji where its meanings put it (Dani, 2026-10-18).

    .venv/Scripts/python pipeline/meaning_map.py texts   # what the site says about each kanji
    python pipeline/meaning_map.py embed                 # vectors, 2D per scope, clusters (torch, umap-learn)
    # name the clusters and regions: clusters-in.json -> names.json (pipeline/meaning_map_names.md)
    python pipeline/meaning_map.py adopt                 # a cluster for kanji in none, by their main meaning
    python pipeline/meaning_map.py near                  # how near every cluster is to every other
    python pipeline/meaning_map.py build                 # -> data/meaning_map.json, which the server serves

Each kanji is embedded from its hero sentence and its meaning groups (label +
about), as the page shows them, not from KANJIDIC's keywords: those are what put
右 by 権 via "right". t-SNE takes the vectors to 2D; only neighbourhoods mean
anything there, not the distance between two far clusters. Of each kanji's 10
nearest in the vectors, t-SNE (perplexity 30) keeps 45% among its 10 nearest on
the plane, UMAP 33-41% (n_neighbors 15 -> 5, min_dist 0), 2026-10-18.

Each map scope gets its own layout, started from the full one: the same
arrangement, without N5's 80 kanji scattered over a map made for 2,679. Size is
not here: the app keeps it, newspaper frequency, as on the parts map.

Clusters (HDBSCAN, about 140) are named for the zoomed-in map, regions (the
clusters gathered into REGIONS) for the zoomed-out one, in English and
Bulgarian. A changed meaning moves nothing until this is run again; ids are not
stable across runs, so the names are redone with it.

`adopt` gives a cluster to kanji HDBSCAN left in none. Those are mostly broad
kanji with unrelated meanings -- 本 is main, book, origin, "this", real and a
counter -- whose averaged vector falls between clusters: 人 本 長 時 社 発 者
are all out (Dani asked why, 2026-10-18). Each is placed by its first meaning
group alone, against the clusters' members' first groups, and only when it
clears the bar 90% of members clear for their own cluster (ADOPT): 人 ->
Common people, 本 -> Leaders, 時 -> Years and eras; 面 (0.57) and 革 (0.54)
stay in none. Where a kanji sits is unchanged: its place is all its meanings.

`near` grades every cluster against every other, for the map's highlight: a
double-click on a kanji lights its cluster, and the other clusters fade in
stages by how close they are in meaning (Dani, 2026-10-18). It reads the
clusters `embed` left, so it never renumbers them.

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
TEXTS, VECTORS, HTML = OUT / "texts.json", OUT / "vectors.npy", OUT / "map.html"
LAYOUT, CLUSTERS_IN, NAMES = OUT / "layout.json", OUT / "clusters-in.json", OUT / "names.json"
NEAR = OUT / "near.json"
MAIN_VECTORS, ADOPTED = OUT / "main-vectors.npy", OUT / "adopted.json"
ADOPT = 0.61  # the 10th percentile of members' similarity to their own cluster, by first groups
MAP = ROOT / "data" / "meaning_map.json"
MODEL = "Qwen/Qwen3-Embedding-0.6B"
REGIONS = 20  # the zoomed-out map's names


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
                         "groups": [en for en, _ in groups], "text": text,
                         # its first meaning group alone, which `adopt` places a kanji in no cluster by
                         "main": f"{groups[0][0]}: {groups[0][1]}" if groups else text})
    OUT.mkdir(parents=True, exist_ok=True)
    TEXTS.write_text(json.dumps(rows, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(rows)} kanji -> {TEXTS}")


def _scopes(rows: list[dict]) -> dict[str, list[int]]:
    """Which kanji each map scope shows, by the rule in server/routes/atlas.py (kanji only, no parts)."""
    out = {"all": list(range(len(rows))), "common": [i for i, r in enumerate(rows) if r["freq"] is not None]}
    for level in range(1, 6):
        out[str(level)] = [i for i, r in enumerate(rows) if r["jlpt"] is not None and r["jlpt"] >= level]
    return out


def embed() -> None:
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
    from sklearn.cluster import HDBSCAN, AgglomerativeClustering
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.manifold import TSNE

    # Every kanji first; each narrower scope then starts from where its kanji
    # sit there, so N5 keeps the full map's arrangement but closes its gaps.
    full = TSNE(perplexity=30, metric="cosine", init="pca", random_state=7).fit_transform(vec)
    layouts = {"all": full}
    for name, idx in _scopes(rows).items():
        if name == "all":
            continue
        init = full[idx] - full[idx].mean(0)
        init *= 1e-4 / init[:, 0].std()  # the scale sklearn gives its own PCA start
        perp = min(30.0, max(5.0, (len(idx) - 1) / 3))
        layouts[name] = TSNE(perplexity=perp, metric="cosine", init=init, random_state=7).fit_transform(vec[idx])

    # Clusters on a 10-D UMAP, not the 2-D one: steadier, and not fooled by the squash to a plane.
    lab = HDBSCAN(min_cluster_size=8, min_samples=4).fit_predict(
        umap.UMAP(n_neighbors=10, n_components=10, min_dist=0.0, metric="cosine", random_state=7).fit_transform(vec))
    keys = sorted({int(l) for l in lab if l >= 0})
    renum = {k: i for i, k in enumerate(keys)}
    lab = np.array([renum.get(int(l), -1) for l in lab])
    # Regions: the clusters gathered again by their mean vectors, for the zoomed-out map.
    means = np.stack([vec[lab == k].mean(0) for k in range(len(keys))])
    means /= np.linalg.norm(means, axis=1, keepdims=True)
    region = AgglomerativeClustering(n_clusters=REGIONS, linkage="ward").fit_predict(means)

    # A first guess at each name, for whoever names them: the words a cluster's
    # group labels use more than the rest do.
    docs = [" ".join(" ".join(rows[i]["groups"]) or rows[i]["text"] for i in np.flatnonzero(lab == k))
            for k in range(len(keys))]
    tf = TfidfVectorizer(stop_words="english", token_pattern=r"[a-z]{3,}", sublinear_tf=True)
    m = tf.fit_transform(docs)
    vocab = tf.get_feature_names_out()
    hint = [" / ".join(vocab[j] for j in m[k].toarray()[0].argsort()[::-1][:4]) for k in range(len(keys))]

    def members(sel) -> list[dict]:
        ids = sorted(np.flatnonzero(sel), key=lambda i: rows[i]["freq"] or 9999)
        return [{"char": rows[i]["char"], "groups": rows[i]["groups"]} for i in ids[:30]]

    clusters_in = {
        "clusters": [{"id": k, "region": int(region[k]), "hint": hint[k], "size": int((lab == k).sum()),
                      "kanji": members(lab == k)} for k in range(len(keys))],
        "regions": [{"id": g, "clusters": [k for k in range(len(keys)) if region[k] == g]} for g in range(REGIONS)],
    }
    CLUSTERS_IN.write_text(json.dumps(clusters_in, ensure_ascii=False, indent=1), encoding="utf-8")
    LAYOUT.write_text(json.dumps({
        "chars": [r["char"] for r in rows],
        "cluster": [int(l) for l in lab],
        "region": [int(g) for g in region],
        "layouts": {n: {"idx": [int(i) for i in _scopes(rows)[n]], "xy": [[round(float(a), 3), round(float(b), 3)] for a, b in xy]}
                    for n, xy in layouts.items()},
    }), encoding="utf-8")
    print(f"{len(rows)} kanji, {len(keys)} clusters in {REGIONS} regions, {int((lab < 0).sum())} unclustered")
    print(f"-> {LAYOUT}, {CLUSTERS_IN}; name them into {NAMES}, then `build`")


def adopt() -> None:
    import numpy as np

    rows = json.loads(TEXTS.read_text(encoding="utf-8"))
    lay = json.loads(LAYOUT.read_text(encoding="utf-8"))
    assert [r["char"] for r in rows] == lay["chars"], "texts.json no longer matches the layout: run embed again"
    if MAIN_VECTORS.exists() and len(np.load(MAIN_VECTORS)) == len(rows):
        vec = np.load(MAIN_VECTORS)
    else:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(MODEL, device="cuda")
        vec = model.encode([r["main"] for r in rows], batch_size=64, normalize_embeddings=True)
        np.save(MAIN_VECTORS, vec)
    lab = np.array(lay["cluster"])
    means = np.stack([vec[lab == k].mean(0) for k in range(len(lay["region"]))])
    sim = vec @ (means / np.linalg.norm(means, axis=1, keepdims=True)).T
    own = np.array([sim[i, lab[i]] for i in np.flatnonzero(lab >= 0)])
    out = {}
    for i in np.flatnonzero(lab < 0):
        k = int(sim[i].argmax())
        if sim[i, k] >= ADOPT:
            out[rows[i]["char"]] = k
    ADOPTED.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"members' own-cluster similarity, 10th percentile: {np.percentile(own, 10):.3f} (ADOPT = {ADOPT})")
    print(f"{len(out)} of {int((lab < 0).sum())} kanji in no cluster adopted -> {ADOPTED}")


def near() -> None:
    """Per cluster, a stage per cluster: 3 itself, 2 near, 1 related, 0 not.

    Whole clusters, not single kanji: a lit cluster's neighbours fade as
    patches, which reads; kanji graded one by one speckled the map (Dani,
    2026-10-18). Nearness is the cosine of the clusters' mean vectors: near =
    the 3 closest at >= 0.66 (about the top tenth of all pairs), related = the
    8 closest at >= 0.60. Birds: near = Wild animals, Insects; related = Fish
    and hunting, Shaking and leaping.
    """
    import numpy as np

    lay = json.loads(LAYOUT.read_text(encoding="utf-8"))
    vec = np.load(VECTORS)
    lab = np.array(lay["cluster"])
    n = len(lay["region"])
    means = np.stack([vec[lab == k].mean(0) for k in range(n)])
    means /= np.linalg.norm(means, axis=1, keepdims=True)
    sim = means @ means.T
    out = []
    for k in range(n):
        stage = [0] * n
        stage[k] = 3
        others = [j for j in np.argsort(-sim[k]) if j != k]
        for rank, j in enumerate(others[:8]):
            if rank < 3 and sim[k, j] >= 0.66:
                stage[j] = 2
            elif sim[k, j] >= 0.60:
                stage[j] = 1
        out.append("".join(map(str, stage)))
    NEAR.write_text(json.dumps(out), encoding="utf-8")
    print(f"{n} clusters graded -> {NEAR}")


def build() -> None:
    """data/meaning_map.json, what the server serves: names, clusters, a layout per scope."""
    lay = json.loads(LAYOUT.read_text(encoding="utf-8"))
    names = json.loads(NAMES.read_text(encoding="utf-8"))
    nears = json.loads(NEAR.read_text(encoding="utf-8"))
    adopted = json.loads(ADOPTED.read_text(encoding="utf-8")) if ADOPTED.exists() else {}
    n_clusters = len(lay["region"])
    assert len(names["clusters"]) == n_clusters and len(names["regions"]) == REGIONS, "names do not match the layout"
    chars = lay["chars"]
    out = {
        "about": f"pipeline/meaning_map.py: {MODEL} over hero + meaning groups, t-SNE per scope, HDBSCAN clusters",
        "regions": [{"en": r["en"], "bg": r["bg"]} for r in names["regions"]],
        # near: a digit per cluster, how near it is to this one (see near())
        "clusters": [{"en": c["en"], "bg": c["bg"], "region": lay["region"][i], "near": nears[i]}
                     for i, c in enumerate(names["clusters"])],
        "cluster": {c: adopted.get(c, k) for c, k in zip(chars, lay["cluster"])},
        "layouts": {n: {chars[i]: xy for i, xy in zip(L["idx"], L["xy"])} for n, L in lay["layouts"].items()},
    }
    MAP.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{MAP}: {len(chars)} kanji, {n_clusters} clusters, {MAP.stat().st_size // 1024} KB")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for c in ("texts", "embed", "adopt", "near", "build"):
        sub.add_parser(c)
    {"texts": texts, "embed": embed, "adopt": adopt, "near": near, "build": build}[ap.parse_args().cmd]()


if __name__ == "__main__":
    main()
