import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NovelUploadPage } from './pages/NovelUploadPage';
import { NovelDetailPage } from './pages/NovelDetailPage';
import { CharacterDetailPage } from './pages/CharacterDetailPage';
import { LoginPage } from './pages/LoginPage';
import { CallbackPage } from './pages/CallbackPage';
import { SwaggerDocs } from './SwaggerDocs';
import { ApiTest } from './ApiTest';
import { EdgeProbeDemo } from './EdgeProbeDemo';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import { DashboardLayout } from './layouts/DashboardLayout';
import { DashboardPage } from './pages/DashboardPage';
import { NovelsIndexPage } from './pages/NovelsIndexPage';
import { ExportsPage } from './pages/ExportsPage';
import './App.css';

/**
 * 带路由的主应用组件
 */
function AppWithRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/callback" element={<CallbackPage />} />

        {/* 主应用壳层 */}
        <Route element={<DashboardLayout />}>
          <Route
            path="/"
            element={
              isAuthenticated ? <DashboardPage /> : <Navigate to="/login" replace />
            }
          />

          <Route
            path="/upload"
            element={
              <ProtectedRoute>
                <NovelUploadPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/novels"
            element={
              <ProtectedRoute>
                <NovelsIndexPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/novels/:id"
            element={
              <ProtectedRoute>
                <NovelDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/characters/:charId"
            element={
              <ProtectedRoute>
                <CharacterDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/exports"
            element={
              <ProtectedRoute>
                <ExportsPage />
              </ProtectedRoute>
            }
          />

          {/* 开发工具保留路由（不在导航展示） */}
          <Route path="/api-docs" element={<SwaggerDocs />} />
          <Route
            path="/api-test"
            element={
              <ProtectedRoute>
                <ApiTest />
              </ProtectedRoute>
            }
          />
          <Route path="/edge-probe" element={<EdgeProbeDemo />} />
        </Route>

        {/* 兜底重定向 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default AppWithRoutes;
