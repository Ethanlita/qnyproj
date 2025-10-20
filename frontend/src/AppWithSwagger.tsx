import { useState } from 'react';
import SwaggerDocs from './SwaggerDocs';
import { ApiTest } from './ApiTest';
import { EdgeProbeDemo } from './EdgeProbeDemo';
import { NovelUploadPage } from './pages/NovelUploadPage';
import './App.css';

type TabType = 'home' | 'novels' | 'swagger' | 'api-test' | 'edge-probe';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('home');

  return (
    <div className="app">
      {/* 顶部导航 */}
      <nav style={{
        display: 'flex',
        gap: '10px',
        padding: '15px',
        backgroundColor: '#282c34',
        color: 'white',
        borderBottom: '2px solid #61dafb',
      }}>
        <h2 style={{ margin: 0, marginRight: 'auto' }}>📚 Novel-to-Comics</h2>
        <button 
          onClick={() => setActiveTab('home')}
          style={getButtonStyle(activeTab === 'home')}
        >
          🏠 首页
        </button>
        <button 
          onClick={() => setActiveTab('novels')}
          style={getButtonStyle(activeTab === 'novels')}
        >
          📖 我的作品
        </button>
        <button 
          onClick={() => setActiveTab('swagger')}
          style={getButtonStyle(activeTab === 'swagger')}
        >
          📚 API 文档
        </button>
        <button 
          onClick={() => setActiveTab('api-test')}
          style={getButtonStyle(activeTab === 'api-test')}
        >
          🧪 API 测试
        </button>
        <button 
          onClick={() => setActiveTab('edge-probe')}
          style={getButtonStyle(activeTab === 'edge-probe')}
        >
          🌐 CDN 探测
        </button>
      </nav>

      {/* 内容区域 */}
      <div style={{ height: 'calc(100vh - 65px)', overflow: 'auto' }}>
        {activeTab === 'home' && <HomePage />}
        {activeTab === 'novels' && <NovelUploadPage />}
        {activeTab === 'swagger' && <SwaggerDocs />}
        {activeTab === 'api-test' && <ApiTest />}
        {activeTab === 'edge-probe' && <EdgeProbeDemo />}
      </div>
    </div>
  );
}

function HomePage() {
  return (
    <div style={{ 
      padding: '40px', 
      maxWidth: '800px', 
      margin: '0 auto',
      textAlign: 'left',
    }}>
      <h1>🎉 欢迎使用 Novel-to-Comics</h1>
      <p style={{ fontSize: '18px', lineHeight: '1.6' }}>
        AI 驱动的小说转漫画平台。使用 <strong>Qwen</strong> 生成分镜，
        <strong>Imagen 3</strong> 生成图像，自动将文本转换为精美漫画。
      </p>

      <div style={{
        backgroundColor: '#e7f3ff',
        padding: '20px',
        borderRadius: '8px',
        border: '1px solid #b3d9ff',
        marginTop: '30px',
      }}>
        <h2>🚀 快速开始</h2>
        <ol style={{ fontSize: '16px', lineHeight: '1.8' }}>
          <li>点击 <strong>📖 我的作品</strong> 标签上传小说文本</li>
          <li>等待 AI 自动分析并生成分镜大纲</li>
          <li>管理角色配置，上传参考图</li>
          <li>批量生成漫画面板预览</li>
          <li>导出为 PDF 或 Webtoon 长图</li>
        </ol>
      </div>

      <div style={{
        backgroundColor: '#f0f8ff',
        padding: '20px',
        borderRadius: '8px',
        border: '1px solid #b3d9ff',
        marginTop: '30px',
      }}>
        <h2>✨ 核心功能</h2>
        <ul style={{ fontSize: '16px', lineHeight: '1.8' }}>
          <li>🎬 <strong>AI 分镜生成</strong> - Qwen 自动解析文本生成分镜</li>
          <li>👤 <strong>角色多配置</strong> - 支持战斗装/日常装等多种形态</li>
          <li>🎨 <strong>批量出图</strong> - Imagen 3 并行生成漫画面板</li>
          <li>✏️ <strong>可视化编辑</strong> - 在线编辑对白和布局</li>
          <li>📦 <strong>灵活导出</strong> - PDF / Webtoon / 资源包</li>
          <li>🔒 <strong>类型安全</strong> - OpenAPI 驱动的端到端开发</li>
        </ul>
      </div>

      <div style={{
        backgroundColor: '#fff3cd',
        padding: '20px',
        borderRadius: '8px',
        border: '1px solid #ffeaa7',
        marginTop: '20px',
      }}>
        <h2>🚀 快速开始</h2>
        <ol style={{ fontSize: '16px', lineHeight: '1.8' }}>
          <li>
            <strong>查看 API 文档</strong>: 点击顶部的 "📚 API 文档 (Swagger)" 标签
          </li>
          <li>
            <strong>测试 API</strong>: 点击 "🧪 API 测试" 标签测试实际的 API 调用
          </li>
          <li>
            <strong>添加新 API</strong>: 编辑 <code>openapi.template.yaml</code>，
            然后运行 <code>npm run generate:frontend-api</code>
          </li>
        </ol>
      </div>

      <div style={{
        backgroundColor: '#d4edda',
        padding: '20px',
        borderRadius: '8px',
        border: '1px solid #c3e6cb',
        marginTop: '20px',
      }}>
        <h2>📖 开发流程</h2>
        <pre style={{
          backgroundColor: '#2d2d2d',
          color: '#f8f8f2',
          padding: '15px',
          borderRadius: '5px',
          overflow: 'auto',
        }}>{`# 1. 编辑 API 定义
vim openapi.template.yaml

# 2. 生成前端 API 客户端
npm run generate:frontend-api

# 3. 在代码中使用（类型安全）
import { DefaultService } from './api/generated';
const items = await DefaultService.getItems();

# 4. 部署后端
npm run deploy:backend`}</pre>
      </div>

      <div style={{
        marginTop: '30px',
        padding: '15px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
      }}>
        <h3>📚 相关文档</h3>
        <ul>
          <li><a href="https://github.com/Ethanlita/qnyproj" target="_blank">GitHub 仓库</a></li>
          <li><code>README.md</code> - 项目说明</li>
          <li><code>SWAGGER_READY.md</code> - Swagger 使用指南</li>
          <li><code>QUICK_REFERENCE.md</code> - 快速参考</li>
        </ul>
      </div>
    </div>
  );
}

function getButtonStyle(isActive: boolean) {
  return {
    padding: '10px 20px',
    fontSize: '16px',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    backgroundColor: isActive ? '#61dafb' : '#3a3f47',
    color: isActive ? '#282c34' : 'white',
    fontWeight: isActive ? 'bold' : 'normal',
    transition: 'all 0.3s',
  };
}

export default App;
