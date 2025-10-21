/**
 * 用户信息组件
 * 
 * 显示在导航栏，展示当前登录用户信息和登出按钮
 */

import { useAuth } from '../auth/AuthContext';

export function UserInfo() {
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

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '8px 16px',
      backgroundColor: '#f5f5f5',
      borderRadius: '20px'
    }}>
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
        {email && (
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
          marginLeft: '8px',
          padding: '6px 12px',
          backgroundColor: 'white',
          color: '#666',
          border: '1px solid #ddd',
          borderRadius: '4px',
          fontSize: '12px',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = '#ff4d4f';
          e.currentTarget.style.color = 'white';
          e.currentTarget.style.borderColor = '#ff4d4f';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = 'white';
          e.currentTarget.style.color = '#666';
          e.currentTarget.style.borderColor = '#ddd';
        }}
      >
        登出
      </button>
    </div>
  );
}
