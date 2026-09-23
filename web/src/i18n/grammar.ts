/**
 * Grammar labels in the interface language: the deinflection reasons a search
 * attaches to a conjugated match ("polite past"), and JMdict's part-of-speech
 * and usage codes ("v5r", "uk").
 *
 * The reasons stay English inside the search engines -- server and device
 * must return identical answers -- and are only turned into words here.
 * English keeps showing the JMdict codes as it always has, with the full name
 * as a tooltip; Bulgarian shows Bulgarian abbreviations.
 */

import type { Lang } from '.'

const INFLECTIONS: Record<string, string> = {
  polite: 'учтива форма',
  'polite past': 'учтиво минало',
  'polite negative': 'учтиво отрицание',
  'polite negative past': 'учтиво минало отрицание',
  'polite -te': 'учтива -te форма',
  'polite volitional': 'учтива волева форма',
  'polite imperative': 'учтиво повелително',
  negative: 'отрицание',
  'negative past': 'минало отрицание',
  'archaic negative': 'остаряло отрицание',
  'negative -zu': 'отрицание с -zu',
  past: 'минало',
  '-te': '-te форма',
  desire: 'желание (-tai)',
  volitional: 'волева форма',
  imperative: 'повелително',
  conditional: 'условно',
  'conditional -tara': 'условно с -tara',
  'passive or potential': 'страдателно или възможност',
  passive: 'страдателно',
  'passive past': 'минало страдателно',
  potential: 'възможност',
  causative: 'каузатив',
  'causative passive': 'каузатив, страдателно',
  appearance: 'изглежда (-sō)',
  excess: 'прекалено (-sugiru)',
  stem: 'основа',
  representative: 'изброяване (-tari)',
  adverbial: 'наречна форма',
  nominalised: 'съществително (-sa)',
  progressive: 'продължително',
  'progressive polite': 'продължително, учтиво',
  'past progressive': 'минало продължително',
  completion: 'завършеност (-te shimau)',
  preparatory: 'предварително (-te oku)',
  resultant: 'резултат (-te aru)',
  going: 'отдалечаване (-te iku)',
  coming: 'приближаване (-te kuru)',
}

export function inflectionLabel(reason: string, lang: Lang): string {
  return lang === 'bg' ? (INFLECTIONS[reason] ?? reason) : reason
}

/** code -> [English name, Bulgarian abbreviation, Bulgarian name] */
const TAGS: Record<string, [string, string, string]> = {
  // parts of speech
  n: ['noun', 'същ.', 'съществително'],
  'n-adv': ['adverbial noun', 'същ., нареч.', 'наречно съществително'],
  'n-pr': ['proper noun', 'собств.', 'собствено име'],
  'n-pref': ['noun, used as a prefix', 'същ., предст.', 'съществително като представка'],
  'n-suf': ['noun, used as a suffix', 'същ., наст.', 'съществително като наставка'],
  'n-t': ['temporal noun', 'същ., врем.', 'съществително за време'],
  pn: ['pronoun', 'мест.', 'местоимение'],
  num: ['numeric', 'числ.', 'числително'],
  ctr: ['counter', 'брояч', 'брояч'],
  pref: ['prefix', 'предст.', 'представка'],
  suf: ['suffix', 'наст.', 'наставка'],
  prt: ['particle', 'част.', 'частица'],
  conj: ['conjunction', 'съюз', 'съюз'],
  int: ['interjection', 'межд.', 'междуметие'],
  exp: ['expression', 'израз', 'израз'],
  cop: ['copula', 'свърз.', 'свързващ глагол'],
  aux: ['auxiliary', 'спом.', 'спомагателна дума'],
  'aux-v': ['auxiliary verb', 'спом. гл.', 'спомагателен глагол'],
  'aux-adj': ['auxiliary adjective', 'спом. прил.', 'спомагателно прилагателно'],
  adv: ['adverb', 'нареч.', 'наречие'],
  'adv-to': ['adverb taking the particle to', 'нареч. с と', 'наречие с частицата と'],
  'adj-i': ['i-adjective', 'прил. -i', 'прилагателно на -い'],
  'adj-ix': ['i-adjective, yoi/ii class', 'прил. -i', 'прилагателно от типа よい/いい'],
  'adj-na': ['na-adjective', 'прил. -na', 'прилагателно с な'],
  'adj-no': ['noun that may take no', 'с の', 'съществително, което приема の'],
  'adj-pn': ['pre-noun adjectival', 'опр.', 'определение пред съществително (рентайши)'],
  'adj-t': ['taru adjective', 'прил. -taru', 'прилагателно с たる'],
  'adj-f': ['noun or verb acting prenominally', 'опр.', 'дума в ролята на определение'],
  'adj-nari': ['archaic nari adjective', 'прил. (остар.)', 'остаряло прилагателно с なり'],
  'adj-ku': ['archaic ku adjective', 'прил. (остар.)', 'остаряло прилагателно на -く'],
  'adj-shiku': ['archaic shiku adjective', 'прил. (остар.)', 'остаряло прилагателно на -しく'],
  'adj-kari': ['archaic kari adjective', 'прил. (остар.)', 'остаряло прилагателно на -かり'],
  v1: ['ichidan verb', 'гл. ичидан', 'глагол от групата ичидан'],
  'v1-s': ['ichidan verb, kureru class', 'гл. ичидан', 'глагол ичидан от типа くれる'],
  vk: ['kuru verb', 'гл. くる', 'глаголът くる'],
  vs: ['takes suru', '+する', 'съществително, което става глагол със する'],
  'vs-i': ['suru verb', 'гл. する', 'глагол със する'],
  'vs-s': ['suru verb, special class', 'гл. する', 'глагол със する, особен клас'],
  'vs-c': ['su verb, precursor of suru', 'гл. す', 'глагол на す, предшественик на する'],
  vz: ['zuru verb', 'гл. ずる', 'глагол на ずる'],
  vi: ['intransitive', 'непрех.', 'непреходен глагол'],
  vt: ['transitive', 'прех.', 'преходен глагол'],
  vn: ['irregular nu verb', 'гл. ぬ', 'неправилен глагол на ぬ'],
  vr: ['irregular ru verb', 'гл. る', 'неправилен глагол на る'],
  'v-unspec': ['verb, type unspecified', 'гл.', 'глагол с неуточнен тип'],
  unc: ['unclassified', 'некл.', 'некласифицирано'],
  // usage notes
  uk: ['usually written in kana', 'кана', 'обикновено се пише с кана'],
  abbr: ['abbreviation', 'съкр.', 'съкращение'],
  arch: ['archaic', 'остар.', 'архаично'],
  dated: ['dated', 'остарял.', 'остаряващо'],
  obs: ['obsolete', 'излязло от употреба', 'излязло от употреба'],
  rare: ['rare', 'рядко', 'рядко'],
  col: ['colloquial', 'разг.', 'разговорно'],
  fam: ['familiar', 'фам.', 'фамилиарно'],
  sl: ['slang', 'жарг.', 'жаргон'],
  'm-sl': ['manga slang', 'манга жарг.', 'жаргон от мангата'],
  'net-sl': ['internet slang', 'интернет жарг.', 'интернет жаргон'],
  vulg: ['vulgar', 'вулг.', 'вулгарно'],
  derog: ['derogatory', 'пренебр.', 'пренебрежително'],
  sens: ['sensitive', 'деликатно', 'деликатна тема'],
  hon: ['honorific', 'почт.', 'почтителна реч (сонкейго)'],
  hum: ['humble', 'скромна', 'скромна реч (кенджього)'],
  pol: ['polite', 'учт.', 'учтива реч (тейнейго)'],
  form: ['formal', 'офиц.', 'официално'],
  poet: ['poetical', 'поет.', 'поетично'],
  lit: ['literary', 'книжн.', 'книжовно'],
  joc: ['jocular', 'шег.', 'шеговито'],
  euph: ['euphemistic', 'евфем.', 'евфемизъм'],
  fem: ['female term', 'жен.', 'употребява се от жени'],
  male: ['male term', 'мъж.', 'употребява се от мъже'],
  chn: ["children's language", 'детско', 'детска реч'],
  id: ['idiomatic', 'идиом', 'идиоматичен израз'],
  proverb: ['proverb', 'послов.', 'поговорка'],
  yoji: ['four-character idiom', 'йоджи', 'идиом от четири йероглифа'],
  'on-mim': ['onomatopoeia or mimetic', 'ономат.', 'звукоподражание или мимезис'],
  quote: ['quotation', 'цитат', 'цитат'],
  hist: ['historical term', 'истор.', 'исторически термин'],
  myth: ['mythology', 'митол.', 'митология'],
  relig: ['religion', 'рел.', 'религия'],
  obj: ['onomatopoeia for an object', 'предмет', 'дума за предмет'],
  char: ['character', 'герой', 'персонаж'],
  creat: ['creature', 'същество', 'същество'],
  dei: ['deity', 'божество', 'божество'],
  ev: ['event', 'събитие', 'събитие'],
  fict: ['fiction', 'художествено', 'художествена литература'],
  given: ['given name', 'име', 'лично име'],
  surname: ['surname', 'фамилия', 'фамилно име'],
  person: ['full name of a person', 'лице', 'име на човек'],
  place: ['place name', 'място', 'име на място'],
  station: ['railway station', 'гара', 'железопътна гара'],
  company: ['company name', 'фирма', 'име на фирма'],
  organization: ['organization name', 'организация', 'име на организация'],
  product: ['product name', 'продукт', 'име на продукт'],
  work: ['work of art, literature, music', 'произведение', 'художествено произведение'],
  group: ['group', 'група', 'група'],
  ship: ['ship name', 'кораб', 'име на кораб'],
  serv: ['service', 'услуга', 'услуга'],
  doc: ['document', 'документ', 'документ'],
  leg: ['legend', 'легенда', 'легенда'],
  oth: ['other', 'друго', 'друго'],
}

// Godan verbs share one label, whatever row they conjugate on (v5r, v5k-s, ...).
const GODAN: [string, string, string] = ['godan verb', 'гл. годан', 'глагол от групата годан']
const ARCHAIC_VERB: [string, string, string] = ['archaic verb', 'гл. (остар.)', 'остарял глагол']

function entry(code: string): [string, string, string] | undefined {
  if (TAGS[code]) return TAGS[code]
  if (code.startsWith('v5')) return [`${GODAN[0]} (${code})`, GODAN[1], GODAN[2]]
  if (/^v[24]/.test(code)) return [`${ARCHAIC_VERB[0]} (${code})`, ARCHAIC_VERB[1], ARCHAIC_VERB[2]]
  return undefined
}

/** A JMdict code as shown (`short`) and explained on hover (`full`). */
export function tagLabel(code: string, lang: Lang): { short: string; full: string } {
  const e = entry(code)
  if (!e) return { short: code, full: code }
  return lang === 'bg' ? { short: e[1], full: e[2] } : { short: code, full: e[0] }
}
