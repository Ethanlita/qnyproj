const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');

/**
 * 分镜管理 Lambda 函数 (Mock 实现)
 */
exports.handler = async (event) => {
  try {
    const storyboardId = event.pathParameters?.id;
    const userId = getUserId(event) || 'mock-user';
    
    console.log(`Getting storyboard: ${storyboardId}`);
    
    // Mock 数据
    const storyboard = {
      id: storyboardId,
      novelId: 'novel-001',
      version: 1,
      totalPages: 2,
      panelCount: 8,
      panels: [
        {
          id: 'panel-001',
          storyboardId,
          page: 1,
          index: 0,
          content: {
            scene: '村庄广场，清晨',
            shotType: 'wide',
            characters: [
              {
                charId: 'char-001',
                configId: 'config-001',
                name: '雷恩',
                pose: '站立',
                expression: 'neutral'
              }
            ],
            dialogue: [
              {
                speaker: '雷恩',
                text: '又是美好的一天。',
                bubbleType: 'thought'
              }
            ]
          },
          visualPrompt: 'manga style, village square, morning light',
          images: {}
        },
        {
          id: 'panel-002',
          storyboardId,
          page: 1,
          index: 1,
          content: {
            scene: '森林入口',
            shotType: 'medium',
            characters: [
              {
                charId: 'char-001',
                configId: 'config-001',
                name: '雷恩',
                pose: '准备出发',
                expression: 'determined'
              }
            ],
            dialogue: [
              {
                speaker: '雷恩',
                text: '是时候开始我的冒险了!',
                bubbleType: 'speech'
              }
            ]
          }
        }
      ],
      createdAt: new Date().toISOString()
    };
    
    return successResponse(storyboard);
    
  } catch (error) {
    console.error('StoryboardsFunction error:', error);
    return errorResponse(500, error.message);
  }
};



