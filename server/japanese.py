"""Japanese text handling: script detection, romaji, and deinflection.

The deinflector turns a conjugated surface form back into the dictionary form
JMdict actually stores, so 食べたくなかった finds 食べる. Rules carry a type
constraint (ichidan / godan / suru / kuru / i-adjective) that the caller checks
against the candidate's part of speech, which is what stops 着ます deinflecting
as though it were godan.

Godan rules are generated from the row tables rather than hand-listed -- there
are nine rows times a dozen endings, and enumerating them by hand is how these
tables usually end up with holes.
"""

from __future__ import annotations

from dataclasses import dataclass

# ---------------------------------------------------------------- script

HIRAGANA = (0x3041, 0x309F)
KATAKANA = (0x30A0, 0x30FF)
KANJI = (0x4E00, 0x9FFF)


def is_kana(s: str) -> bool:
    return bool(s) and all(
        HIRAGANA[0] <= ord(c) <= HIRAGANA[1] or KATAKANA[0] <= ord(c) <= KATAKANA[1] or c == "ー"
        for c in s
    )


def has_japanese(s: str) -> bool:
    return any(
        HIRAGANA[0] <= ord(c) <= KATAKANA[1] or KANJI[0] <= ord(c) <= KANJI[1] for c in s
    )


def katakana_to_hiragana(s: str) -> str:
    return "".join(
        chr(ord(c) - 0x60) if KATAKANA[0] + 1 <= ord(c) <= 0x30F6 else c for c in s
    )


# ---------------------------------------------------------------- romaji

_ROMAJI = {
    "a": "あ", "i": "い", "u": "う", "e": "え", "o": "お",
    "ka": "か", "ki": "き", "ku": "く", "ke": "け", "ko": "こ",
    "ga": "が", "gi": "ぎ", "gu": "ぐ", "ge": "げ", "go": "ご",
    "sa": "さ", "shi": "し", "si": "し", "su": "す", "se": "せ", "so": "そ",
    "za": "ざ", "ji": "じ", "zi": "じ", "zu": "ず", "ze": "ぜ", "zo": "ぞ",
    "ta": "た", "chi": "ち", "ti": "ち", "tsu": "つ", "tu": "つ", "te": "て", "to": "と",
    "da": "だ", "di": "ぢ", "du": "づ", "de": "で", "do": "ど",
    "na": "な", "ni": "に", "nu": "ぬ", "ne": "ね", "no": "の",
    "ha": "は", "hi": "ひ", "fu": "ふ", "hu": "ふ", "he": "へ", "ho": "ほ",
    "ba": "ば", "bi": "び", "bu": "ぶ", "be": "べ", "bo": "ぼ",
    "pa": "ぱ", "pi": "ぴ", "pu": "ぷ", "pe": "ぺ", "po": "ぽ",
    "ma": "ま", "mi": "み", "mu": "む", "me": "め", "mo": "も",
    "ya": "や", "yu": "ゆ", "yo": "よ",
    "ra": "ら", "ri": "り", "ru": "る", "re": "れ", "ro": "ろ",
    "wa": "わ", "wo": "を", "n": "ん", "nn": "ん",
    "kya": "きゃ", "kyu": "きゅ", "kyo": "きょ",
    "gya": "ぎゃ", "gyu": "ぎゅ", "gyo": "ぎょ",
    "sha": "しゃ", "shu": "しゅ", "sho": "しょ",
    "ja": "じゃ", "ju": "じゅ", "jo": "じょ",
    "cha": "ちゃ", "chu": "ちゅ", "cho": "ちょ",
    "nya": "にゃ", "nyu": "にゅ", "nyo": "にょ",
    "hya": "ひゃ", "hyu": "ひゅ", "hyo": "ひょ",
    "bya": "びゃ", "byu": "びゅ", "byo": "びょ",
    "pya": "ぴゃ", "pyu": "ぴゅ", "pyo": "ぴょ",
    "mya": "みゃ", "myu": "みゅ", "myo": "みょ",
    "rya": "りゃ", "ryu": "りゅ", "ryo": "りょ",
}


def romaji_to_kana(s: str) -> str:
    """Best-effort romaji to hiragana. Returns '' if nothing converted cleanly."""
    s = s.lower().strip()
    if not s or not s.isascii():
        return ""
    out: list[str] = []
    i = 0
    while i < len(s):
        # Doubled consonant -> small tsu, e.g. "kitte" -> きって
        if (
            i + 1 < len(s)
            and s[i] == s[i + 1]
            and s[i] not in "aeioun"
        ):
            out.append("っ")
            i += 1
            continue
        for size in (3, 2, 1):
            chunk = s[i : i + size]
            if chunk in _ROMAJI:
                out.append(_ROMAJI[chunk])
                i += size
                break
        else:
            return ""  # unconvertible -- treat the whole input as English
    return "".join(out)


# ---------------------------------------------------------------- deinflection

# Part-of-speech families the rules constrain against.
V1 = "v1"        # ichidan
V5 = "v5"        # godan
VS = "vs"        # suru
VK = "vk"        # kuru
ADJ = "adj-i"
ANY_V = frozenset({V1, V5, VS, VK})


@dataclass(frozen=True)
class Rule:
    suffix: str          # what the inflected form ends with
    replace: str         # what to put back to reach the base
    needs: frozenset     # types the *result* must be
    gives: frozenset     # types the inflected form behaves as, for stacking
    label: str


# Godan rows: dictionary ending -> (a-stem, i-stem, e-stem, o-stem, te, ta)
GODAN = {
    "う": ("わ", "い", "え", "お", "って", "った"),
    "く": ("か", "き", "け", "こ", "いて", "いた"),
    "ぐ": ("が", "ぎ", "げ", "ご", "いで", "いだ"),
    "す": ("さ", "し", "せ", "そ", "して", "した"),
    "つ": ("た", "ち", "て", "と", "って", "った"),
    "ぬ": ("な", "に", "ね", "の", "んで", "んだ"),
    "ぶ": ("ば", "び", "べ", "ぼ", "んで", "んだ"),
    "む": ("ま", "み", "め", "も", "んで", "んだ"),
    "る": ("ら", "り", "れ", "ろ", "って", "った"),
}

_V1 = frozenset({V1})
_V5 = frozenset({V5})
_VS = frozenset({VS})
_VK = frozenset({VK})
_ADJ = frozenset({ADJ})


def _build_rules() -> dict[str, list[Rule]]:
    rules: list[Rule] = []

    def add(suffix: str, replace: str, needs, gives, label: str) -> None:
        rules.append(Rule(suffix, replace, frozenset(needs), frozenset(gives), label))

    # --- ichidan: strip る, attach directly to the stem
    for suffix, label, gives in (
        ("ます", "polite", _V1),
        ("ました", "polite past", _V1),
        ("ません", "polite negative", _V1),
        ("ませんでした", "polite negative past", _V1),
        ("まして", "polite -te", _V1),
        ("ましょう", "polite volitional", _V1),
        ("ない", "negative", _ADJ),
        ("なかった", "negative past", _ADJ),
        ("ぬ", "archaic negative", _V1),
        ("ず", "negative -zu", _V1),
        ("た", "past", _V1),
        ("て", "-te", _V1),
        ("たい", "desire", _ADJ),
        ("よう", "volitional", _V1),
        ("ろ", "imperative", _V1),
        ("よ", "imperative", _V1),
        ("れば", "conditional", _V1),
        ("たら", "conditional -tara", _V1),
        ("られる", "passive or potential", _V1),
        ("させる", "causative", _V1),
        ("させられる", "causative passive", _V1),
        ("られた", "passive past", _V1),
        ("そう", "appearance", _V1),
        ("すぎる", "excess", _V1),
        ("なさい", "polite imperative", _V1),
    ):
        add(suffix, "る", _V1, gives, label)

    # --- godan, generated per row so no ending is missed
    for ending, (a, i, e, o, te, ta) in GODAN.items():
        for stem, suffix, label, gives in (
            (i, "ます", "polite", _V1),
            (i, "ました", "polite past", _V1),
            (i, "ません", "polite negative", _V1),
            (i, "ませんでした", "polite negative past", _V1),
            (i, "まして", "polite -te", _V1),
            (i, "ましょう", "polite volitional", _V1),
            (i, "たい", "desire", _ADJ),
            (i, "そう", "appearance", _V1),
            (i, "すぎる", "excess", _V1),
            (i, "なさい", "polite imperative", _V1),
            (i, "", "stem", _V1),
            (a, "ない", "negative", _ADJ),
            (a, "なかった", "negative past", _ADJ),
            (a, "ず", "negative -zu", _V1),
            (a, "ぬ", "archaic negative", _V1),
            (a, "れる", "passive", _V1),
            (a, "せる", "causative", _V1),
            (a, "される", "causative passive", _V1),
            (a, "せられる", "causative passive", _V1),
            (e, "る", "potential", _V1),
            (e, "ば", "conditional", _V1),
            (e, "", "imperative", _V1),
            (o, "う", "volitional", _V5),
        ):
            add(stem + suffix, ending, _V5, gives, label)
        add(te, ending, _V5, _V1, "-te")
        add(ta, ending, _V5, _V1, "past")
        add(ta + "ら", ending, _V5, _V1, "conditional -tara")
        add(ta + "り", ending, _V5, _V1, "representative")

    # --- i-adjectives
    for suffix, replace, label, gives in (
        ("くない", "い", "negative", _ADJ),
        ("くなかった", "い", "negative past", _ADJ),
        ("かった", "い", "past", _V1),
        ("くて", "い", "-te", _V1),
        ("く", "い", "adverbial", _V1),
        ("ければ", "い", "conditional", _V1),
        ("さ", "い", "nominalised", _V1),
        ("そう", "い", "appearance", _V1),
        ("すぎる", "い", "excess", _V1),
    ):
        add(suffix, replace, _ADJ, gives, label)

    # --- suru and kuru, which follow no row
    for suffix, label, gives in (
        ("します", "polite", _V1), ("しました", "polite past", _V1),
        ("しません", "polite negative", _V1), ("しない", "negative", _ADJ),
        ("しなかった", "negative past", _ADJ), ("した", "past", _V1),
        ("して", "-te", _V1), ("される", "passive", _V1),
        ("させる", "causative", _V1), ("しよう", "volitional", _V1),
        ("できる", "potential", _V1), ("すれば", "conditional", _V1),
        ("したら", "conditional -tara", _V1), ("したい", "desire", _ADJ),
    ):
        add(suffix, "する", _VS, gives, label)

    for suffix, label, gives in (
        ("きます", "polite", _V1), ("きました", "polite past", _V1),
        ("きません", "polite negative", _V1), ("こない", "negative", _ADJ),
        ("こなかった", "negative past", _ADJ), ("きた", "past", _V1),
        ("きて", "-te", _V1), ("こられる", "passive or potential", _V1),
        ("こさせる", "causative", _V1), ("こよう", "volitional", _V1),
    ):
        add(suffix, "くる", _VK, gives, label)

    # --- auxiliaries that chain off the -te form
    for suffix, replace, label in (
        ("ている", "て", "progressive"),
        ("てる", "て", "progressive"),
        ("ています", "て", "progressive polite"),
        ("ていた", "て", "past progressive"),
        ("てた", "て", "past progressive"),
        ("てしまう", "て", "completion"),
        ("ちゃう", "て", "completion"),
        ("ておく", "て", "preparatory"),
        ("とく", "て", "preparatory"),
        ("てある", "て", "resultant"),
        ("ていく", "て", "going"),
        ("てくる", "て", "coming"),
        ("でいる", "で", "progressive"),
        ("でる", "で", "progressive"),
        ("でいた", "で", "past progressive"),
    ):
        add(suffix, replace, _V1, _V1, label)

    table: dict[str, list[Rule]] = {}
    for r in rules:
        table.setdefault(r.suffix, []).append(r)
    return table


RULES = _build_rules()
MAX_SUFFIX = max(len(s) for s in RULES)


@dataclass(frozen=True)
class Candidate:
    text: str
    reasons: tuple[str, ...]
    types: frozenset


def deinflect(word: str, max_depth: int = 10) -> list[Candidate]:
    """Every plausible dictionary form of `word`, shallowest first.

    The word itself always comes back first, since most lookups are already in
    dictionary form and should not pay for the search.
    """
    word = katakana_to_hiragana(word) if is_kana(word) else word
    seen: set[tuple[str, frozenset]] = {(word, frozenset())}
    out = [Candidate(word, (), frozenset())]
    queue = [out[0]]

    while queue:
        cur = queue.pop(0)
        if len(cur.reasons) >= max_depth:
            continue
        for size in range(1, min(MAX_SUFFIX, len(cur.text)) + 1):
            suffix = cur.text[-size:]
            for rule in RULES.get(suffix, ()):
                # The form we are peeling must be able to act as what the
                # previous step expected, or the chain is not grammatical.
                if cur.types and not (cur.types & rule.gives):
                    continue
                base = cur.text[: len(cur.text) - size] + rule.replace
                if len(base) < 1:
                    continue
                key = (base, rule.needs)
                if key in seen:
                    continue
                seen.add(key)
                nxt = Candidate(base, cur.reasons + (rule.label,), rule.needs)
                out.append(nxt)
                queue.append(nxt)
    return out


def pos_matches(pos: str | None, types: frozenset) -> bool:
    """Does a JMdict pos string satisfy a rule's type constraint?"""
    if not types:
        return True
    if not pos:
        return False
    tags = pos.split(",")
    for t in types:
        if t == V1 and any(x.startswith("v1") for x in tags):
            return True
        if t == V5 and any(x.startswith("v5") for x in tags):
            return True
        if t == VS and any(x in ("vs", "vs-i", "vs-s", "vs-c") or x.startswith("vs") for x in tags):
            return True
        if t == VK and "vk" in tags:
            return True
        if t == ADJ and "adj-i" in tags:
            return True
    return False
