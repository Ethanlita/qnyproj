import { useCallback, useEffect, useState } from 'react';
import { NovelsService, StoryboardsService, JobsService } from '../api/generated';
import type { Novel, Storyboard, Panel as PanelModel } from '../api/generated';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useJobMonitor } from '../hooks/useJobMonitor';

type PanelCharacters = NonNullable<NonNullable<PanelModel['content']>['characters']>;

/**
 * 作品详情页
 */
export function NovelDetailPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const novelId = routeId || '';
  const [novel, setNovel] = useState<Novel | null>(null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generatingMode, setGeneratingMode] = useState<'preview' | 'hd'>('preview');
  const [panelError, setPanelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {
    jobState: panelJobState,
    start: startPanelJob,
    stop: stopPanelJob
  } = useJobMonitor({
    onCompleted: async () => {
      await loadNovel();
    },
    onFailed: async ({ error: jobError }) => {
      setPanelError(jobError || '任务失败');
    }
  });

  const loadNovel = useCallback(async () => {
    if (!novelId) return;
    try {
      setLoading(true);
      const data = await NovelsService.getNovels({ id: novelId });
      setNovel(data);

      if (data.storyboardId) {
        const sb = await StoryboardsService.getStoryboards({ id: data.storyboardId });
        setStoryboard(sb);
      } else {
        setStoryboard(null);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to load novel:', error);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    if (!novelId) {
      setNovel(null);
      setStoryboard(null);
      return;
    }
    void loadNovel();
  }, [novelId, loadNovel]);

  const handleAnalyze = async () => {
    if (!novelId) return;

    setAnalyzing(true);
    setError(null);

    try {
      const job = await NovelsService.postNovelsAnalyze({
        id: novelId,
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

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Analyze failed:', error);
      setError(message);
      setAnalyzing(false);
    }
  };

  const handleGeneratePanels = async () => {
    if (!storyboard) {
      alert('当前作品尚未生成分镜');
      return;
    }
    if (!storyboard.id) return;

    setPanelError(null);
    stopPanelJob();
    try {
      const response = await StoryboardsService.postStoryboardsGenerate({
        id: storyboard.id,
        mode: generatingMode
      });
      if (response.jobId) {
        startPanelJob(response.jobId);
      } else {
        setPanelError('未返回任务ID');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Generate panels failed:', error);
      setPanelError(message);
      alert(`面板生成失败：${message}`);
    }
  };

  if (loading) {
    return <div style={{ padding: '20px' }}>加载中...</div>;
  }

  if (error && !novel) {
    return <div style={{ padding: '20px', color: 'red' }}>错误: {error}</div>;
  }

  if (!novel) {
    return (
      <div style={{ padding: '20px' }}>
        <p>作品不存在或未指定 ID。</p>
        <button
          onClick={() => navigate('/')}
          style={{
            marginTop: '12px',
            padding: '10px 20px',
            backgroundColor: '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          返回首页
        </button>
      </div>
    );
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

      {storyboard && (
        <div style={{
          padding: '16px',
          borderRadius: '8px',
          border: '1px solid #e0e0e0',
          marginBottom: '20px',
          backgroundColor: '#fafafa'
        }}>
          <h3 style={{ marginTop: 0 }}>🖼️ 批量生成面板</h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            当前模式：{generatingMode === 'preview' ? '预览 (512×288)' : '高清 (1920×1080)'}
          </p>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={generatingMode}
              onChange={(e) => setGeneratingMode(e.target.value as 'preview' | 'hd')}
              style={{
                padding: '8px 12px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                fontSize: '14px'
              }}
              disabled={panelJobState.status === 'processing'}
            >
              <option value="preview">预览模式</option>
              <option value="hd">高清模式</option>
            </select>
            <button
              onClick={handleGeneratePanels}
              disabled={panelJobState.status === 'processing'}
              style={{
                padding: '10px 20px',
                backgroundColor: panelJobState.status === 'processing' ? '#ccc' : '#6f42c1',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: panelJobState.status === 'processing' ? 'not-allowed' : 'pointer'
              }}
            >
              {panelJobState.status === 'processing' ? '生成中...' : '开始生成面板'}
            </button>
            {panelJobState.status === 'processing' && panelJobState.jobId && (
              <span style={{ color: '#007bff', fontSize: '13px' }}>
                正在生成，Job ID: {panelJobState.jobId}
              </span>
            )}
            {panelError && (
              <span style={{ color: '#d9534f', fontSize: '13px' }}>
                生成失败：{panelError}
              </span>
            )}
            {panelJobState.status === 'completed' && (
              <span style={{ color: '#28a745', fontSize: '13px' }}>
                ✅ 面板生成完成，预览已刷新
              </span>
            )}
          </div>
        </div>
      )}

      {storyboard && storyboard.panels && (
        <div>
          <h2>面板预览</h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '16px'
          }}>
            {storyboard.panels.slice(0, 6).map((panel) => {
              const panelCharacters: PanelCharacters =
                panel.content?.characters && panel.content.characters.length > 0
                  ? panel.content.characters
                  : ((panel as unknown as { characters?: PanelCharacters }).characters ?? ([] as PanelCharacters));
              return (
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
                {panelCharacters.length > 0 && (
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {panelCharacters.map((character) => (
                      <Link
                        key={character?.charId || `${panel.id}-char`}
                        to={character?.charId ? `/characters/${character.charId}` : '#'}
                        style={{
                          fontSize: '11px',
                          backgroundColor: '#eef',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          textDecoration: 'none',
                          color: '#445'
                        }}
                      >
                        {character?.name || character?.charId || '角色'}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
