import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import { App } from './App'
import { startOffline } from './local/local'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The app opens offline once installed (the service worker), and lookups run
// on the device once the dictionary is downloaded (the lookup worker). Neither
// is needed for the first paint.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
startOffline()
