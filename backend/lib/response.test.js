/**
 * 测试 response.js 工具函数
 */
const { corsHeaders, successResponse, errorResponse } = require('./response');

describe('Response Utils', () => {
  describe('corsHeaders', () => {
    test('should return correct CORS headers', () => {
      const headers = corsHeaders();
      expect(headers).toHaveProperty('Content-Type', 'application/json');
      expect(headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      expect(headers).toHaveProperty('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      expect(headers).toHaveProperty('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    });
  });

  describe('successResponse', () => {
    test('should return 200 response by default', () => {
      const data = { id: '123', name: 'Test' };
      const response = successResponse(data);
      
      expect(response.statusCode).toBe(200);
      expect(response.headers).toEqual(corsHeaders());
      expect(JSON.parse(response.body)).toEqual(data);
    });

    test('should return custom status code', () => {
      const data = { id: '123' };
      const response = successResponse(data, 201);
      
      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual(data);
    });

    test('should handle empty data', () => {
      const response = successResponse({});
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({});
    });
  });

  describe('errorResponse', () => {
    test('should return error response with message', () => {
      const response = errorResponse(400, 'Bad Request');
      
      expect(response.statusCode).toBe(400);
      expect(response.headers).toEqual(corsHeaders());
      
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Bad Request');
      expect(body.details).toBeUndefined();
    });

    test('should include details when provided', () => {
      const details = { field: 'email', issue: 'invalid format' };
      const response = errorResponse(400, 'Validation Error', details);
      
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Validation Error');
      expect(body.details).toEqual(details);
    });

    test('should handle common HTTP status codes', () => {
      const testCases = [
        { code: 400, message: 'Bad Request' },
        { code: 401, message: 'Unauthorized' },
        { code: 403, message: 'Forbidden' },
        { code: 404, message: 'Not Found' },
        { code: 500, message: 'Internal Server Error' }
      ];

      testCases.forEach(({ code, message }) => {
        const response = errorResponse(code, message);
        expect(response.statusCode).toBe(code);
        expect(JSON.parse(response.body).error).toBe(message);
      });
    });
  });
});
