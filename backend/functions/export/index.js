const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { v4: uuid } = require('uuid');

/**
 * 导出 Lambda 函数 (Mock 实现)
 * 真实实现在 M4 阶段
 */
exports.handler = async (event) => {
  try {
    const path = event.path || event.rawPath;
    const method = event.httpMethod || event.requestContext?.http?.method;
    const userId = getUserId(event) || 'mock-user';
    
    console.log(`ExportFunction: ${method} ${path}`);
    
    // POST /exports - 创建导出任务
    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { novelId, format } = body;
      
      console.log(`Creating export for novel: ${novelId}, format: ${format}`);
      
      const exportId = uuid();
      const jobId = uuid();
      
      return successResponse({
        exportId,
        jobId
      }, 202);
    }
    
    // GET /exports/{id} - 获取导出结果
    if (method === 'GET') {
      const exportId = event.pathParameters?.id;
      
      return successResponse({
        id: exportId,
        novelId: 'novel-001',
        format: 'pdf',
        status: 'completed',
        fileUrl: `https://example.com/exports/${exportId}/comic.pdf`,
        fileSize: 1024000,
        createdAt: new Date().toISOString()
      });
    }
    
    return errorResponse(404, 'Not found');
    
  } catch (error) {
    console.error('ExportFunction error:', error);
    return errorResponse(500, error.message);
  }
};



