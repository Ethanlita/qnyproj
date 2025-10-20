import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { NovelUploadPage } from './pages/NovelUploadPage';
import { NovelDetailPage } from './pages/NovelDetailPage';
import { CharacterDetailPage } from './pages/CharacterDetailPage';
import { SwaggerDocs } from './SwaggerDocs';
import { ApiTest } from './ApiTest';
import { EdgeProbeDemo } from './EdgeProbeDemo';
import './App.css';

/**
 * 带路由的主应用组件
 */
function AppWithRoutes() {
  return (
    <BrowserRouter>
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
              <Link to="/" style={navLinkStyle}>
                🏠 首页
              </Link>
              <Link to="/api-docs" style={navLinkStyle}>
                📖 API 文档
              </Link>
              <Link to="/api-test" style={navLinkStyle}>
                🧪 API 测试
              </Link>
              <Link to="/edge-probe" style={navLinkStyle}>
                🌐 CDN 探测
              </Link>
            </div>
          </div>
        </nav>

        {/* 路由内容 */}
        <Routes>
          <Route path="/" element={<NovelUploadPage />} />
          <Route path="/novels/:id" element={<NovelDetailPage />} />
          <Route path="/characters/:charId" element={<CharacterDetailPage />} />
          <Route path="/api-docs" element={<SwaggerDocs />} />
          <Route path="/api-test" element={<ApiTest />} />
          <Route path="/edge-probe" element={<EdgeProbeDemo />} />
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




