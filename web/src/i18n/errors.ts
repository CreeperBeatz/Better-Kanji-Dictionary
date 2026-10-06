/**
 * What went wrong, in the interface language.
 *
 * The server says why it refused a request in English (`detail`) and names the
 * reason with a stable `code` (server/errors.py); this is where a code becomes
 * words. The English here repeats the server's, so an unknown or missing code
 * still shows the server's own text.
 */

import { ApiError } from '../api'
import type { Lang } from '.'

/** code -> [English, Bulgarian]; {name} placeholders come from the error's params. */
const ERRORS: Record<string, [string, string]> = {
  // signing in and the profile
  sign_in_required: ['sign in to save associations', 'влезте, за да запазвате асоциации'],
  admin_only: ["only the site's owner can do this", 'само собственикът на сайта може да прави това'],
  reviewers_only: ['only reviewers can do this', 'само рецензентите могат да правят това'],
  contribute_short: [
    'say a little about yourself and your Japanese',
    'кажете нещо за себе си и за японския си',
  ],
  contribute_already: ['you have already asked, or already review', 'вече сте поискали или вече рецензирате'],
  request_not_found: ['no open request with that id', 'няма отворена заявка с този номер'],
  reviewer_not_found: ['that account is not a reviewer', 'този профил не е рецензент'],
  bad_request: ['the request was not understood', 'заявката не беше разбрана'],
  semantic_off: ['semantic search is not set up on this server', 'семантичното търсене не е настроено на този сървър'],
  semantic_unavailable: ['semantic search is not available right now', 'семантичното търсене не е достъпно в момента'],
  kanjify_off: ['Kanjify is not set up on this server', 'Kanjify не е настроен на този сървър'],
  kanjify_unavailable: ['Kanjify could not do this one right now', 'Kanjify не успя с този текст в момента'],
  kanjify_too_long: ['Kanjify takes at most {max} characters', 'Kanjify приема най-много {max} знака'],
  gifs_off: ['GIF search is not set up on this server', 'търсенето на GIF не е настроено на този сървър'],
  gifs_unavailable: ['GIF search is not available right now', 'търсенето на GIF не е достъпно в момента'],
  gifs_busy: ['GIF search is busy; try again in a minute', 'търсенето на GIF е претоварено; опитайте след минута'],
  images_off: ['picture search is not set up on this server', 'търсенето на картини не е настроено на този сървър'],
  images_unavailable: ['picture search is not available right now', 'търсенето на картини не е достъпно в момента'],
  images_busy: ['picture search is busy; try again in a minute', 'търсенето на картини е претоварено; опитайте след минута'],
  picture_unfetched: ['that picture could not be fetched', 'картината не можа да бъде изтеглена'],
  book_entry_missing: ['that entry of the kanji book is not on this server', 'тази статия от канджи речника не е на този сървър'],
  book_page_missing: ['that page’s scan is not on this server', 'сканираната страница не е на този сървър'],
  bad_email: ['that does not look like an email address', 'това не прилича на имейл адрес'],
  too_soon: ['a link was just sent; give it a moment', 'току-що изпратихме връзка; изчакайте малко'],
  link_expired: ['this link has expired or was already used', 'връзката е изтекла или вече е използвана'],
  google_not_configured: ['Google sign-in is not set up on this server', 'Вход с Google не е настроен на този сървър'],
  google_rejected: ['Google did not vouch for that sign-in', 'Google не потвърди този вход'],
  google_unverified: [
    'that Google account has no verified email address',
    'този профил в Google няма потвърден имейл адрес',
  ],
  google_email_unusable: [
    "that Google account's address is not one we can use",
    'не можем да използваме адреса на този профил в Google',
  ],
  name_empty: ['a name cannot be empty', 'името не може да е празно'],
  username_invalid: [
    'a username is 3 to 24 of a-z, 0-9, _ and -',
    'потребителското име е от 3 до 24 знака: a-z, 0-9, _ и -',
  ],
  username_taken: ['that username is taken', 'това потребителско име е заето'],
  avatar_type: ['a profile picture must be PNG, JPEG or WebP', 'снимката на профила трябва да е PNG, JPEG или WebP'],
  avatar_too_big: ['profile picture larger than 1MB', 'снимката на профила е по-голяма от 1 MB'],
  avatar_mismatch: ['that file is not the image it says it is', 'файлът не е изображението, за което се представя'],
  avatar_failed: ['uploading the picture failed', 'качването на снимката не успя'],
  picture_not_found: ['no such picture', 'няма такава снимка'],
  // notes and their pictures
  note_too_long: ['a note is at most {max} characters', 'бележката е най-много {max} знака'],
  note_empty: ['a note needs some text or a picture', 'бележката трябва да има текст или картинка'],
  image_unknown: ['unknown image', 'непозната картинка'],
  assoc_not_found: ['no such association', 'няма такава асоциация'],
  assoc_not_yours: ['that association is not yours', 'тази асоциация не е ваша'],
  assoc_not_adoptable: [
    'no such association, or it is already yours',
    'няма такава асоциация или тя вече е ваша',
  ],
  image_type: ['unsupported image type {type}', 'неподдържан вид картинка {type}'],
  image_too_big: ['image larger than 8MB', 'картинката е по-голяма от 8 MB'],
  image_not_found: ['no such image', 'няма такава картинка'],
  upload_failed: ['upload failed', 'качването не успя'],
  drawing_too_big: ['drawing larger than 8MB', 'рисунката е по-голяма от 8 MB'],
  drawing_not_png: ['drawing is not a PNG', 'рисунката не е PNG'],
  drawing_failed: ['saving the drawing failed', 'запазването на рисунката не успя'],
  scene_too_big: ['scene larger than 32MB', 'сцената е по-голяма от 32 MB'],
  scene_invalid: ['scene is not valid JSON', 'сцената не е валиден JSON'],
  scene_not_excalidraw: ['scene is not an Excalidraw file', 'сцената не е файл на Excalidraw'],
  scene_not_found: ['no scene for that image', 'няма сцена за тази картинка'],
  bundle_invalid: ['not a valid bundle', 'това не е валиден пакет'],
  bundle_empty: ['bundle has no associations', 'пакетът няма асоциации'],
  // public notes and replies
  note_not_found: ['no such public note', 'няма такава публична бележка'],
  own_like: ['you cannot like your own note', 'не можете да харесате собствената си бележка'],
  reply_empty: ['a reply cannot be empty', 'отговорът не може да е празен'],
  reply_too_long: ['a reply is at most {max} characters', 'отговорът е най-много {max} знака'],
  reply_not_found: ['no such reply', 'няма такъв отговор'],
  reply_not_yours: ['that reply is not yours', 'този отговор не е ваш'],

  // the review queue (server/review.py)
  parts_invalid: ['parts must be single characters', 'частите трябва да са отделни знаци'],
  parts_self: ['a character cannot contain itself', 'знак не може да съдържа себе си'],
  parts_stroke: ['a bare stroke is not a part: {parts}', 'отделна черта не е част: {parts}'],
  parts_unknown: ['not in the graph: {parts}', 'няма ги в графа: {parts}'],
  parts_cycle: ['{parts} already contains this character', '{parts} вече съдържа този знак'],
  form_kind: ['pick a relation', 'изберете връзка'],
  form_evidence: ['say where this comes from: the old form, or a reference', 'кажете откъде идва: старата форма или справочник'],
  senses_count: ['a kanji has 1 to 6 meanings here, the catch-all aside', 'канджито има от 1 до 6 значения тук, без общата група'],
  senses_id: ['each meaning needs its own short id: a-z, 0-9 and -', 'всяко значение има нужда от свой кратък код: a-z, 0-9 и -'],
  senses_invalid: ['each meaning needs an id and an English label', 'всяко значение има нужда от код и английски етикет'],
  senses_label: ["a meaning's label is 1 to 4 words", 'етикетът на значението е от 1 до 4 думи'],
  senses_not_accepted: ["this kanji's meanings are not accepted yet", 'значенията на това канджи още не са приети'],
  sense_unknown: ["not one of this kanji's meanings", 'не е от значенията на това канджи'],
  word_not_with: ['that word is not written with this kanji', 'тази дума не се пише с това канджи'],
  words_invalid: ['the words could not be read', 'думите не можаха да бъдат прочетени'],
  needs_edit: ['this item has no proposal to accept; pick a value', 'няма предложение за приемане; изберете стойност'],
  needs_value: ['pick a value', 'изберете стойност'],
  item_not_found: ['no such item', 'няма такава задача'],
  item_closed: ['this item was already decided', 'по тази задача вече е решено'],
  decision_not_found: ['no such decision', 'няма такова решение'],
  not_revertible: ['that decision changed nothing, or was already reverted', 'това решение не е променило нищо или вече е върнато'],
  changed_since: ['this was changed again since; revert the later change first', 'оттогава е променяно пак; първо върнете по-късната промяна'],
  suggest_reason: ['say why, so a reviewer can check it', 'кажете защо, за да може рецензент да провери'],
  too_many_suggestions: ['you have {n} suggestions waiting already', 'вече имате {n} чакащи предложения'],
}

const FALLBACK: Record<Lang, string> = { en: 'something went wrong', bg: 'нещо се обърка' }

/** The words for an error from anywhere -- the API, the network, a bug -- in `lang`. */
export function errorText(e: unknown, lang: Lang): string {
  if (e instanceof ApiError) {
    const params = e.params ?? {}
    const fill = (text: string) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
    // Bulgarian gets its own text; English keeps the server's, which may say more.
    if (lang === 'bg' && e.code && ERRORS[e.code]) return fill(ERRORS[e.code][1])
    if (e.message) return fill(e.message)
  }
  if (e instanceof Error && e.message) return e.message
  return FALLBACK[lang]
}
