import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { NovelUploadPage } from './pages/NovelUploadPage';
import { NovelDetailPage } from './pages/NovelDetailPage';
import { CharacterDetailPage } from './pages/CharacterDetailPage';
import { LoginPage } from './pages/LoginPage';
import { CallbackPage } from './pages/CallbackPage';
import { SwaggerDocs } from './SwaggerDocs';
import { ApiTest } from './ApiTest';
import { EdgeProbeDemo } from './EdgeProbeDemo';
import { UserInfo } from './components/UserInfo';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import './App.css';

/**
 * 带路由的主应用组件
 */
function AppWithRoutes() {
  const { isAuthenticated, login } = useAuth();

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa' }}>
        {/* 导航栏 */}
        <nav style={{
          padding: '16px 24px',
          backgroundColor: 'white',
          borderBottom: '1px solid #ddd',
          marginBottom: '0'
        }}>
          <div style={{
            maxWidth: '1200px',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: '24px'
          }}>
            <Link to="/" style={{
              fontSize: '20px',
              fontWeight: 'bold',
              textDecoration: 'none',
              color: '#333'
            }}>
              📚 Novel-to-Comics
            </Link>
            
            <div style={{ flex: 1, display: 'flex', gap: '16px' }}>
              {isAuthenticated && (
                <Link to="/" style={navLinkStyle}>
                  🏠 我的作品
                </Link>
              )}
            </div>

            {/* 用户信息/登录按钮 */}
            <div>
              {isAuthenticated ? (
                <UserInfo />
              ) : (
                <button
                  onClick={() => login()}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#5568d3';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = '#667eea';
                  }}
                >
                  🔐 登录
                </button>
              )}
            </div>
          </div>
        </nav>

        {/* 路由内容 */}
        <Routes>
          {/* 公开路由 */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/callback" element={<CallbackPage />} />
          
          {/* 开发者工具 - 不显示在导航栏，通过直接访问 URL 使用 */}
          <Route path="/api-docs" element={<SwaggerDocs />} />
          <Route path="/api-test" element={
            <ProtectedRoute>
              <ApiTest />
            </ProtectedRoute>
          } />
          <Route path="/edge-probe" element={<EdgeProbeDemo />} />
          
          {/* 受保护的路由 - 需要登录 */}
          <Route path="/" element={
            isAuthenticated ? (
              <ProtectedRoute>
                <NovelUploadPage />
              </ProtectedRoute>
            ) : (
              <LoginPage />
            )
          } />
          <Route path="/novels/:id" element={
            <ProtectedRoute>
              <NovelDetailPage />
            </ProtectedRoute>
          } />
          <Route path="/characters/:charId" element={
            <ProtectedRoute>
              <CharacterDetailPage />
            </ProtectedRoute>
          } />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

const navLinkStyle: React.CSSProperties = {
  textDecoration: 'none',
  color: '#666',
  fontSize: '14px',
  padding: '8px 12px',
  borderRadius: '4px',
  transition: 'all 0.2s'
};

export default AppWithRoutes;





