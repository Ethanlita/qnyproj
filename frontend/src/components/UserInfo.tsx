/**
 * 用户信息组件
 * 
 * 显示在导航栏，展示当前登录用户信息和登出按钮
 */

import type { CSSProperties } from 'react';
import { useAuth } from '../auth/AuthContext';

type UserInfoProps = {
  compact?: boolean;
};

export function UserInfo({ compact = false }: UserInfoProps) {
  const { user, isAuthenticated, logout } = useAuth();

  if (!isAuthenticated || !user) {
    return null;
  }

  const handleLogout = async () => {
    if (window.confirm('确定要登出吗？')) {
      try {
        await logout();
      } catch (error) {
        console.error('[UserInfo] Logout failed:', error);
        alert('登出失败，请重试');
      }
    }
  };

  // 从用户信息中提取显示名称
  const displayName = user.profile.name || 
                     user.profile.preferred_username || 
                     user.profile.email || 
                     'User';

  const email = user.profile.email;

  const containerStyle: CSSProperties = compact
    ? {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '6px 10px',
        background: 'rgba(255,255,255,0.65)',
        borderRadius: '999px',
        boxShadow: '0 4px 12px rgba(148,163,184,0.15)',
        border: '1px solid rgba(148, 163, 184, 0.25)'
      }
    : {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 16px',
        backgroundColor: '#f5f5f5',
        borderRadius: '20px'
      };

  return (
    <div style={containerStyle}>
      {/* 头像 */}
      <div style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        backgroundColor: '#667eea',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontSize: '14px',
        fontWeight: 'bold'
      }}>
        {displayName.charAt(0).toUpperCase()}
      </div>

      {/* 用户信息 */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px'
      }}>
        <span style={{
          fontSize: '14px',
          fontWeight: '600',
          color: '#333'
        }}>
          {displayName}
        </span>
        {email && !compact && (
          <span style={{
            fontSize: '12px',
            color: '#666'
          }}>
            {email}
          </span>
        )}
      </div>

      {/* 登出按钮 */}
      <button
        onClick={handleLogout}
        style={{
          marginLeft: compact ? 0 : '8px',
          padding: compact ? '4px 10px' : '6px 12px',
          background: compact ? 'linear-gradient(135deg, #f472b6, #ec4899)' : 'white',
          color: compact ? '#fff' : '#666',
          border: compact ? 'none' : '1px solid #ddd',
          borderRadius: '999px',
          fontSize: compact ? '12px' : '12px',
          cursor: 'pointer',
          boxShadow: compact ? '0 6px 16px rgba(236, 72, 153, 0.3)' : 'none',
          transition: 'all 0.2s'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        退出
      </button>
    </div>
  );
}
