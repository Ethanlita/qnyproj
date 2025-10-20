import { useEffect, useState } from 'react';
import { NovelsService, StoryboardsService, JobsService } from '../api/generated';
import type { Novel, Storyboard } from '../api/generated';

/**
 * 作品详情页
 */
export function NovelDetailPage() {
  const id = 'novel-001'; // Mock ID for testing (在 Tab 模式下使用固定ID)
  const [novel, setNovel] = useState<Novel | null>(null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadNovel();
  }, []);

  const loadNovel = async () => {
    try {
      setLoading(true);
      const data = await NovelsService.getNovels({ id: id! });
      setNovel(data);

      // 如果有分镜，加载分镜数据
      if (data.storyboardId) {
        const sb = await StoryboardsService.getStoryboards({ id: data.storyboardId });
        setStoryboard(sb);
      }
    } catch (err: any) {
      console.error('Failed to load novel:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!id) return;

    setAnalyzing(true);
    setError(null);

    try {
      const job = await NovelsService.postNovelsAnalyze({
        id,
        requestBody: {}
      });
      console.log('Analysis job started:', job);

      // 轮询任务进度
      const intervalId = setInterval(async () => {
        const jobStatus = await JobsService.getJobs({ id: job.jobId! });
        console.log('Job status:', jobStatus);

        if (jobStatus.status === 'completed') {
          clearInterval(intervalId);
          setAnalyzing(false);
          alert('分析完成!');
          await loadNovel();
        } else if (jobStatus.status === 'failed') {
          clearInterval(intervalId);
          setAnalyzing(false);
          setError(`分析失败: ${jobStatus.error}`);
        }
      }, 2000);

    } catch (err: any) {
      console.error('Analyze failed:', err);
      setError(err.message);
      setAnalyzing(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '20px' }}>加载中...</div>;
  }

  if (error && !novel) {
    return <div style={{ padding: '20px', color: 'red' }}>错误: {error}</div>;
  }

  if (!novel) {
    return <div style={{ padding: '20px' }}>作品不存在</div>;
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>{novel.title}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div style={{ padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>📊 基本信息</h3>
          <p><strong>ID:</strong> {novel.id}</p>
          <p><strong>状态:</strong> <span style={{
            padding: '4px 8px',
            borderRadius: '4px',
            backgroundColor: novel.status === 'completed' ? '#d4edda' : '#fff3cd',
            color: novel.status === 'completed' ? '#155724' : '#856404'
          }}>{novel.status}</span></p>
          <p><strong>类型:</strong> {novel.metadata?.genre || '未分类'}</p>
          <p><strong>创建时间:</strong> {new Date(novel.createdAt).toLocaleString('zh-CN')}</p>
        </div>

        <div style={{ padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>🎬 分镜信息</h3>
          {novel.storyboardId ? (
            <>
              <p><strong>分镜ID:</strong> {novel.storyboardId}</p>
              {storyboard && (
                <>
                  <p><strong>版本:</strong> {storyboard.version}</p>
                  <p><strong>总页数:</strong> {storyboard.totalPages}</p>
                  <p><strong>面板数:</strong> {storyboard.panelCount}</p>
                </>
              )}
            </>
          ) : (
            <p style={{ color: '#666' }}>尚未生成分镜</p>
          )}
        </div>
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

      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={handleAnalyze}
          disabled={analyzing || novel.status === 'analyzed' || novel.status === 'analyzing'}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            backgroundColor: analyzing ? '#ccc' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: analyzing ? 'not-allowed' : 'pointer',
            marginRight: '12px'
          }}
        >
          {analyzing ? '分析中...' : novel.status === 'analyzed' ? '已分析' : '开始分析'}
        </button>

        {novel.storyboardId && (
          <button
            onClick={() => alert(`分镜ID: ${novel.storyboardId}`)}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            查看分镜
          </button>
        )}
      </div>

      {storyboard && storyboard.panels && (
        <div>
          <h2>面板预览</h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '16px'
          }}>
            {storyboard.panels.slice(0, 6).map((panel) => (
              <div
                key={panel.id}
                style={{
                  padding: '12px',
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  backgroundColor: 'white'
                }}
              >
                <div style={{
                  width: '100%',
                  height: '120px',
                  backgroundColor: '#f0f0f0',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '8px',
                  color: '#999'
                }}>
                  {panel.images?.preview ? (
                    <img src={panel.images.preview} alt={`Panel ${panel.id}`} style={{ maxWidth: '100%', maxHeight: '100%' }} />
                  ) : (
                    '暂无图像'
                  )}
                </div>
                <p style={{ fontSize: '12px', margin: '4px 0' }}>
                  <strong>P{panel.page}-{panel.index}</strong>
                </p>
                <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>
                  {panel.content?.scene?.substring(0, 50)}...
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

