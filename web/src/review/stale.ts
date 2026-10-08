/**
 * A proposal is made against the value its subject had then. If someone changed
 * the subject after that, the server refuses a plain accept (changed_since_draft).
 * The reviewer is told, and the accept is sent again only if they say so.
 */
import { ApiError } from '../api'
import type { Lang } from '../i18n'
import { errorText } from '../i18n/errors'

export async function askIfStale<T>(send: (staleOk: boolean) => Promise<T>, lang: Lang): Promise<T> {
  try {
    return await send(false)
  } catch (e) {
    const again = lang === 'bg' ? 'Да се приеме ли предложението все пак?' : 'Accept the proposal anyway?'
    if (e instanceof ApiError && e.code === 'changed_since_draft' && window.confirm(`${errorText(e, lang)}.\n\n${again}`)) return send(true)
    throw e
  }
}
