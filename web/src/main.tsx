import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import { App } from './App'
import { startOffline } from './local/local'

// The dictionary tab (review/BookViewer.tsx), reviewers' second screen: a page of its own, not the app.
const DictionaryTab = lazy(() => import('./review/BookViewer'))
const dictionaryTab = window.location.pathname === '/review/dictionary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {dictionaryTab ? (
      <Suspense fallback={null}>
        <DictionaryTab />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)

// The app opens offline once installed (the service worker), and lookups run
// on the device once the dictionary is downloaded (the lookup worker). Neither
// is needed for the first paint, nor at all in the dictionary tab.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !dictionaryTab) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
// After the first frame is on the screen: the worker's start and its first
// messages would otherwise share the task that draws the page.
if (!dictionaryTab) requestAnimationFrame(() => setTimeout(startOffline, 0))
