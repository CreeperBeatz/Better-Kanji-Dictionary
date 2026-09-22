# BetterRTK — findings

Measured 2026-09-22. Everything below is reproducible via `pipeline/` (see its README).

## Goal

A kanji study order for JLPT **N5–N2 (979 kanji)** — N1 optional — under three rules:

1. **Containment is a hard constraint.** No kanji is ever introduced before a kanji or
   component it visually contains. Not "simpler in meaning" — *contained within*.
2. **Components are grounded.** Real radicals and functional components with their actual
   role, not invented RTK-style primitives chosen to make a story work.
3. **Meaning, not one keyword.** A few words covering the kanji's meaning range, because
   the one-keyword rule collapses at N3+ where the whole point is nuance English lacks.

JLPT is used **only to define the target set**, not to order it. See "Why JLPT ordering was
dropped" below.

## Curriculum size

| | count |
|---|---|
| Target kanji (N5 79 · N4 166 · N3 367 · N2 367) | 979 |
| Full containment closure | 1,370 |
| — non-target prerequisites pulled in | 391 (40% overhead) |
| **After inlining fan-out-1 components** | **1,191 (979 kanji + 212 components)** |

Component fan-out — how many target kanji each non-target component appears inside:

| fan-out | components | |
|---|---|---|
| 1 | **179** | pure tax — inline into the single parent's entry, don't make a card |
| 2 | 70 | |
| 3–5 | 62 | |
| 6–10 | 26 | |
| 11+ | **54** | highest value |

The 212 survivors are the genuine bound radical forms: 亠 (77 kanji), 又 (68), 儿 (38),
宀 (35), 厶 (32), 厂 (31), 勹 (30), 辶 (29), 扌 (28), 糹 (22) …

## Ordering policy barely matters

Study items needed to reach X% of the 979 target kanji:

| policy | 25% | 50% | 75% | 90% | 100% |
|---|---|---|---|---|---|
| frequency tiebreak (topokanji-style) | 288 | 594 | 892 | 1065 | 1191 |
| JLPT-level tiebreak | 291 | 597 | 892 | 1065 | 1191 |
| **cheapest-target-first (greedy)** | **260** | **551** | **850** | **1044** | 1191 |
| *floor: target kanji only, no components* | *244* | *489* | *734* | *881* | *979* |

Frequency and JLPT tiebreaks differ by **three items** at the 25% mark. Once containment is
a hard constraint, the DAG shape dominates and the tiebreak is close to irrelevant. Greedy
cheapest-first wins but only by ~10%. **Do not spend effort tuning the sort.**

Cheapest-first also self-organizes into component clusters with no instruction to do so:

    … ⺊ 上 占 | ⺹ 者 | 龸 党 賞 堂 | 也 地 | 亼 合 | ⺆ 内 |
      田 用 思 男 | 両 果 央 映 | 肉 胃 | 𠮛 同 銅 | 亠 方 京 言 調 …

    … 爪 ⺤ 受 愛 | 采 採 菜 | 孚 浮 乳 | 罙 深 探 | 至 室 屋 到 倒 |
      巴 色 絶 | 凡 巩 築 恐 | 屯 純 鈍 | 句 苟 敬 警 | 禸 禺 隅 偶

Component first, then everything it unlocks, immediately — the desired pedagogy for free.

## Why JLPT ordering was dropped

"Loosely JLPT" and strict containment conflict hard at the bottom of the list, because N5 is
full of kanji whose parts are higher-level or not jōyō at all:

    何 (N5) ⊃ 可 (N3)     時 (N5) ⊃ 寺 (N3)     校 (N5) ⊃ 交 (N3)
    話 (N5) ⊃ 舌 (N2)     読 (N5) ⊃ 売 (N4)     駅 (N5) ⊃ 馬 (N4), 尺 (N1)
    語 (N5) ⊃ 吾 (not jōyō)             曜 (N5) ⊃ 隹 (not a standalone kanji)

Forcing JLPT order puts a wall of N1/non-jōyō characters before the first N5 kanji. Dropping
it removes the problem entirely — the first 40 items are now all common target kanji:

    一 人 大 十 二 中 三 月 民 今 回 金 九 入 力 五 子 目 自 八
    小 七 協 山 出 県 記 女 心 先 交 川 向 告 千 別 水 示 直 必

Also: **the JLPT has published no official kanji lists since the 2010 revision.** Every N1–N5
list is a community reconstruction and they disagree. Level is a soft signal at the source.

## Phonetic components are weaker than expected

Testing every component against its dependents' on'yomi, **excluding semantic radicals**
(which generate false positives — 亻→か and 氵→こう are coincidence, not phonetics):

> **87 genuine phonetic series, covering 192/979 = 20% of the target set.**

Series that do hold are worth teaching explicitly:

    青 → せい   情 清 精 静 晴        反 → はん   販 版 坂 板 飯
    主 → ちゅう  住 注 駐 柱          交 → こう   校 効 郊
    复 → ふく   復 複 腹             工 → こう   功 巧 攻 江 紅 虹 貢 項
    令 → れい   冷 齢 零             畐 → ふく   副 福 幅

But Japanese on'yomi split across Go-on/Kan-on borrowing layers, so series that are tight in
Chinese fray here. **寺 is not a clean series**: 時ジ 持ジ 詩シ but 待タイ 特トク.

Scope truncates series too: **90 N5–N2 kanji become reading-predictable only once their N1
series-mates are known** — a concrete cost of treating N1 as optional.

**Design conclusion:** teach phonetics where they hold (it is the cheapest 20% available),
but do not build the system around them. The multi-word core-meaning approach carries the
other 80%, which was the plan anyway.

## Output

`order-n2.tsv` — 1,191 rows: `idx, char, level (N5–N2 / N1 / COMP), meanings, on_yomi, fanout`.

## Known gaps

- **Meanings need replacing.** Raw KANJIDIC glosses leak junk senses — 合 comes through as
  "Fit; Suit; Join; 0.1". Halpern-style core meaning + meaning range is the intended fix.
- **Decomposition needs hand-review.** The mechanical split is pedagogically useless in a
  few hundred cases; topokanji and KLC both needed manual overrides. This is where the real
  effort lives.
- **Component roles are not yet labelled** (semantic / phonetic / form). Constraint 2 is only
  half-satisfied until they are.
