/**
 * API 客户端使用示例
 * 
 * 这个文件展示了如何使用自动生成的 TypeScript API 客户端
 * 所有的客户端代码都是从 openapi.template.yaml 自动生成的
 */

import { OpenAPI, DefaultService, type Item } from './generated';

// ============================================
// 1. 配置 API 客户端
// ============================================

/**
 * 在应用启动时配置 API 基础 URL
 * 通常在 main.tsx 或 App.tsx 中调用
 */
export function configureApiClient() {
  // 设置 API 基础 URL
  OpenAPI.BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.example.com';
  
  // 如果需要认证，设置 token
  // OpenAPI.TOKEN = 'your-auth-token';
  
  // 或者使用动态 token（例如从 localStorage 获取）
  OpenAPI.TOKEN = async () => {
    const token = localStorage.getItem('authToken');
    return token || '';
  };
  
  // 设置自定义 headers（如果需要）
  OpenAPI.HEADERS = {
    'X-Custom-Header': 'value',
  };
}

// ============================================
// 2. 使用 API 服务
// ============================================

/**
 * 获取所有 items
 * 返回类型安全的 Item 数组
 */
export async function fetchItems(): Promise<Item[]> {
  try {
    const items = await DefaultService.getItems();
    console.log('Fetched items:', items);
    return items;
  } catch (error) {
    console.error('Failed to fetch items:', error);
    throw error;
  }
}

// ============================================
// 3. 在 React 组件中使用
// ============================================

/**
 * React 组件示例
 */
/*
import { useState, useEffect } from 'react';

export function ItemsList() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchItems()
      .then(setItems)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <ul>
      {items.map(item => (
        <li key={item.id}>
          {item.name}
        </li>
      ))}
    </ul>
  );
}
*/

// ============================================
// 4. 使用 React Query (推荐)
// ============================================

/**
 * 使用 @tanstack/react-query 进行数据管理
 */
/*
import { useQuery } from '@tanstack/react-query';

export function useItems() {
  return useQuery({
    queryKey: ['items'],
    queryFn: fetchItems,
    staleTime: 5 * 60 * 1000, // 5 分钟
  });
}

// 在组件中使用
export function ItemsListWithQuery() {
  const { data: items, isLoading, error } = useItems();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {items?.map(item => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
}
*/

// ============================================
// 5. 错误处理
// ============================================

/**
 * 处理 API 错误的辅助函数
 */
export function handleApiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '未知错误';
}

// ============================================
// 6. 类型安全的好处
// ============================================

/**
 * TypeScript 会自动推断类型
 * 你会获得完整的 IDE 自动补全和类型检查
 */
export async function exampleTypeScript() {
  const items = await DefaultService.getItems();
  
  // ✅ TypeScript 知道 items 是 Item[] 类型
  items.forEach(item => {
    // ✅ 自动补全：item.id, item.name
    console.log(item.id, item.name);
    
    // ❌ 编译错误：Property 'invalidProperty' does not exist
    // console.log(item.invalidProperty);
  });
}

// ============================================
// 7. 当 API 更新时
// ============================================

/**
 * 当你修改 openapi.template.yaml 后：
 * 
 * 1. 运行: npm run generate:frontend-api
 * 2. 所有类型和服务会自动更新
 * 3. TypeScript 会立即显示任何类型不匹配的错误
 * 4. 修复这些错误，确保前后端同步
 * 
 * 这就是 OpenAPI 驱动开发的威力！
 */
