const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');

/**
 * 任务管理 Lambda 函数 (Mock 实现)
 */
exports.handler = async (event) => {
  try {
    const jobId = event.pathParameters?.id;
    const userId = getUserId(event) || 'mock-user';
    
    console.log(`Getting job: ${jobId}`);
    
    // Mock 数据 - 模拟完成的任务
    const job = {
      id: jobId,
      type: 'analyze',
      status: 'completed',
      progress: {
        total: 1,
        completed: 1,
        failed: 0,
        percentage: 100.0
      },
      result: {
        storyboardId: 'story-001',
        version: 1,
        totalPages: 2,
        panelCount: 8,
        characters: [
          { id: 'char-001', name: '雷恩' },
          { id: 'char-002', name: '艾莉娅' }
        ]
      },
      createdAt: '2025-10-19T08:00:00Z',
      updatedAt: '2025-10-19T08:02:30Z'
    };
    
    return successResponse(job);
    
  } catch (error) {
    console.error('JobsFunction error:', error);
    return errorResponse(500, error.message);
  }
};



