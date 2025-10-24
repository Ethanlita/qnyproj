/**
 * API 配置工具
 * 
 * 初始化 API 客户端，配置 BASE URL 和认证
 */

import { OpenAPI } from '../api/generated/core/OpenAPI';
import { getApiToken } from '../auth/cognito';

/**
 * 初始化 API 配置
 */
export function initializeApiConfig() {
  // 配置 BASE URL
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
  if (baseUrl) {
    OpenAPI.BASE = baseUrl;
    console.log('[API] BASE URL configured:', baseUrl);
  } else {
    console.warn('[API] No BASE URL configured, using relative paths');
  }

  // 配置认证令牌获取函数
  OpenAPI.TOKEN = async () => {
    const token = await getApiToken();
    if (token) {
      console.log('[API] Access token retrieved');
      return token;
    }
    console.warn('[API] No access token available');
    // 返回空字符串，生成的代码使用 isStringWithValue() 检查
    // 空字符串会被正确跳过，不会添加 Authorization 头
    return '';
  };

  // 配置跨域凭证
  OpenAPI.WITH_CREDENTIALS = false;
  OpenAPI.CREDENTIALS = 'include';

  console.log('[API] API client initialized');
}
