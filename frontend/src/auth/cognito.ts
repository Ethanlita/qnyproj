/**
 * AWS Cognito 认证工具
 * 
 * 封装 Cognito 用户池的登录、登出、令牌管理等功能
 */

import { UserManager, User, WebStorageStateStore } from 'oidc-client-ts';

// 从环境变量读取配置
const COGNITO_USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || '';
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || '';
const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN || '';
const AWS_REGION = import.meta.env.VITE_AWS_REGION || 'us-east-1';

// 🎯 动态回调 URL - 根据当前域名自动适配
// 本地: http://localhost:5173/callback
// 生产: https://ethanlita.github.io/qnyproj/callback
const getBaseUrl = () => {
  // Vite 在 GitHub Pages 部署时会自动处理 base path
  const origin = window.location.origin;
  const base = import.meta.env.BASE_URL || '/';
  return `${origin}${base.endsWith('/') ? base.slice(0, -1) : base}`;
};

const BASE_URL = getBaseUrl();
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || `${BASE_URL}/callback`;
const LOGOUT_URI = import.meta.env.VITE_LOGOUT_URI || BASE_URL;
const SILENT_REDIRECT_URI = import.meta.env.VITE_SILENT_REDIRECT_URI || `${BASE_URL}/silent-renew.html`;

// 构造 Cognito OIDC 配置
const authority = COGNITO_DOMAIN || `https://cognito-idp.${AWS_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;

const oidcConfig = {
  authority,
  client_id: COGNITO_CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  post_logout_redirect_uri: LOGOUT_URI,
  response_type: 'code',
  scope: 'openid profile email',
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  automaticSilentRenew: true,
  silent_redirect_uri: SILENT_REDIRECT_URI,
};

// 调试日志（仅在开发环境）
if (import.meta.env.DEV) {
  console.log('[Auth] Cognito Configuration:', {
    authority,
    client_id: COGNITO_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    post_logout_redirect_uri: LOGOUT_URI,
    silent_redirect_uri: SILENT_REDIRECT_URI,
  });
}

// 创建 UserManager 实例
let userManager: UserManager | null = null;

export function getUserManager(): UserManager {
  if (!userManager) {
    if (!COGNITO_CLIENT_ID || !COGNITO_USER_POOL_ID) {
      console.warn('[Auth] Cognito 配置缺失，认证功能将不可用');
      console.warn('[Auth] 请在 .env.local 中配置 VITE_COGNITO_USER_POOL_ID 和 VITE_COGNITO_CLIENT_ID');
    }
    userManager = new UserManager(oidcConfig);
  }
  return userManager;
}

/**
 * 跳转到登录页面
 */
export async function login(): Promise<void> {
  const manager = getUserManager();
  await manager.signinRedirect({
    state: { returnUrl: window.location.pathname }
  });
}

/**
 * 处理登录回调
 * 在 /callback 路由中调用
 */
export async function handleLoginCallback(): Promise<User | null> {
  const manager = getUserManager();
  try {
    const user = await manager.signinRedirectCallback();
    console.log('[Auth] Login successful:', user.profile);
    return user;
  } catch (error) {
    console.error('[Auth] Login callback error:', error);
    throw error;
  }
}

/**
 * 登出
 */
export async function logout(): Promise<void> {
  const manager = getUserManager();
  await manager.signoutRedirect();
}

/**
 * 获取当前用户
 */
export async function getUser(): Promise<User | null> {
  const manager = getUserManager();
  const user = await manager.getUser();
  return user;
}

/**
 * 检查用户是否已登录
 */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getUser();
  return user !== null && !user.expired;
}

/**
 * 获取访问令牌（用于 API 调用）
 */
export async function getAccessToken(): Promise<string | null> {
  const user = await getUser();
  return user?.access_token || null;
}

/**
 * 获取 ID 令牌
 */
export async function getIdToken(): Promise<string | null> {
  const user = await getUser();
  return user?.id_token || null;
}

/**
 * 静默刷新令牌
 */
export async function renewToken(): Promise<User | null> {
  const manager = getUserManager();
  try {
    const user = await manager.signinSilent();
    console.log('[Auth] Token renewed');
    return user;
  } catch (error) {
    console.error('[Auth] Token renewal failed:', error);
    return null;
  }
}

/**
 * 移除用户会话
 */
export async function removeUser(): Promise<void> {
  const manager = getUserManager();
  await manager.removeUser();
}

// 监听令牌即将过期事件
getUserManager().events.addAccessTokenExpiring(() => {
  console.log('[Auth] Access token expiring, renewing...');
  renewToken();
});

// 监听令牌过期事件
getUserManager().events.addAccessTokenExpired(() => {
  console.warn('[Auth] Access token expired');
  removeUser();
});
