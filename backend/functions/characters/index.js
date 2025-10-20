const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { v4: uuid } = require('uuid');

/**
 * 角色管理 Lambda 函数
 * 处理所有角色和配置相关的路由
 */
exports.handler = async (event) => {
  try {
    const path = event.path || event.rawPath;
    const method = event.httpMethod || event.requestContext?.http?.method;
    const userId = getUserId(event) || 'mock-user';
    
    console.log(`CharactersFunction: ${method} ${path}`);
    
    // GET /characters/{charId} - 获取角色详情
    if (method === 'GET' && path.match(/\/characters\/[^/]+$/) && !path.includes('/configurations')) {
      const charId = event.pathParameters?.charId;
      
      return successResponse({
        id: charId,
        name: '艾莉娅',
        role: 'protagonist',
        novelId: 'novel-001',
        baseInfo: {
          gender: 'female',
          age: 18,
          personality: ['勇敢', '善良', '有时冲动']
        },
        configurations: [
          {
            id: 'config-001',
            charId,
            name: '战斗模式',
            description: '穿着银白色铠甲，手持魔法剑',
            tags: ['战斗', '铠甲'],
            appearance: {
              hairStyle: '战斗马尾',
              clothing: ['银白色铠甲', '蓝色斗篷']
            },
            referenceImages: [],
            generatedPortraits: [],
            isDefault: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        defaultConfigId: 'config-001',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
    // PUT /characters/{charId} - 更新角色基础信息
    if (method === 'PUT' && path.match(/\/characters\/[^/]+$/) && !path.includes('/configurations')) {
      const charId = event.pathParameters?.charId;
      const body = JSON.parse(event.body || '{}');
      
      console.log('Updating character:', charId, body);
      
      return successResponse({
        id: charId,
        name: body.name || '艾莉娅',
        role: body.role || 'protagonist',
        baseInfo: body.baseInfo || {},
        updatedAt: new Date().toISOString()
      });
    }
    
    // GET /characters/{charId}/configurations - 列举配置
    if (method === 'GET' && path.match(/\/characters\/[^/]+\/configurations$/)  && !path.match(/\/configurations\/[^/]+/)) {
      const charId = event.pathParameters?.charId;
      
      return successResponse([
        {
          id: 'config-001',
          charId,
          name: '战斗模式',
          description: '穿着银白色铠甲',
          tags: ['战斗'],
          isDefault: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'config-002',
          charId,
          name: '日常装扮',
          description: '白色连衣裙',
          tags: ['日常'],
          isDefault: false,
          createdAt: new Date().toISOString()
        }
      ]);
    }
    
    // POST /characters/{charId}/configurations - 创建配置
    if (method === 'POST' && path.match(/\/characters\/[^/]+\/configurations$/)) {
      const charId = event.pathParameters?.charId;
      const body = JSON.parse(event.body || '{}');
      
      const config = {
        id: uuid(),
        charId,
        name: body.name,
        description: body.description,
        tags: body.tags || [],
        appearance: body.appearance || {},
        referenceImages: [],
        generatedPortraits: [],
        isDefault: body.isDefault || false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      console.log('Created configuration:', config.id);
      return successResponse(config, 201);
    }
    
    // GET /characters/{charId}/configurations/{configId} - 获取配置
    if (method === 'GET' && path.match(/\/characters\/[^/]+\/configurations\/[^/]+$/) && !path.includes('/refs') && !path.includes('/portraits')) {
      const { charId, configId } = event.pathParameters;
      
      return successResponse({
        id: configId,
        charId,
        name: '战斗模式',
        description: '穿着银白色铠甲，手持魔法剑',
        tags: ['战斗', '铠甲'],
        appearance: {
          hairStyle: '战斗马尾',
          clothing: ['铠甲', '剑']
        },
        referenceImages: [
          {
            url: `https://example.com/${configId}/ref-001.png`,
            caption: '正面视角',
            uploadedAt: new Date().toISOString()
          }
        ],
        generatedPortraits: [],
        isDefault: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
    // PUT /characters/{charId}/configurations/{configId} - 更新配置
    if (method === 'PUT' && path.match(/\/characters\/[^/]+\/configurations\/[^/]+$/)) {
      const { charId, configId } = event.pathParameters;
      const body = JSON.parse(event.body || '{}');
      
      console.log('Updating configuration:', configId, body);
      
      return successResponse({
        id: configId,
        charId,
        ...body,
        updatedAt: new Date().toISOString()
      });
    }
    
    // DELETE /characters/{charId}/configurations/{configId} - 删除配置
    if (method === 'DELETE' && path.match(/\/characters\/[^/]+\/configurations\/[^/]+$/)) {
      const { configId } = event.pathParameters;
      console.log('Deleting configuration:', configId);
      
      return {
        statusCode: 204,
        headers: require('../../lib/response').corsHeaders(),
        body: ''
      };
    }
    
    // POST /characters/{charId}/configurations/{configId}/refs - 上传参考图
    if (method === 'POST' && path.includes('/refs')) {
      const { charId, configId } = event.pathParameters;
      
      console.log('Uploading reference images for config:', configId);
      
      // Mock: 返回上传成功的图片列表
      return successResponse({
        uploaded: [
          {
            s3Key: `characters/${charId}/${configId}/ref-001.png`,
            url: `https://example.com/${configId}/ref-001.png`,
            caption: '参考图 1'
          },
          {
            s3Key: `characters/${charId}/${configId}/ref-002.png`,
            url: `https://example.com/${configId}/ref-002.png`,
            caption: '参考图 2'
          }
        ]
      });
    }
    
    return errorResponse(404, 'Not found');
    
  } catch (error) {
    console.error('CharactersFunction error:', error);
    return errorResponse(500, error.message);
  }
};



