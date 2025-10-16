import { useState } from 'react';
import { EdgeDiagnosticsService, type EdgeProbeResult } from './api/generated';

/**
 * Edge Probe 诊断演示组件
 * 展示如何使用新添加的 edge-probe API
 */
export function EdgeProbeDemo() {
  const [result, setResult] = useState<EdgeProbeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const probeEdge = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // 使用自动生成的类型安全 API 客户端
      const data = await EdgeDiagnosticsService.getEdgeProbe();
      
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '探测边缘服务器失败');
      console.error('Edge probe failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>
      <h2>🌐 Edge Probe 诊断</h2>
      <p>测试新添加的公开 API 端点：<code>/edge-probe</code></p>

      <div style={{
        backgroundColor: '#f0f8ff',
        padding: '15px',
        borderRadius: '8px',
        marginBottom: '20px',
      }}>
        <h3>📝 API 特性</h3>
        <ul style={{ textAlign: 'left', lineHeight: '1.8' }}>
          <li>✅ <strong>公开端点</strong> - 不需要认证</li>
          <li>✅ <strong>类型安全</strong> - TypeScript 自动生成</li>
          <li>✅ <strong>返回请求信息</strong> - 包含 Host、路径、Headers 等</li>
          <li>✅ <strong>用于调试</strong> - 检查 CDN 和边缘路由配置</li>
        </ul>
      </div>

      <button
        onClick={probeEdge}
        disabled={loading}
        style={{
          padding: '12px 24px',
          fontSize: '16px',
          cursor: loading ? 'not-allowed' : 'pointer',
          backgroundColor: loading ? '#ccc' : '#28a745',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontWeight: 'bold',
        }}
      >
        {loading ? '请求中...' : '🔍 探测边缘服务器'}
      </button>

      {error && (
        <div style={{
          marginTop: '20px',
          padding: '15px',
          backgroundColor: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: '4px',
          color: '#721c24',
        }}>
          <strong>❌ 错误:</strong> {error}
          <p style={{ marginTop: '10px', fontSize: '14px' }}>
            💡 <strong>提示:</strong> 这是正常的，因为后端还没有实现这个 API。
            但前端代码已经完全类型安全并且可以工作了！
          </p>
        </div>
      )}

      {result && (
        <div style={{
          marginTop: '20px',
          padding: '20px',
          backgroundColor: '#d4edda',
          border: '1px solid #c3e6cb',
          borderRadius: '8px',
          textAlign: 'left',
        }}>
          <h3>✅ 请求信息</h3>
          
          <div style={{ marginTop: '15px', lineHeight: '2' }}>
            <div style={{ marginBottom: '10px' }}>
              <strong>接收的 Host:</strong>{' '}
              <code style={{ 
                backgroundColor: '#fff', 
                padding: '4px 8px', 
                borderRadius: '4px',
                border: '1px solid #c3e6cb'
              }}>
                {result.receivedHost}
              </code>
            </div>
            
            <div style={{ marginBottom: '10px' }}>
              <strong>请求上下文域名:</strong>{' '}
              <code style={{ 
                backgroundColor: '#fff', 
                padding: '4px 8px', 
                borderRadius: '4px',
                border: '1px solid #c3e6cb'
              }}>
                {result.requestContextDomain}
              </code>
            </div>
            
            <div style={{ marginBottom: '10px' }}>
              <strong>HTTP 方法:</strong>{' '}
              <span style={{
                display: 'inline-block',
                padding: '4px 12px',
                borderRadius: '4px',
                fontWeight: 'bold',
                backgroundColor: '#007bff',
                color: 'white',
              }}>
                {result.method}
              </span>
            </div>
            
            <div style={{ marginBottom: '10px' }}>
              <strong>请求路径:</strong>{' '}
              <code style={{ 
                backgroundColor: '#fff', 
                padding: '4px 8px', 
                borderRadius: '4px',
                border: '1px solid #c3e6cb'
              }}>
                {result.path}
              </code>
            </div>
            
            {result.timestamp && (
              <div style={{ marginBottom: '10px' }}>
                <strong>时间戳:</strong> {new Date(result.timestamp).toLocaleString('zh-CN')}
              </div>
            )}
          </div>

          {result.headers && Object.keys(result.headers).length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <h4>📋 HTTP Headers</h4>
              <div style={{
                backgroundColor: 'white',
                padding: '15px',
                borderRadius: '6px',
                border: '1px solid #c3e6cb',
                maxHeight: '400px',
                overflowY: 'auto',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #dee2e6' }}>
                      <th style={{ 
                        textAlign: 'left', 
                        padding: '8px', 
                        fontWeight: 'bold',
                      }}>
                        Header 名称
                      </th>
                      <th style={{ 
                        textAlign: 'left', 
                        padding: '8px', 
                        fontWeight: 'bold',
                      }}>
                        值
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.headers).map(([key, value]) => (
                      <tr key={key} style={{ borderBottom: '1px solid #dee2e6' }}>
                        <td style={{ 
                          padding: '8px', 
                          fontWeight: 'bold',
                          color: '#495057',
                        }}>
                          {key}
                        </td>
                        <td style={{ 
                          padding: '8px',
                          fontFamily: 'monospace',
                          fontSize: '13px',
                          color: '#6c757d',
                          wordBreak: 'break-all',
                        }}>
                          {value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{
        marginTop: '30px',
        padding: '20px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        textAlign: 'left',
      }}>
        <h3>💡 类型安全示例</h3>
        <pre style={{
          backgroundColor: '#2d2d2d',
          color: '#f8f8f2',
          padding: '15px',
          borderRadius: '5px',
          overflow: 'auto',
          fontSize: '14px',
        }}>
{`// 使用自动生成的类型安全 API
import { EdgeDiagnosticsService, EdgeProbeResult } from './api/generated';

// TypeScript 知道所有类型！
const result: EdgeProbeResult = 
  await EdgeDiagnosticsService.getEdgeProbe();

// 自动补全和类型检查
console.log(result.receivedHost);          // string
console.log(result.requestContextDomain);  // string
console.log(result.method);                // string
console.log(result.path);                  // string
console.log(result.headers);               // Record<string, string> | undefined

// 遍历所有 headers（类型安全）
if (result.headers) {
  Object.entries(result.headers).forEach(([key, value]) => {
    console.log(\`\${key}: \${value}\`);
  });
}`}
        </pre>

        <div style={{
          marginTop: '15px',
          padding: '15px',
          backgroundColor: '#d1ecf1',
          border: '1px solid #bee5eb',
          borderRadius: '6px',
          color: '#0c5460',
        }}>
          <strong>🎯 使用场景：</strong>
          <ul style={{ marginTop: '10px', marginBottom: '0', lineHeight: '1.8' }}>
            <li>调试 CDN 配置 - 查看请求经过 CDN 后的 Header 变化</li>
            <li>验证边缘路由 - 确认请求是否正确路由到边缘节点</li>
            <li>诊断网络问题 - 检查请求路径和域名解析</li>
            <li>测试负载均衡 - 查看不同请求的路由信息</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
