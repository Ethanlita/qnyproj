/**
 * Dredd Hooks - 契约测试钩子函数
 * 用于配置测试前的准备工作（Mock 数据、认证等）
 */

const hooks = require('hooks');

// Mock JWT Token (用于绕过 Cognito 认证)
const MOCK_JWT_TOKEN = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItMTIzIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIn0.mock-signature';

// ==========================================
// 全局钩子
// ==========================================

hooks.beforeAll((transactions, done) => {
  console.log('\n🚀 开始 Dredd 契约测试...\n');
  console.log('📋 测试端点数:', transactions.length);
  done();
});

hooks.afterAll((transactions, done) => {
  console.log('\n✅ Dredd 契约测试完成!\n');
  done();
});

// ==========================================
// 每个请求前的通用配置
// ==========================================

hooks.beforeEach((transaction, done) => {
  // 为所有需要认证的请求注入 Token (除了 /edge-probe)
  if (!transaction.fullPath.includes('/edge-probe')) {
    transaction.request.headers['Authorization'] = `Bearer ${MOCK_JWT_TOKEN}`;
  }
  
  // 设置 Content-Type
  transaction.request.headers['Content-Type'] = 'application/json';
  
  done();
});

// ==========================================
// 特定端点的钩子
// ==========================================

// POST /novels - 创建新作品
hooks.before('/novels > 创建新作品 > 201 > application/json', (transaction, done) => {
  transaction.request.body = JSON.stringify({
    title: '测试小说 - Dredd 契约测试',
    text: '从前有一个勇士，他的名字叫艾登，他踏上了寻找真理的旅程...'
  });
  console.log('📝 POST /novels - 准备创建测试小说');
  done();
});

// GET /novels/{id} - 获取作品详情
hooks.before('/novels/{id} > 获取作品详情 > 200 > application/json', (transaction, done) => {
  // 使用 Mock ID
  const mockId = 'test-novel-123';
  transaction.fullPath = transaction.fullPath.replace('{id}', mockId);
  transaction.request.uri = transaction.request.uri.replace('{id}', mockId);
  console.log(`📖 GET /novels/${mockId} - 获取作品详情`);
  done();
});

// POST /novels/{id}/analyze - 分析小说生成分镜
hooks.before('/novels/{id}/analyze > 分析小说文本生成分镜 > 202 > application/json', (transaction, done) => {
  const mockId = 'test-novel-123';
  transaction.fullPath = transaction.fullPath.replace('{id}', mockId);
  transaction.request.uri = transaction.request.uri.replace('{id}', mockId);
  console.log(`🔍 POST /novels/${mockId}/analyze - 开始分析`);
  done();
});

// GET /jobs/{id} - 查询任务进度
hooks.before('/jobs/{id} > 查询任务进度 > 200 > application/json', (transaction, done) => {
  const mockId = 'test-job-123';
  transaction.fullPath = transaction.fullPath.replace('{id}', mockId);
  transaction.request.uri = transaction.request.uri.replace('{id}', mockId);
  console.log(`⏳ GET /jobs/${mockId} - 查询任务进度`);
  done();
});

// GET /storyboards/{id} - 获取分镜详情
hooks.before('/storyboards/{id} > 获取分镜详情 > 200 > application/json', (transaction, done) => {
  const mockId = 'test-storyboard-123';
  transaction.fullPath = transaction.fullPath.replace('{id}', mockId);
  transaction.request.uri = transaction.request.uri.replace('{id}', mockId);
  console.log(`🎬 GET /storyboards/${mockId} - 获取分镜详情`);
  done();
});

// ==========================================
// 响应验证后的钩子 (可选)
// ==========================================

hooks.afterEach((transaction, done) => {
  if (transaction.test.status === 'pass') {
    console.log(`  ✅ ${transaction.name} - 通过`);
  } else if (transaction.test.status === 'fail') {
    console.log(`  ❌ ${transaction.name} - 失败`);
    console.log('  错误:', transaction.test.message);
  } else if (transaction.test.status === 'skip') {
    console.log(`  ⏭️  ${transaction.name} - 跳过`);
  }
  done();
});
