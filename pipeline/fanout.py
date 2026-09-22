# -*- coding: utf-8 -*-
import json
from collections import Counter, defaultdict
G = json.load(open('graph.json', encoding='utf-8'))
comps = {k:set(v) for k,v in G['comps'].items()}
TARGET = set(G['target'])
K = json.load(open('kanji.json', encoding='utf-8'))

# transitive ancestors: which TARGET kanji contain component c (at any depth)
anc = defaultdict(set)
def descend(root, node, seen):
    for c in comps.get(node, ()):
        if c in seen: continue
        seen.add(c); anc[c].add(root); descend(root, c, seen)
for t in TARGET: descend(t, t, set())

EXTRA = set(comps) - TARGET
fan = Counter({c: len(anc[c]) for c in EXTRA})
dist = Counter(fan.values())
print("Fan-out of the 391 non-target prerequisite components")
print("(how many N5-N2 kanji each one appears inside)")
print(f"{'fan-out':>10} {'# components':>14}   cumulative")
cum=0
for f in sorted(dist, reverse=True):
    cum+=dist[f]
print(f"  appears in 1 target kanji only : {dist[1]:>4}  <- pure overhead, inline these")
print(f"  appears in 2 target kanji      : {dist[2]:>4}")
print(f"  appears in 3-5 target kanji    : {sum(v for k,v in dist.items() if 3<=k<=5):>4}")
print(f"  appears in 6-10 target kanji   : {sum(v for k,v in dist.items() if 6<=k<=10):>4}")
print(f"  appears in 11+ target kanji    : {sum(v for k,v in dist.items() if k>=11):>4}  <- highest value")
print()
print("TOP 30 non-target components by unlock power:")
for c,n in fan.most_common(30):
    _m=K.get(c,{}).get('meanings') or ['(bound form, not a standalone kanji)']; nm=_m[0]
    lv = K.get(c,{}).get('jlpt_new')
    tag = f"N{lv}" if lv else ("joyo" if K.get(c,{}).get('grade') else "--")
    print(f"  {c}  {n:>3} kanji  [{tag:>4}]  {nm}")
print()
print("Sample of fan-out-1 components (candidates to NOT teach separately):")
ones = [c for c in EXTRA if fan[c]==1]
print("  " + " ".join(ones[:60]))
json.dump({c:fan[c] for c in EXTRA}, open('fanout.json','w',encoding='utf-8'), ensure_ascii=False)
