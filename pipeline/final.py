# -*- coding: utf-8 -*-
import json
from collections import defaultdict, Counter
G=json.load(open('graph.json',encoding='utf-8')); K=json.load(open('kanji.json',encoding='utf-8'))
comps={k:set(v) for k,v in G['comps'].items()}; TARGET=set(G['target'])
def on(c): return set(K.get(c,{}).get('readings_on') or [])
SEMANTIC=set("亻氵扌糹⺮忄辶阝艹卄⺿彳礻衤犭訁言口木水火土金手心日月目田糸虫貝金食車馬魚鳥女子宀广厂疒尸穴竹米舟刀刂力氏灬⺊⺈⺁𠂉")
holders=defaultdict(set)
for t in TARGET:
    for c in comps.get(t,()): holders[c].add(t)
cov=set(); series=[]
for c,ks in holders.items():
    if c in SEMANTIC or len(ks)<2: continue
    cnt=Counter()
    for k in ks:
        for r in on(k): cnt[r]+=1
    if not cnt: continue
    top,n=cnt.most_common(1)[0]
    if n>=2:
        hit={k for k in ks if top in on(k)}; cov|=hit; series.append((n,c,top,sorted(hit)))
print(f"PHONETIC SERIES, semantic radicals excluded  (scope = N5-N2)")
print(f"   genuine phonetic series: {len(series)}")
print(f"   N5-N2 kanji whose on'yomi is predicted by a component: {len(cov)}/{len(TARGET)} ({100*len(cov)/len(TARGET):.0f}%)")

# ---- deliverable: ordered list ----
orders=json.load(open('orders.json',encoding='utf-8')); fan=json.load(open('fanout.json',encoding='utf-8'))
out=[]
for i,c in enumerate(orders['cheap'],1):
    v=K.get(c,{})
    lv=v.get('jlpt_new'); kind=f"N{lv}" if lv in (5,4,3,2) else ("N1" if lv==1 else "COMP")
    mean="; ".join((v.get('meanings') or [])[:4]) or "(bound component)"
    out.append(f"{i}\t{c}\t{kind}\t{mean}\t{'/'.join((v.get('readings_on') or [])[:3])}\t{fan.get(c,'')}")
import os
d="C:/Users/dani/Documents/BetterRTK"
open(d+"/order-n2.tsv","w",encoding="utf-8").write(
  "idx\tchar\tlevel\tmeanings\ton_yomi\tfanout\n"+"\n".join(out)+"\n")
print(f"\nWrote {len(out)} items -> BetterRTK/order-n2.tsv")
print("\nItems 1-40:")
print("  "+"  ".join(orders['cheap'][:40]))
print("Items 200-240:")
print("  "+"  ".join(orders['cheap'][200:240]))
print("Items 1150-1191 (the tail):")
print("  "+"  ".join(orders['cheap'][1150:]))
