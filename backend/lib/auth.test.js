/**
 * 测试 auth.js 工具函数
 */
const { getUserId, getUserEmail, requireAuth } = require('./auth');

describe('Auth Utils', () => {
  describe('getUserId', () => {
    test('should extract user ID from Cognito authorizer', () => {
      const event = {
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123',
              email: 'test@example.com'
            }
          }
        }
      };
      
      expect(getUserId(event)).toBe('user-123');
    });

    test('should return null if no authorizer', () => {
      const event = {
        requestContext: {}
      };
      
      expect(getUserId(event)).toBeNull();
    });

    test('should return null if no claims', () => {
      const event = {
        requestContext: {
          authorizer: {}
        }
      };
      
      expect(getUserId(event)).toBeNull();
    });

    test('should handle missing requestContext', () => {
      const event = {};
      expect(getUserId(event)).toBeNull();
    });
  });

  describe('getUserEmail', () => {
    test('should extract email from Cognito authorizer', () => {
      const event = {
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123',
              email: 'test@example.com'
            }
          }
        }
      };
      
      expect(getUserEmail(event)).toBe('test@example.com');
    });

    test('should return null if no email', () => {
      const event = {
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        }
      };
      
      expect(getUserEmail(event)).toBeNull();
    });
  });

  describe('requireAuth', () => {
    test('should return user ID when authenticated', () => {
      const event = {
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        }
      };
      
      expect(requireAuth(event)).toBe('user-123');
    });

    test('should throw error when not authenticated', () => {
      const event = {
        requestContext: {}
      };
      
      expect(() => requireAuth(event)).toThrow('Unauthorized');
    });

    test('should throw error with missing requestContext', () => {
      const event = {};
      expect(() => requireAuth(event)).toThrow('Unauthorized');
    });
  });
});
