import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { restoreSession } from './util/projectio'

void restoreSession()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// PWA: offline support + installability on iPad / Android / desktop
if ('serviceWorker' in navigator && !location.hostname.startsWith('localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is progressive enhancement */
    })
  })
}
