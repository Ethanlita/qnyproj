import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppWithSwagger from './AppWithSwagger.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppWithSwagger />
  </StrictMode>,
)
