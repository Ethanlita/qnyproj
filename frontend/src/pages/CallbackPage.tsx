/**
 * 登录回调页面
 * 
 * 处理 Cognito 重定向回来的登录请求
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleLoginCallback } from '../auth/cognito';

export function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handleLoginCallback()
      .then((user) => {
        if (user) {
          // 获取登录前的页面路径
          const state = user.state as { returnUrl?: string } | undefined;
          const returnUrl = state?.returnUrl || '/';
          
          console.log('[Callback] Redirecting to:', returnUrl);
          navigate(returnUrl, { replace: true });
        } else {
          setError('登录失败：未获取到用户信息');
        }
      })
      .catch((err) => {
        console.error('[Callback] Error:', err);
        setError(err.message || '登录失败');
      });
  }, [navigate]);

  if (error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '20px',
        backgroundColor: '#f5f5f5'
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          maxWidth: '500px',
          textAlign: 'center'
        }}>
          <h1 style={{ color: '#ff4d4f', marginBottom: '16px' }}>❌ 登录失败</h1>
          <p style={{ color: '#666', marginBottom: '24px' }}>{error}</p>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '10px 24px',
              backgroundColor: '#1890ff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '20px',
      backgroundColor: '#f5f5f5'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '40px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        textAlign: 'center'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '4px solid #f3f3f3',
          borderTop: '4px solid #1890ff',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 20px'
        }} />
        <p style={{ color: '#666', fontSize: '16px' }}>正在登录，请稍候...</p>
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
