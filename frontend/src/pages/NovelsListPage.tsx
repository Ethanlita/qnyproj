import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { NovelsService } from '../api/generated';
import type { Novel } from '../api/generated';

/**
 * 作品列表页
 */
export function NovelsListPage() {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadNovels();
  }, []);

  const loadNovels = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await NovelsService.getNovels({});
      setNovels(data.items || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to load novels:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 200px)',
        padding: '40px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '4px solid #f3f3f3',
            borderTop: '4px solid #667eea',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px'
          }} />
          <p style={{ color: '#666', fontSize: '16px' }}>加载作品列表中...</p>
        </div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: '40px 20px',
        maxWidth: '600px',
        margin: '0 auto',
        textAlign: 'center'
      }}>
        <div style={{
          padding: '24px',
          backgroundColor: '#fee',
          border: '1px solid #fcc',
          borderRadius: '8px',
          color: '#c00'
        }}>
          <h2 style={{ marginBottom: '12px' }}>❌ 加载失败</h2>
          <p style={{ marginBottom: '16px' }}>{error}</p>
          <button
            onClick={loadNovels}
            style={{
              padding: '10px 24px',
              backgroundColor: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px 20px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* 头部 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '32px'
      }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: 'bold',
          color: '#333',
          margin: 0
        }}>
          📚 我的作品
        </h1>
        <Link 
          to="/upload"
          style={{
            display: 'inline-block',
            padding: '12px 24px',
            backgroundColor: '#667eea',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: 'bold',
            transition: 'all 0.2s',
            boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = '#5568d3';
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = '#667eea';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)';
          }}
        >
          ➕ 创建新作品
        </Link>
      </div>

      {/* 作品列表 */}
      {novels.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '80px 20px',
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
        }}>
          <div style={{
            fontSize: '64px',
            marginBottom: '24px',
            opacity: 0.5
          }}>
            📖
          </div>
          <h2 style={{
            fontSize: '24px',
            color: '#666',
            marginBottom: '12px',
            fontWeight: 'normal'
          }}>
            还没有作品
          </h2>
          <p style={{
            fontSize: '16px',
            color: '#999',
            marginBottom: '32px'
          }}>
            创建第一个作品，开始你的漫画创作之旅吧！
          </p>
          <Link 
            to="/upload"
            style={{
              display: 'inline-block',
              padding: '14px 32px',
              backgroundColor: '#667eea',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 'bold',
              transition: 'all 0.2s'
            }}
          >
            ➕ 创建第一个作品
          </Link>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '24px'
        }}>
          {novels.map(novel => (
            <Link 
              key={novel.id}
              to={`/novels/${novel.id}`}
              style={{
                display: 'block',
                padding: '24px',
                backgroundColor: 'white',
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                textDecoration: 'none',
                color: '#333',
                transition: 'all 0.2s',
                border: '1px solid #f0f0f0'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
                e.currentTarget.style.transform = 'translateY(-4px)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {/* 作品标题 */}
              <h3 style={{
                fontSize: '20px',
                fontWeight: 'bold',
                marginBottom: '12px',
                color: '#333',
                lineHeight: '1.4'
              }}>
                {novel.title}
              </h3>

              {/* 类型标签 */}
              {novel.metadata?.genre && (
                <div style={{
                  display: 'inline-block',
                  padding: '4px 12px',
                  backgroundColor: '#f0f0f0',
                  borderRadius: '12px',
                  fontSize: '13px',
                  color: '#666',
                  marginBottom: '12px'
                }}>
                  {novel.metadata.genre}
                </div>
              )}

              {/* 状态 */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: '1px solid #f0f0f0'
              }}>
                <span style={{
                  fontSize: '13px',
                  color: '#999'
                }}>
                  状态:
                </span>
                <span style={{
                  fontSize: '13px',
                  fontWeight: '500',
                  color: novel.status === 'analyzed' ? '#52c41a' : 
                         novel.status === 'analyzing' ? '#1890ff' : '#666'
                }}>
                  {novel.status === 'analyzed' ? '✅ 已分析' :
                   novel.status === 'analyzing' ? '⏳ 分析中' :
                   novel.status === 'created' ? '📝 已创建' : novel.status}
                </span>
              </div>

              {/* 创建时间 */}
              <div style={{
                fontSize: '12px',
                color: '#999',
                marginTop: '8px'
              }}>
                创建于 {new Date(novel.createdAt || '').toLocaleDateString('zh-CN')}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
