# -*- coding: utf-8 -*-
import json, heapq
from collections import defaultdict, Counter
G=json.load(open('graph.json',encoding='utf-8')); K=json.load(open('kanji.json',encoding='utf-8'))
fan=json.load(open('fanout.json',encoding='utf-8'))
comps={k:set(v) for k,v in G['comps'].items()}; TARGET=set(G['target'])

# ---- PRUNE: inline non-target components that appear in only 1 target kanji ----
def prune(comps, keep):
    comps={k:set(v) for k,v in comps.items()}
    drop={c for c in comps if c not in keep}
    changed=True
    while changed:
        changed=False
        for parent in list(comps):
            new=set()
            for c in comps[parent]:
                if c in drop:
                    new |= comps.get(c,set()); changed=True
                else: new.add(c)
            new.discard(parent)
            if new!=comps[parent]: comps[parent]=new
        for d in drop: comps.pop(d,None)
    return comps

KEEP = TARGET | {c for c in fan if fan[c]>=2}
P = prune(comps, KEEP)
NODES=set(P)
print(f"Study items after inlining fan-out-1 components: {len(NODES)}  "
      f"(target {len(TARGET)} + {len(NODES)-len(TARGET)} components)")

def freq(c): return K.get(c,{}).get('freq') or 9999
def lvl(c):  return K.get(c,{}).get('jlpt_new') or 0

def topo(key):
    indeg={n:len(P[n]) for n in NODES}
    parents=defaultdict(set)
    for n in NODES:
        for c in P[n]: parents[c].add(n)
    h=[(key(n),n) for n in NODES if indeg[n]==0]; heapq.heapify(h)
    out=[]
    while h:
        _,n=heapq.heappop(h); out.append(n)
        for p in parents[n]:
            indeg[p]-=1
            if indeg[p]==0: heapq.heappush(h,(key(p),p))
    return out

def cheapest_first():
    """Greedy: repeatedly emit the target kanji whose remaining prereq closure is smallest."""
    known=set(); out=[]
    def closure(t):
        s=set(); st=[t]
        while st:
            x=st.pop()
            if x in known or x in s: continue
            s.add(x); st.extend(P.get(x,()))
        return s
    remaining=set(TARGET)
    while remaining:
        best=min(remaining, key=lambda t:(len(closure(t)), freq(t)))
        cl=closure(best)
        # emit that closure in dependency order
        sub=[n for n in topo(lambda c:(freq(c),c)) if n in cl]
        out.extend(sub); known|=cl; remaining-=cl
    return out

def curve(order,label):
    seen=0; marks={}
    for i,n in enumerate(order,1):
        if n in TARGET:
            seen+=1
            for pct in (25,50,75,90,100):
                if pct not in marks and seen>=len(TARGET)*pct/100: marks[pct]=i
    print(f"  {label:<34} " + "  ".join(f"{p}%:{marks.get(p,'-'):>5}" for p in (25,50,75,90,100)))

print()
print("STUDY ITEMS needed to reach X% of the 979 N5-N2 kanji:")
o_freq = topo(lambda c:(freq(c),c));  curve(o_freq,"frequency tiebreak (topokanji)")
o_jlpt = topo(lambda c:(-lvl(c),freq(c),c)); curve(o_jlpt,"JLPT-level tiebreak")
o_cheap = cheapest_first(); curve(o_cheap,"cheapest-target-first (greedy)")
print(f"  {'(theoretical floor = target only)':<34} " +
      "  ".join(f"{p}%:{int(len(TARGET)*p/100):>5}" for p in (25,50,75,90,100)))
json.dump({'freq':o_freq,'cheap':o_cheap}, open('orders.json','w',encoding='utf-8'), ensure_ascii=False)
print()
print("FIRST 60 ITEMS, frequency-tiebreak order  (* = an N5-N2 target kanji):")
line=[]
for n in o_freq[:60]:
    line.append(n + ("*" if n in TARGET else " "))
print("  " + "  ".join(line))
