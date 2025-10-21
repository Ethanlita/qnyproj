/**
 * 登录页面
 */

import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';

export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // 如果已登录，跳转到目标页面
    if (isAuthenticated) {
      const state = location.state as { returnUrl?: string } | null;
      const returnUrl = state?.returnUrl || '/';
      navigate(returnUrl, { replace: true });
    }
  }, [isAuthenticated, navigate, location]);

  const handleLogin = async () => {
    try {
      await login();
    } catch (error) {
      console.error('[LoginPage] Login failed:', error);
      alert('登录失败，请重试');
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '48px',
        borderRadius: '12px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
        maxWidth: '400px',
        width: '100%',
        textAlign: 'center'
      }}>
        <div style={{
          width: '80px',
          height: '80px',
          backgroundColor: '#667eea',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px',
          fontSize: '40px'
        }}>
          📚
        </div>

        <h1 style={{
          fontSize: '28px',
          fontWeight: 'bold',
          color: '#333',
          marginBottom: '8px'
        }}>
          Novel-to-Comics
        </h1>

        <p style={{
          fontSize: '14px',
          color: '#666',
          marginBottom: '32px'
        }}>
          小说转漫画创作平台
        </p>

        <button
          onClick={handleLogin}
          style={{
            width: '100%',
            padding: '14px 24px',
            backgroundColor: '#667eea',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s',
            boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = '#5568d3';
            e.currentTarget.style.transform = 'translateY(-2px)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = '#667eea';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          🔐 使用 AWS Cognito 登录
        </button>

        <p style={{
          fontSize: '12px',
          color: '#999',
          marginTop: '24px',
          lineHeight: '1.6'
        }}>
          首次登录将自动创建账户<br />
          登录即表示同意我们的服务条款和隐私政策
        </p>
      </div>
    </div>
  );
}
