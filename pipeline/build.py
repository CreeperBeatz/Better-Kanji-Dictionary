# -*- coding: utf-8 -*-
import json, re, sys
from collections import defaultdict, Counter

# ---------- load decomposition ----------
LINE = re.compile(r'^(.+?):([a-z0-9/]+)\((.*)\)\s*$')
raw = {}
def load(path):
    for ln in open(path, encoding='utf-8'):
        ln = ln.rstrip('\n')
        if not ln or ln.startswith('#'): continue
        m = LINE.match(ln)
        if not m: continue
        ch, typ, args = m.group(1), m.group(2), m.group(3)
        parts = [p for p in args.split(',') if p]
        raw[ch] = (typ, parts)
load('cjk-decomp.txt')
load('cjk-override.txt')          # overrides win (loaded second)

ATOMIC_TYPES = {'fix','lock','ba','built'}

def is_stroke(c):
    return len(c)==1 and 0x31C0 <= ord(c) <= 0x31EF

def expand(node, depth=0, seen=None):
    """Resolve a component reference to a set of real character components."""
    if seen is None: seen = set()
    if node in seen or depth > 25: return set()
    seen = seen | {node}
    # numeric intermediate node -> must expand
    if node.isdigit():
        e = raw.get(node)
        if not e: return set()
        out = set()
        for p in e[1]: out |= expand(p, depth+1, seen)
        return out
    return {node}

def direct_components(ch):
    e = raw.get(ch)
    if not e: return set()
    typ, parts = e
    if typ in ATOMIC_TYPES: return set()
    out = set()
    for p in parts: out |= expand(p, 0, {ch})
    out.discard(ch)
    return {c for c in out if not is_stroke(c)}

# ---------- load kanji data ----------
K = json.load(open('kanji.json', encoding='utf-8'))
TARGET = {k for k,v in K.items() if v.get('jlpt_new') in (5,4,3,2)}
BYLEVEL = Counter(K[k]['jlpt_new'] for k in TARGET)

# ---------- build graph over closure ----------
comps = {}
def walk(ch, stack=()):
    if ch in comps: return
    if ch in stack: comps[ch]=set(); return
    d = direct_components(ch)
    comps[ch] = d
    for c in d: walk(c, stack+(ch,))
for k in TARGET: walk(k)

CLOSURE = set(comps)
EXTRA = CLOSURE - TARGET

def classify(c):
    v = K.get(c)
    if v is None: return 'not-a-kanji (bound component)'
    if v.get('jlpt_new') == 1: return 'N1 kanji'
    if v.get('grade') is not None: return 'joyo/jinmeiyo, no JLPT level'
    return 'other kanji in KANJIDIC, no JLPT/grade'

print("="*64)
print("TARGET SET: JLPT N5-N2 kanji")
for lv in (5,4,3,2): print(f"  N{lv}: {BYLEVEL[lv]:>4}")
print(f"  TOTAL TARGET: {len(TARGET)}")
print()
print(f"TRANSITIVE CLOSURE (target + all components): {len(CLOSURE)}")
print(f"  EXTRA items pulled in as prerequisites: {len(EXTRA)}")
for cat,n in Counter(classify(c) for c in EXTRA).most_common():
    print(f"    {cat:<40} {n:>4}")
print("="*64)
json.dump({'comps':{k:sorted(v) for k,v in comps.items()},
           'target':sorted(TARGET)}, open('graph.json','w',encoding='utf-8'), ensure_ascii=False)
