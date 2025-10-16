import { useState, useEffect } from 'react';
import { OpenAPI, DefaultService, type Item } from './api/generated';

/**
 * API 测试组件
 * 展示如何使用自动生成的 TypeScript API 客户端
 */
export function ApiTest() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 配置 API 客户端（实际项目中应该在 main.tsx 中配置）
  useEffect(() => {
    // 设置 API 基础 URL
    OpenAPI.BASE = import.meta.env.VITE_API_BASE_URL || '';
    
    // 如果需要认证 token
    const token = localStorage.getItem('authToken');
    if (token) {
      OpenAPI.TOKEN = token;
    }
  }, []);

  const fetchItems = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // 使用类型安全的 API 调用
      const data = await DefaultService.getItems();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
      console.error('Failed to fetch items:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2>🎯 API 集成测试</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <p>
          <strong>API 状态:</strong> {OpenAPI.BASE || '未配置'}
        </p>
        <button 
          onClick={fetchItems} 
          disabled={loading}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            cursor: loading ? 'not-allowed' : 'pointer',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          {loading ? '加载中...' : '获取 Items'}
        </button>
      </div>

      {error && (
        <div style={{
          padding: '10px',
          backgroundColor: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: '4px',
          color: '#721c24',
          marginBottom: '20px',
        }}>
          <strong>错误:</strong> {error}
        </div>
      )}

      {items.length > 0 && (
        <div style={{
          padding: '10px',
          backgroundColor: '#d4edda',
          border: '1px solid #c3e6cb',
          borderRadius: '4px',
          marginBottom: '20px',
        }}>
          <h3>获取到 {items.length} 个 Items:</h3>
          <ul style={{ textAlign: 'left' }}>
            {items.map((item, index) => (
              <li key={item.id || index}>
                <strong>ID:</strong> {item.id}, <strong>Name:</strong> {item.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{
        marginTop: '30px',
        padding: '15px',
        backgroundColor: '#f8f9fa',
        border: '1px solid #dee2e6',
        borderRadius: '4px',
        textAlign: 'left',
      }}>
        <h3>✨ 类型安全的好处</h3>
        <ul>
          <li>自动补全：IDE 会提示所有可用的 API 方法</li>
          <li>类型检查：编译时发现类型错误</li>
          <li>重构安全：修改 API 后 TypeScript 会立即报错</li>
          <li>文档集成：从 OpenAPI 注释生成的文档</li>
        </ul>
        
        <h3>📝 如何添加新 API</h3>
        <ol>
          <li>编辑 <code>openapi.template.yaml</code></li>
          <li>运行 <code>npm run generate:frontend-api</code></li>
          <li>使用新的 API 方法（有完整类型支持）</li>
        </ol>
      </div>
    </div>
  );
}
