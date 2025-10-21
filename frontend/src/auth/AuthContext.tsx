/**
 * 认证上下文
 * 
 * 提供全局的认证状态和方法
 */

import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'oidc-client-ts';
import * as authService from './cognito';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 初始化：检查是否已登录
    authService.getUser()
      .then(user => {
        setUser(user);
      })
      .catch(error => {
        console.error('[AuthProvider] Failed to get user:', error);
      })
      .finally(() => {
        setIsLoading(false);
      });

    // 监听用户加载事件
    const manager = authService.getUserManager();
    
    const handleUserLoaded = (user: User) => {
      console.log('[AuthProvider] User loaded:', user.profile);
      setUser(user);
    };

    const handleUserUnloaded = () => {
      console.log('[AuthProvider] User unloaded');
      setUser(null);
    };

    const handleSilentRenewError = (error: Error) => {
      console.error('[AuthProvider] Silent renew error:', error);
    };

    manager.events.addUserLoaded(handleUserLoaded);
    manager.events.addUserUnloaded(handleUserUnloaded);
    manager.events.addSilentRenewError(handleSilentRenewError);

    // 清理
    return () => {
      manager.events.removeUserLoaded(handleUserLoaded);
      manager.events.removeUserUnloaded(handleUserUnloaded);
      manager.events.removeSilentRenewError(handleSilentRenewError);
    };
  }, []);

  const login = async () => {
    await authService.login();
  };

  const logout = async () => {
    await authService.logout();
    setUser(null);
  };

  const getAccessToken = async () => {
    return authService.getAccessToken();
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: user !== null && !user.expired,
    isLoading,
    login,
    logout,
    getAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * 使用认证上下文的 Hook
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
