const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { v4: uuid } = require('uuid');

/**
 * 生成角色配置的标准像 (Mock 实现)
 * 真实实现在 M3 阶段
 */
exports.handler = async (event) => {
  try {
    const { charId, configId } = event.pathParameters;
    const userId = getUserId(event) || 'mock-user';
    
    console.log(`Generating portraits for character: ${charId}, config: ${configId}`);
    
    // Mock: 返回任务ID
    const jobId = uuid();
    
    return successResponse({
      jobId,
      message: 'Portrait generation started. Use GET /jobs/{jobId} to check progress.'
    }, 202);
    
  } catch (error) {
    console.error('GeneratePortraitFunction error:', error);
    return errorResponse(500, error.message);
  }
};



