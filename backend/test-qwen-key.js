/**
 * Simple test script to verify Qwen API Key
 */

require('dotenv').config({ path: '.env' });
const OpenAI = require('openai');

const apiKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
const endpoint = process.env.QWEN_ENDPOINT || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

console.log('🔑 API Key:', apiKey ? `${apiKey.substring(0, 15)}...` : 'NOT FOUND');
console.log('📝 Full length:', apiKey ? apiKey.length : 0);
console.log('🌐 Endpoint:', endpoint);

const client = new OpenAI({
  apiKey: apiKey,
  baseURL: endpoint
});

async function test() {
  try {
    console.log('\n📡 Testing API call...');
    
    const response = await client.chat.completions.create({
      model: 'qwen-plus',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: '你好，请用一句话介绍你自己。' }
      ],
      max_tokens: 100
    });
    
    console.log('✅ Success!');
    console.log('\n响应:', response.choices[0].message.content);
    console.log('\nToken 使用:', response.usage);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Status:', error.status);
    console.error('Error details:', error);
  }
}

test();
