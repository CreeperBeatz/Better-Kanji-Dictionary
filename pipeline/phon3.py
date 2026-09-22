# -*- coding: utf-8 -*-
import json,re
from collections import defaultdict, Counter
exec(open('build.py',encoding='utf-8').read().split('# ---------- load kanji data')[0])  # reuse parser
K=json.load(open('kanji.json',encoding='utf-8'))
def on(c): return set(K.get(c,{}).get('readings_on') or [])
comps={}
def walk(ch,stack=()):
    if ch in comps: return
    if ch in stack: comps[ch]=set(); return
    d=direct_components(ch); comps[ch]=d
    for c in d: walk(c,stack+(ch,))

T2={k for k,v in K.items() if v.get('jlpt_new') in (5,4,3,2)}
TALL={k for k,v in K.items() if v.get('jlpt_new')}
for k in TALL: walk(k)

def analyse(scope,label):
    holders=defaultdict(set)
    for t in scope:
        for c in comps.get(t,()): holders[c].add(t)
    cov=set(); ns=0; big=[]
    for c,ks in holders.items():
        if len(ks)<2: continue
        cnt=Counter()
        for k in ks:
            for r in on(k): cnt[r]+=1
        if not cnt: continue
        top,n=cnt.most_common(1)[0]
        if n>=2:
            ns+=1; hit={k for k in ks if top in on(k)}; cov|=hit
            big.append((n,c,top,sorted(hit)))
    print(f"{label}\n   series: {ns}   kanji with reading predicted: {len(cov)}/{len(scope)} ({100*len(cov)//len(scope)}%)")
    return cov,sorted(big,reverse=True)

cA,bA=analyse(T2, "A) scope = N5-N2 (979)")
cB,bB=analyse(TALL,f"B) scope = N5-N1 ({len(TALL)})")
gain=len({k for k in cB if k in T2}) - len(cA)
print(f"\n   N5-N2 kanji whose reading becomes predictable only by also knowing N1 members: +{gain}")
print("\nLARGEST SERIES ACROSS FULL JLPT SET (top 18):")
for n,c,top,ks in bB[:18]:
    print(f"   {c} -> {top:<6} {n:>2} kanji: {' '.join(ks)}")
