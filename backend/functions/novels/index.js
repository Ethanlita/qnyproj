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
    
    // GET /novels - 获取作品列表
    if (method === 'GET' && (path === '/novels' || path === '/dev/novels')) {
      const limit = parseInt(event.queryStringParameters?.limit || '20', 10);
      const lastKey = event.queryStringParameters?.lastKey;
      
      console.log('Fetching novels list, limit:', limit, 'lastKey:', lastKey);
      
      // Mock 数据 - 返回用户的作品列表
      const mockNovels = [
        {
          id: 'novel-001',
          title: '勇士的奇幻冒险',
          status: 'analyzed',
          storyboardId: 'story-001',
          userId,
          metadata: {
            genre: '奇幻',
            tags: ['冒险', '魔法']
          },
          createdAt: '2025-10-20T08:00:00Z',
          updatedAt: '2025-10-20T09:00:00Z'
        },
        {
          id: 'novel-002',
          title: '未来科技传说',
          status: 'created',
          userId,
          metadata: {
            genre: '科幻',
            tags: ['未来', 'AI']
          },
          createdAt: '2025-10-19T10:00:00Z',
          updatedAt: '2025-10-19T10:00:00Z'
        },
        {
          id: 'novel-003',
          title: '古代武侠江湖',
          status: 'analyzing',
          userId,
          metadata: {
            genre: '武侠',
            tags: ['江湖', '侠义']
          },
          createdAt: '2025-10-18T14:00:00Z',
          updatedAt: '2025-10-18T15:00:00Z'
        }
      ];
      
      // 简单分页（实际应该从 DynamoDB 查询）
      const items = mockNovels.slice(0, limit);
      const hasMore = mockNovels.length > limit;
      
      return successResponse({
        items,
        lastKey: hasMore ? 'mock-last-key' : undefined
      });
    }
    
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



