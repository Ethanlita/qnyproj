import { useMemo, useState } from 'react';
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
  const [modal, setModal] = useState<{ novel: Novel; jobId?: string } | null>(null);

  const textLimit = 6000;

  const isSubmitDisabled = useMemo(
    () => uploading || !title.trim() || !text.trim() || text.length > textLimit,
    [uploading, title, text, textLimit]
  );

  const closeModal = () => setModal(null);

  const handleUpload = async () => {
    if (!title.trim() || !text.trim()) {
      setError('请填写完整的作品标题与小说文本内容。');
      return;
    }

    if (text.length > textLimit) {
      setError(`单章字数请控制在 ${textLimit} 字以内。`);
      return;
    }

    setUploading(true);
    setError(null);

    try {
      // 创建作品
      const createdNovel = await NovelsService.createNovel({
        requestBody: {
          title,
          text,
          metadata: {
            genre: genre || undefined,
            tags: []
          }
        }
      });

      setNovel(createdNovel);

      // 自动启动分析
      const analysisJob = await NovelsService.postNovelsAnalyze({
        id: createdNovel.id,
        requestBody: {}
      });

      setModal({
        novel: createdNovel,
        jobId: analysisJob?.jobId
      });
      setTitle('');
      setText('');
      setGenre('');

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Upload failed:', error);
      setError(message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      style={{
        padding: '28px',
        maxWidth: '800px',
        margin: '0 auto',
        background: 'rgba(255, 249, 253, 0.95)',
        borderRadius: '24px',
        border: '1px solid rgba(249, 168, 212, 0.25)',
        boxShadow: '0 24px 44px rgba(249, 168, 212, 0.18)'
      }}
    >
      <h1 style={{ color: '#7a1c62' }}>📖 上传小说</h1>

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
            padding: '12px 14px',
            fontSize: '16px',
            border: '1px solid rgba(249, 168, 212, 0.35)',
            borderRadius: '12px',
            backgroundColor: 'rgba(255, 255, 255, 0.94)',
            color: '#4b1d47'
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
            padding: '12px 14px',
            fontSize: '16px',
            border: '1px solid rgba(249, 168, 212, 0.35)',
            borderRadius: '12px',
            backgroundColor: 'rgba(255, 255, 255, 0.94)',
            color: '#4b1d47'
          }}
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          小说文本 *
        </label>
        <textarea
          placeholder="粘贴小说文本..."
          rows={15}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 14px',
            fontSize: '14px',
            border: '1px solid rgba(249, 168, 212, 0.35)',
            borderRadius: '12px',
            fontFamily: 'monospace',
            backgroundColor: 'rgba(255, 255, 255, 0.94)',
            color: '#4b1d47'
          }}
        />
        <small style={{ color: '#95508a', display: 'block', marginTop: '8px' }}>
          💡 小说正文为必填项，每次请提交单个章节，控制在 {textLimit} 字以内；后续章节可在分析完成后继续追加。
        </small>
      </div>

      {error && (
        <div style={{
          padding: '12px',
          marginBottom: '20px',
          backgroundColor: 'rgba(254, 226, 226, 0.86)',
          border: '1px solid rgba(248, 113, 113, 0.3)',
          borderRadius: '12px',
          color: '#be123c'
        }}>
          ❌ {error}
        </div>
      )}

      {novel && (
        <div style={{
          padding: '12px',
          marginBottom: '20px',
          backgroundColor: 'rgba(252, 207, 232, 0.24)',
          border: '1px solid rgba(249, 168, 212, 0.4)',
          borderRadius: '12px',
          color: '#7a1c62'
        }}>
          ✅ 作品创建成功! 
          <Link 
            to={`/novels/${novel.id}`}
            style={{
              marginLeft: '8px',
              color: '#7a1c62',
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
        disabled={isSubmitDisabled}
        style={{
          padding: '12px 24px',
          fontSize: '16px',
          background: uploading
            ? '#f3e8ee'
            : 'linear-gradient(135deg, #fbcfe8, #f9a8d4)',
          color: uploading ? '#7a1c62' : '#4b1d47',
          border: 'none',
          borderRadius: '12px',
          cursor: uploading ? 'not-allowed' : 'pointer',
          fontWeight: 'bold'
        }}
      >
        {uploading ? '上传中…' : '创建作品'}
      </button>

      <div style={{ marginTop: '40px', padding: '20px', background: 'rgba(255, 249, 253, 0.92)', borderRadius: '16px', border: '1px solid rgba(249, 168, 212, 0.3)' }}>
        <h3 style={{ marginTop: 0, color: '#7a1c62' }}>💡 提示</h3>
        <ul style={{ lineHeight: '1.8' }}>
          <li>创建作品后可以在详情页中管理角色和分镜</li>
          <li>上传文本后系统会自动开始 AI 分析</li>
          <li>作品与您的 Cognito 账户绑定，可随时在「作品空间」中查看</li>
          <li>所有数据都与您的 Cognito 账户关联</li>
        </ul>
      </div>

      {modal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(121, 28, 98, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 50
          }}
        >
          <div
            style={{
              width: 'min(480px, 100%)',
              background: 'rgba(255, 249, 253, 0.98)',
              borderRadius: '20px',
              padding: '28px',
              boxShadow: '0 32px 60px rgba(249, 168, 212, 0.28)',
              border: '1px solid rgba(249, 168, 212, 0.35)',
              color: '#4b1d47'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
              <div>
                <h2 style={{ margin: '0 0 6px', fontSize: '22px', color: '#7a1c62' }}>
                  作品创建成功
                </h2>
                <p style={{ margin: 0, color: '#95508a' }}>
                  系统已为你创建作品并启动分析任务，稍后可在作品详情页查看进度。
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="关闭弹窗"
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  color: '#95508a',
                  cursor: 'pointer',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                marginTop: '20px',
                padding: '18px',
                borderRadius: '16px',
                background: 'rgba(252, 207, 232, 0.24)',
                border: '1px solid rgba(249, 168, 212, 0.4)',
                display: 'grid',
                gap: '8px'
              }}
            >
              <div>
                <strong style={{ fontSize: '14px', textTransform: 'uppercase', color: '#c26ca6' }}>作品 ID</strong>
                <code
                  style={{
                    display: 'block',
                    marginTop: '4px',
                    padding: '8px 10px',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.8)',
                    color: '#7a1c62',
                    fontSize: '14px'
                  }}
                >
                  {modal.novel.id}
                </code>
              </div>
              {modal.jobId && (
                <div>
                  <strong style={{ fontSize: '14px', textTransform: 'uppercase', color: '#c26ca6' }}>分析任务</strong>
                  <code
                    style={{
                      display: 'block',
                      marginTop: '4px',
                      padding: '8px 10px',
                      borderRadius: '10px',
                      background: 'rgba(255, 255, 255, 0.8)',
                      color: '#7a1c62',
                      fontSize: '14px'
                    }}
                  >
                    {modal.jobId}
                  </code>
                </div>
              )}
            </div>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type='button'
                onClick={closeModal}
                style={{
                  padding: '10px 18px',
                  borderRadius: '12px',
                  border: '1px solid rgba(249, 168, 212, 0.4)',
                  background: 'rgba(255, 255, 255, 0.92)',
                  color: '#7a1c62',
                  cursor: 'pointer'
                }}
              >
                继续创建
              </button>
              <Link
                to={`/novels/${modal.novel.id}`}
                style={{
                  padding: '10px 20px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #fbcfe8, #f9a8d4)',
                  color: '#4b1d47',
                  fontWeight: 600
                }}
                onClick={closeModal}
              >
                查看作品详情
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
