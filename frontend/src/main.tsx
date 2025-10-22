import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppWithRoutes from './AppWithRoutes.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import { initializeApiConfig } from './config/api.ts'

// 初始化 API 配置
initializeApiConfig();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AppWithRoutes />
    </AuthProvider>
  </StrictMode>,
)
