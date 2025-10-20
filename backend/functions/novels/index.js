const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { v4: uuid } = require('uuid');

/**
 * 小说管理 Lambda 函数
 * 处理路由: POST /novels, GET /novels/{id}, DELETE /novels/{id}
 */
exports.handler = async (event) => {
  try {
    const path = event.path || event.rawPath;
    const method = event.httpMethod || event.requestContext?.http?.method;
    const userId = getUserId(event) || 'mock-user';
    
    console.log(`NovelsFunction: ${method} ${path}`);
    
    // POST /novels - 创建作品
    if (method === 'POST' && (path === '/novels' || path === '/dev/novels')) {
      const body = JSON.parse(event.body || '{}');
      const { title, text, metadata } = body;
      
      const novel = {
        id: uuid(),
        title: title || '未命名作品',
        originalText: text,
        status: 'created',
        userId,
        metadata: metadata || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      console.log('Created novel:', novel.id);
      return successResponse(novel, 201);
    }
    
    // GET /novels/{id} - 获取作品详情
    if (method === 'GET' && path.match(/\/novels\/[^/]+$/)) {
      const novelId = event.pathParameters?.id;
      
      // Mock 数据
      const novel = {
        id: novelId,
        title: '测试小说 - 勇士的冒险',
        originalTextS3: `novels/${novelId}/original.txt`,
        status: 'analyzed',
        storyboardId: 'story-001',
        userId,
        metadata: {
          genre: '奇幻',
          tags: ['冒险', '魔法']
        },
        createdAt: '2025-10-19T08:00:00Z',
        updatedAt: '2025-10-19T09:00:00Z'
      };
      
      return successResponse(novel);
    }
    
    // DELETE /novels/{id} - 删除作品
    if (method === 'DELETE' && path.match(/\/novels\/[^/]+$/)) {
      const novelId = event.pathParameters?.id;
      console.log('Deleting novel:', novelId);
      
      return {
        statusCode: 204,
        headers: require('../../lib/response').corsHeaders(),
        body: ''
      };
    }
    
    return errorResponse(404, 'Not found');
    
  } catch (error) {
    console.error('NovelsFunction error:', error);
    return errorResponse(500, error.message);
  }
};



