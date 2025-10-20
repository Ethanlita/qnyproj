/**
 * 认证相关工具函数
 */

function getUserId(event) {
  // 从 Cognito Authorizer 获取用户 ID
  return event.requestContext?.authorizer?.claims?.sub || null;
}

function getUserEmail(event) {
  return event.requestContext?.authorizer?.claims?.email || null;
}

function requireAuth(event) {
  const userId = getUserId(event);
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return userId;
}

module.exports = {
  getUserId,
  getUserEmail,
  requireAuth
};



