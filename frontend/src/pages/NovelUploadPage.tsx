import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NovelsService } from '../api/generated';
import type { Novel } from '../api/generated';

/**
 * 上传小说页面
 */
export function NovelUploadPage() {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [genre, setGenre] = useState('');
  const [uploading, setUploading] = useState(false);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!title.trim()) {
      setError('请输入作品标题');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      // 创建作品
      const createdNovel = await NovelsService.createNovel({
        requestBody: {
          title,
          text: text || undefined,
          metadata: {
            genre: genre || undefined,
            tags: []
          }
        }
      });

      setNovel(createdNovel);
      alert(`作品创建成功! ID: ${createdNovel.id}`);

      // 可选: 自动开始分析
      if (text) {
        const job = await NovelsService.postNovelsAnalyze({
          id: createdNovel.id,
          requestBody: {}
        });
        console.log('Analysis job started:', job);
        alert(`分析已开始! Job ID: ${job.jobId}`);
      }

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Upload failed:', error);
      setError(message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>📖 上传小说</h1>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          作品标题 *
        </label>
        <input
          type="text"
          placeholder="输入作品标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '16px',
            border: '1px solid #ccc',
            borderRadius: '4px'
          }}
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          类型 (可选)
        </label>
        <input
          type="text"
          placeholder="如: 奇幻、科幻、现代"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '16px',
            border: '1px solid #ccc',
            borderRadius: '4px'
          }}
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          小说文本 (可选,也可以后续上传)
        </label>
        <textarea
          placeholder="粘贴小说文本..."
          rows={15}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '14px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontFamily: 'monospace'
          }}
        />
        <small style={{ color: '#666' }}>
          💡 提示：可以直接粘贴小说文本（最多 50k 字），也可以先创建作品留空，后续由管理员上传完整文件。
        </small>
      </div>

      {error && (
        <div style={{
          padding: '12px',
          marginBottom: '20px',
          backgroundColor: '#fee',
          border: '1px solid #fcc',
          borderRadius: '4px',
          color: '#c00'
        }}>
          ❌ {error}
        </div>
      )}

      {novel && (
        <div style={{
          padding: '12px',
          marginBottom: '20px',
          backgroundColor: '#efe',
          border: '1px solid #cfc',
          borderRadius: '4px',
          color: '#060'
        }}>
          ✅ 作品创建成功! 
          <Link 
            to={`/novels/${novel.id}`}
            style={{
              marginLeft: '8px',
              color: '#007bff',
              textDecoration: 'underline',
              fontWeight: 'bold'
            }}
          >
            查看详情 →
          </Link>
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={uploading}
        style={{
          padding: '12px 24px',
          fontSize: '16px',
          backgroundColor: uploading ? '#ccc' : '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: uploading ? 'not-allowed' : 'pointer',
          fontWeight: 'bold'
        }}
      >
        {uploading ? '上传中...' : '创建作品'}
      </button>

      <div style={{ marginTop: '40px', padding: '16px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
        <h3>💡 提示</h3>
        <ul style={{ lineHeight: '1.8' }}>
          <li>创建作品后可以在详情页中管理角色和分镜</li>
          <li>如果现在上传文本，会自动开始 AI 分析</li>
          <li>也可以先创建空作品，后续再上传文本</li>
          <li>所有数据都与您的 Cognito 账户关联</li>
        </ul>
      </div>
    </div>
  );
}
