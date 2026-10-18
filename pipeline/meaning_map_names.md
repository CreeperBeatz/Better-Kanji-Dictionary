# Naming the meaning map's clusters and regions

Input: `pipeline/data/meaning-map/clusters-in.json`. Output: `pipeline/data/meaning-map/names.json`.

The map by meaning places each kanji by what it means. Kanji that mean related
things form **clusters** (about 140, shown when zoomed in) and the clusters form
**regions** (20, shown when zoomed out). Each needs a name in English and in
Bulgarian, printed on the map over the kanji, like a district or a country on a
street map.

Per cluster you get its most frequent kanji (up to 30) with the meaning groups
the site shows for each, its size, and `hint`: words picked by statistics,
often off. Judge by the kanji and their groups, not by the hint.

## Rules

- **Short.** 1–3 words, at most about 22 characters. A label, not a sentence.
- **Say what the kanji have in common**, as a learner would put it: "Sea and
  shore", "Birds", "Trees and wood", "Speaking", "Government". Name the bulk of
  the cluster; a few strays don't count.
- **Sentence case** in English ("Sea and shore"), the same in Bulgarian ("Море и бряг").
- **Plain words.** No jargon, no abbreviations, no "etc.", no slashes, no
  "Kanji for …".
- **Regions are broader** than their clusters: name what the clusters listed
  under the region share ("Nature", "People and family", "Thinking and
  feeling"). A region that is a grab-bag of abstract words still gets the best
  broad name you can find ("Actions and order").
- Two clusters may not share a name. If two clusters are close, name what
  tells them apart ("Trees" vs "Fruit trees").
- **Bulgarian:** natural Bulgarian a native speaker would write on a map, not a
  word-for-word copy of the English. Japanese kanji are "канджи" in Bulgarian,
  never "кандзи".

## Output

```json
{
  "clusters": [{"id": 0, "en": "Sea and shore", "bg": "Море и бряг"}, ...],
  "regions":  [{"id": 0, "en": "Nature", "bg": "Природа"}, ...]
}
```

Every cluster id and every region id from the input, in id order, exactly once.
