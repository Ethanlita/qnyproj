const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');

/**
 * 面板查询 Lambda 函数 (Mock 实现)
 */
exports.handler = async (event) => {
  try {
    const panelId = event.pathParameters?.panelId;
    const userId = getUserId(event) || 'mock-user';
    
    console.log(`Getting panel: ${panelId}`);
    
    return successResponse({
      id: panelId,
      storyboardId: 'story-001',
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
      images: {
        preview: `https://example.com/panels/${panelId}-preview.png`,
        hd: `https://example.com/panels/${panelId}-hd.png`
      }
    });
    
  } catch (error) {
    console.error('PanelsFunction error:', error);
    return errorResponse(500, error.message);
  }
};



