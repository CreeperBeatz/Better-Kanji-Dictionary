# The hero sentence of a kanji (instructions for one batch)

You write the first line a learner reads on a kanji's page in Better Kanji
Dictionary: the **hero sentence**. It gives the gist of the kanji, the idea
behind it, so that its meanings feel natural afterwards. Write it in
**English** and in **Bulgarian**. You do not need the web or any other file.

The page shows the kanji in large print right above your sentence, and its
meanings, readings and words below it. So the sentence does not introduce
the kanji and does not list its meanings: the meanings section does that.

## Each kanji in the input has

- `keywords`: KANJIDIC's English keywords.
- `tsalta`: the kanji's keyword in a Bulgarian kanji book, or null. A hint
  for the Bulgarian word for its main idea.
- `kokuji`: true when the kanji was made in Japan.
- `origin`: how the character was built, when the sources are sure of it;
  else null.
- `groups`: its meaning groups, in order of importance: `en` and `bg`
  labels, `about` (what the kanji does in those words), and a few words.
- `soundOnly`: words where the kanji only gives its sound.

## How to write

- **One sentence.** Two or three only when one would be cramped. At most
  about 220 characters in English.
- **The gist, not the list.** Find the one idea the main meanings grow
  from, or the picture that holds them, and say that well. Name at most
  two of the meanings, and only where they grow from the idea in a way
  worth seeing. Never a colon followed by a run of meanings ("a mountain:
  a hill, a mine, a temple, a heap"): the meanings section lists them.
- **Vary the shape.** Not every sentence is "picture: meanings". Some can
  open with the idea, some with the picture, some with what the kanji does.
- **Flow first, simple second.** It should read aloud well: one clear
  image or idea, carried through. Use everyday words and concrete things.
  No jargon (no "semantic", "phonetic", "radical", "component", "glyph").
- **Never write the kanji itself.** Do not write any Japanese at all:
  no kanji, no kana, no romaji. Describe the parts in words ("a person
  leaning on a tree"), and endings by what they do ("the ending that turns
  a noun into an adjective, like -ic in English").
- **Do not start with "This kanji", "The kanji" or "A kanji".** Go straight
  to the idea.
- **The origin, where it makes sense.** Use it when it is a picture that
  helps the meaning stick (a person leaning on a tree for "rest"). Leave
  it out when it is only about sound, when the picture has drifted far
  from today's meanings, or when it would need explaining. Never invent
  an origin, and use only the one given.
- **Nothing that is not in the input.** No history, no claims about how
  common or important the kanji is, no advice to the learner.
- `kokuji`: you may say it was made in Japan, if that helps.
- A kanji used mostly as a grammatical ending or helper: say what job it
  does in a sentence.
- Avoid filler: "at its heart", "essence", "embodies", "captures",
  "evokes", "the idea of", "the concept of", "represents", "symbolizes".

## The Bulgarian

- Write it as a Bulgarian writer would, not as a translation: the same
  idea and picture, in natural, flowing Bulgarian.
- **Japanese kanji are «канджи»** (канджито, канджитата), never «кандзи».
- Use the groups' Bulgarian labels and `tsalta` as hints for the words.
- The same rules: no Japanese, do not start with «Канджито».

## Examples (kanji not in your batch)

休, origin "a person 亻 resting against a tree 木":

- "A person leaning against a tree to catch their breath, putting the
  work down for a while."
- "Човек, облегнат на дърво, за да си поеме дъх и да остави работата за
  малко."

事, no origin:

- "Whatever is going on or waiting to be done, the plain stuff a day is
  made of."
- "Всичко, което се случва или чака да бъде свършено, обикновените неща,
  от които е направен денят."

## Output

Exactly this shape (UTF-8, no comments), with every kanji of the input
once:

```json
{
  "batch": "<the input's batch>",
  "kanji": {
    "休": {"hero": "...", "heroBg": "..."}
  }
}
```

Write the file with your file-writing tool, then reply with one line: how
many kanji you wrote, and anything you were unsure about.
