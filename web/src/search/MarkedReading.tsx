/** A word's reading with one kanji's own kana marked, where the word knows them: じょう in じょうしょう, あ in あげる. */
export function MarkedReading({ reading, mark }: { reading: string; mark?: [number, number] | null }) {
  if (!mark) return <>{reading}</>
  const [from, to] = mark
  return (
    <>
      {reading.slice(0, from)}
      <span className="reading-here">{reading.slice(from, to)}</span>
      {reading.slice(to)}
    </>
  )
}
