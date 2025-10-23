import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  NovelsService,
  StoryboardsService,
  ChangeRequestsService,
  PanelsService,
  ExportsService,
  type Novel,
  type Storyboard,
  type Panel as PanelModel,
  type CRDSL,
  type Export
} from '../api/generated';
import { useNavigate, useParams } from 'react-router-dom';
import { useJobMonitor } from '../hooks/useJobMonitor';
import styles from './NovelDetailPage.module.css';

type PanelCharacters = NonNullable<NonNullable<PanelModel['content']>['characters']>;

type PanelForDisplay = PanelModel & {
  previewUrl?: string;
  hdUrl?: string;
};

const RECENT_NOVELS_KEY = 'qnyproj:recentNovels';
const RECENT_JOBS_KEY = 'qnyproj:recentJobs';
const RECENT_EXPORTS_KEY = 'qnyproj:recentExports';

type JobStateSnapshot = ReturnType<typeof useJobMonitor>['jobState'];

export function NovelDetailPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const novelId = routeId || '';

  const [novel, setNovel] = useState<Novel | null>(null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [panels, setPanels] = useState<PanelForDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [analysisPending, setAnalysisPending] = useState(false);
  const [generatingMode, setGeneratingMode] = useState<'preview' | 'hd'>('preview');
  const [panelError, setPanelError] = useState<string | null>(null);

  const [crInput, setCrInput] = useState('把第 1 页第 1 个面板中的主角表情改为微笑');
  const [crDsl, setCrDsl] = useState<CRDSL | null>(null);
  const [crJobId, setCrJobId] = useState<string | null>(null);
  const [crMessage, setCrMessage] = useState<string>('提交后会自动跟踪任务状态');

  const [exportFormat, setExportFormat] = useState<'pdf' | 'webtoon' | 'resources'>('pdf');
  const [exportInfo, setExportInfo] = useState<Export | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);

  const [editingPanel, setEditingPanel] = useState<PanelForDisplay | null>(null);
  const [editMode, setEditMode] = useState<'inpaint' | 'outpaint' | 'bg_swap'>('inpaint');
  const [editInstruction, setEditInstruction] = useState('调整角色表情为自信的微笑');
  const [maskDataUrl, setMaskDataUrl] = useState<string | undefined>();

  const {
    jobState: analyzeJobState,
    start: startAnalyzeJob
  } = useJobMonitor({
    onCompleted: async () => {
      setAnalysisPending(false);
      await loadNovel();
    },
    onFailed: async ({ error: jobError }) => {
      setAnalysisPending(false);
      setError(jobError || '分析失败');
    }
  });

  const {
    jobState: panelJobState,
    start: startPanelJob,
    stop: stopPanelJob
  } = useJobMonitor({
    onCompleted: async () => {
      await loadStoryboard();
      setPanelError(null);
    },
    onFailed: async ({ error: jobError }) => {
      setPanelError(jobError || '任务失败');
    }
  });

  const {
    jobState: crJobState,
    start: startCrJob,
    stop: stopCrJob
  } = useJobMonitor({
    onCompleted: async () => {
      setCrMessage('✅ 修改完成，面板已更新');
      await loadStoryboard();
    },
    onFailed: async ({ error: jobError }) => {
      setCrMessage(`❌ 修改失败：${jobError || '请查看 CloudWatch 日志'}`);
    }
  });

  const {
    jobState: exportJobState,
    start: startExportJob,
    stop: stopExportJob
  } = useJobMonitor({
    onCompleted: async (job) => {
      const exportId = (job.result as { exportId?: string })?.exportId;
      if (exportId) {
        const info = await fetchExport(exportId);
        if (info) {
          setExportInfo(info);
        }
        stashExport(exportId);
      }
    },
    onFailed: async ({ error: jobError }) => {
      setError(jobError || '导出失败');
    }
  });

  const {
    jobState: panelEditJobState,
    start: startPanelEditJob,
    stop: stopPanelEditJob
  } = useJobMonitor({
    onCompleted: async () => {
      await loadStoryboard();
      setEditingPanel(null);
      setMaskDataUrl(undefined);
    },
    onFailed: async ({ error: jobError }) => {
      alert(`编辑失败：${jobError || '请查看日志'}`);
    }
  });

  const loadNovel = useCallback(async () => {
    if (!novelId) {
      setNovel(null);
      setStoryboard(null);
      setPanels([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await NovelsService.getNovels({ id: novelId });
      setNovel(data);
      stashNovel(novelId);

      if (data.storyboardId) {
        const sb = await StoryboardsService.getStoryboards({ id: data.storyboardId });
        setStoryboard(sb);
        setPanels(transformPanels(sb.panels ?? []));
      } else {
        setStoryboard(null);
        setPanels([]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  const loadStoryboard = useCallback(async () => {
    if (!novel?.storyboardId) return;
    try {
      const sb = await StoryboardsService.getStoryboards({ id: novel.storyboardId });
      setStoryboard(sb);
      setPanels(transformPanels(sb.panels ?? []));
    } catch (err) {
      console.warn('[NovelDetail] Storyboard reload failed', err);
    }
  }, [novel?.storyboardId]);

  useEffect(() => {
    void loadNovel();
  }, [loadNovel]);

  const handleAnalyze = async () => {
    if (!novelId) return;
    setAnalysisPending(true);
    try {
      const job = await NovelsService.postNovelsAnalyze({ id: novelId, requestBody: {} });
      if (job.jobId) {
        stashJob(job.jobId);
        startAnalyzeJob(job.jobId);
      } else {
        setAnalysisPending(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setAnalysisPending(false);
    }
  };

  const handleGeneratePanels = async () => {
    if (!storyboard?.id) {
      alert('当前作品尚未生成分镜');
      return;
    }
    setPanelError(null);
    stopPanelJob();
    try {
      const response = await StoryboardsService.postStoryboardsGenerate({
        id: storyboard.id,
        mode: generatingMode
      });
      if (response.jobId) {
        stashJob(response.jobId);
        startPanelJob(response.jobId);
      } else {
        setPanelError('未返回任务ID');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPanelError(message);
    }
  };

  const handleSubmitCR = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!novelId) return;
    try {
      const response = await ChangeRequestsService.postChangeRequests({
        requestBody: {
          novelId,
          naturalLanguage: crInput
        }
      });
      setCrDsl(response.dsl ?? null);
      setCrMessage(response.message ?? '已提交修改请求');
      if (response.jobId) {
        setCrJobId(response.jobId);
        stashJob(response.jobId);
        stopCrJob();
        startCrJob(response.jobId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCrMessage(`提交失败：${message}`);
    }
  };

  const handleCreateExport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!novelId) return;
    stopExportJob();
    setExportInfo(null);
    try {
      const response = await ExportsService.postExports({
        requestBody: {
          novelId,
          format: exportFormat
        }
      });
      if (response.exportId) {
        setExportJobId(response.jobId ?? null);
        stashExport(response.exportId);
      }
      if (response.jobId) {
        stashJob(response.jobId);
        startExportJob(response.jobId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  const handleOpenPanelEdit = (panel: PanelForDisplay) => {
    setEditingPanel(panel);
    setEditMode('inpaint');
    setEditInstruction('调整角色表情为自信的微笑');
    setMaskDataUrl(undefined);
    stopPanelEditJob();
  };

  const handleMaskUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setMaskDataUrl(undefined);
      return;
    }
    const base64 = await fileToBase64(file);
    setMaskDataUrl(base64);
  };

  const handleSubmitPanelEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingPanel) return;
    try {
      const response = await PanelsService.postPanelsEdit({
        panelId: editingPanel.id,
        requestBody: {
          editMode,
          instruction: editInstruction,
          mask: maskDataUrl
        }
      });
      if (response.jobId) {
        stashJob(response.jobId);
        startPanelEditJob(response.jobId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`提交编辑失败：${message}`);
    }
  };

  const panelStatusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    panels.forEach((panel) => {
      const status = panel.status || 'pending';
      counts.set(status, (counts.get(status) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([status, count]) => ({ status, count }));
  }, [panels]);

  if (loading) {
    return <div className={styles.page}>加载中...</div>;
  }

  if (error && !novel) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBox}>错误：{error}</div>
        <button className={styles.primaryButton} onClick={() => navigate('/')}>返回首页</button>
      </div>
    );
  }

  if (!novel) {
    return (
      <div className={styles.page}>
        <p>作品不存在或未指定 ID。</p>
        <button className={styles.primaryButton} onClick={() => navigate('/')}>返回首页</button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.headerSection}>
        <div>
          <h1>{novel.title}</h1>
          <div className={styles.metaRow}>
            <StatusBadge status={novel.status || 'created'} />
            {novel.metadata?.genre && <span>类型：{novel.metadata.genre}</span>}
            <span>作品 ID：{novel.id}</span>
            {novel.storyboardId && <span>分镜：{novel.storyboardId}</span>}
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleAnalyze}
            disabled={analysisPending || analyzeJobState.status === 'processing'}
          >
            {analysisPending || analyzeJobState.status === 'processing' ? '分析中...' : '重新分析'}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => navigate('/exports')}
          >
            查看导出记录
          </button>
        </div>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <header>
            <h2>面板批量生成</h2>
            <span>支持预览 / 高清双模式</span>
          </header>
          <div className={styles.controlRow}>
            <label htmlFor="mode">生成模式</label>
            <select
              id="mode"
              value={generatingMode}
              onChange={(event) => setGeneratingMode(event.target.value as 'preview' | 'hd')}
            >
              <option value="preview">预览模式（512×288）</option>
              <option value="hd">高清模式（1920×1080）</option>
            </select>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleGeneratePanels}
              disabled={panelJobState.status === 'processing'}
            >
              {panelJobState.status === 'processing' ? '生成中...' : '开始生成'}
            </button>
          </div>
          {panelError && <div className={styles.errorBox}>⚠️ {panelError}</div>}
          <div className={styles.jobStatusRow}>
            <JobStatusLabel label="最近任务" jobState={panelJobState} jobIdHint={storyboard?.id} />
          </div>
          <div className={styles.badgeRow}>
            {panelStatusCounts.map(({ status, count }) => (
              <span key={status} className={styles.statusChip}>
                {statusLabel(status)} · {count}
              </span>
            ))}
            {panelStatusCounts.length === 0 && <span className={styles.statusChip}>暂无面板</span>}
          </div>
        </article>

        <article className={styles.card}>
          <header>
            <h2>自然语言修改请求</h2>
            <span>自动解析 CR-DSL 并执行修改闭环</span>
          </header>
          <form className={styles.crForm} onSubmit={handleSubmitCR}>
            <label htmlFor="cr-input">修改指令</label>
            <textarea
              id="cr-input"
              value={crInput}
              onChange={(event) => setCrInput(event.target.value)}
              rows={4}
              placeholder="例：把第 2 页第 1 个面板的背景换成夜晚城市"
            />
            <div className={styles.crActions}>
              <button type="submit" className={styles.primaryButton} disabled={crJobState.status === 'processing'}>
                {crJobState.status === 'processing' ? '执行中...' : '提交修改请求'}
              </button>
              <JobStatusLabel label="任务状态" jobState={crJobState} jobIdHint={crJobId ?? undefined} />
            </div>
            <p className={styles.crHint}>{crMessage}</p>
          </form>
          {crDsl && (
            <div className={styles.dslPreview}>
              <header>
                <strong>解析结果（CR-DSL）</strong>
              </header>
              <pre>{JSON.stringify(crDsl, null, 2)}</pre>
            </div>
          )}
        </article>

        <article className={styles.card}>
          <header>
            <h2>导出高清成品</h2>
            <span>PDF / Webtoon 长图 / 资源包</span>
          </header>
          <form className={styles.exportForm} onSubmit={handleCreateExport}>
            <label htmlFor="export-format">导出格式</label>
            <select
              id="export-format"
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value as 'pdf' | 'webtoon' | 'resources')}
            >
              <option value="pdf">PDF</option>
              <option value="webtoon">Webtoon 长图</option>
              <option value="resources">资源包（ZIP）</option>
            </select>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={exportJobState.status === 'processing'}
            >
              {exportJobState.status === 'processing' ? '导出中...' : '创建导出'}
            </button>
          </form>
          <JobStatusLabel label="导出任务" jobState={exportJobState} jobIdHint={exportJobId ?? undefined} />
          {exportInfo && (
            <div className={styles.exportResult}>
              <div>
                <span>格式</span>
                <strong>{formatExportLabel(exportInfo.format)}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong>{statusLabel(exportInfo.status)}</strong>
              </div>
              <div>
                <span>文件</span>
                {exportInfo.fileUrl ? (
                  <a href={exportInfo.fileUrl} target="_blank" rel="noreferrer">
                    打开下载链接 ↗
                  </a>
                ) : (
                  <strong>暂不可用</strong>
                )}
              </div>
            </div>
          )}
        </article>
      </section>

      <section className={styles.panelSection}>
        <header>
          <h2>面板预览</h2>
          <span>点击面板可打开编辑工具</span>
        </header>
        {panels.length === 0 ? (
          <div className={styles.empty}>暂无面板，先进行分析和生成吧。</div>
        ) : (
          <div className={styles.panelGrid}>
            {panels.map((panel) => (
              <button key={panel.id} className={styles.panelCard} type="button" onClick={() => handleOpenPanelEdit(panel)}>
                <div className={styles.panelImageWrap}>
                  {panel.previewUrl ? (
                    <img src={panel.previewUrl} alt={`Panel ${panel.id}`} />
                  ) : (
                    <span>暂无图像</span>
                  )}
                </div>
                <div className={styles.panelMeta}>
                  <strong>{`P${panel.page ?? '-'}-${panel.index ?? '-'}`}</strong>
                  <span>{panel.content?.scene?.slice(0, 48) || '未填写场景描述'}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {editingPanel && (
        <PanelEditSheet
          panel={editingPanel}
          editMode={editMode}
          onModeChange={setEditMode}
          instruction={editInstruction}
          onInstructionChange={setEditInstruction}
          maskDataUrl={maskDataUrl}
          onMaskUpload={handleMaskUpload}
          onClose={() => {
            setEditingPanel(null);
            stopPanelEditJob();
          }}
          onSubmit={handleSubmitPanelEdit}
          jobState={panelEditJobState}
        />
      )}
    </div>
  );
}

function transformPanels(panels: PanelModel[]): PanelForDisplay[] {
  return panels.map((panel) => ({
    ...panel,
    previewUrl: panel.images?.preview,
    hdUrl: panel.images?.hd
  }));
}

function StatusBadge({ status }: { status: string }) {
  return <span className={styles.statusBadge}>{statusLabel(status)}</span>;
}

function formatExportLabel(format: Export['format']) {
  switch (format) {
    case 'pdf':
      return 'PDF';
    case 'webtoon':
      return 'Webtoon 长图';
    case 'resources':
      return '资源包 (ZIP)';
    default:
      return format;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'in_progress':
      return '进行中';
    case 'pending':
      return '排队中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

function JobStatusLabel({
  label,
  jobState,
  jobIdHint
}: {
  label: string;
  jobState: JobStateSnapshot;
  jobIdHint?: string;
}) {
  const status = jobState.status;
  const text = (() => {
    switch (status) {
      case 'processing':
        return '进行中';
      case 'completed':
        return '已完成';
      case 'failed':
        return `失败：${'error' in jobState && jobState.error ? jobState.error : '未知错误'}`;
      default:
        return '就绪';
    }
  })();

  const jobId =
    jobState.status !== 'idle' && 'jobId' in jobState && jobState.jobId
      ? jobState.jobId
      : jobIdHint;

  return (
    <div className={styles.jobStatus}>
      <span>{label}</span>
      <strong>{text}</strong>
      {jobId && <code>Job #{jobId.slice(0, 8)}</code>}
    </div>
  );
}

function stashNovel(novelId: string) {
  stashIntoLocalStorage(RECENT_NOVELS_KEY, novelId, 10);
}

function stashJob(jobId: string) {
  stashIntoLocalStorage(RECENT_JOBS_KEY, jobId, 12);
}

function stashExport(exportId: string) {
  stashIntoLocalStorage(RECENT_EXPORTS_KEY, exportId, 12);
}

function stashIntoLocalStorage(key: string, value: string, limit: number) {
  const list = JSON.parse(localStorage.getItem(key) || '[]') as string[];
  const next = [value, ...list.filter((item) => item !== value)].slice(0, limit);
  localStorage.setItem(key, JSON.stringify(next));
}

async function fetchExport(exportId: string): Promise<Export | null> {
  try {
    const data = await ExportsService.getExports({ id: exportId });
    return data;
  } catch (err) {
    console.warn('[NovelDetail] 无法获取导出详情', err);
    return null;
  }
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

function PanelEditSheet({
  panel,
  editMode,
  onModeChange,
  instruction,
  onInstructionChange,
  maskDataUrl,
  onMaskUpload,
  onClose,
  onSubmit,
  jobState
}: {
  panel: PanelForDisplay;
  editMode: 'inpaint' | 'outpaint' | 'bg_swap';
  onModeChange: (mode: 'inpaint' | 'outpaint' | 'bg_swap') => void;
  instruction: string;
  onInstructionChange: (value: string) => void;
  maskDataUrl?: string;
  onMaskUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  jobState: JobStateSnapshot;
}) {
  return (
    <div className={styles.sheetOverlay}>
      <div className={styles.sheet}>
        <header>
          <div>
            <h3>面板编辑</h3>
            <span>{`Panel ${panel.id}`}</span>
          </div>
          <button type="button" onClick={onClose} className={styles.closeButton}>
            ×
          </button>
        </header>
        <div className={styles.sheetBody}>
          <div className={styles.sheetPreview}>
            {panel.previewUrl ? (
              <img src={panel.previewUrl} alt="Panel" />
            ) : (
              <div className={styles.empty}>暂无图像</div>
            )}
            <dl>
              <div>
                <dt>位置</dt>
                <dd>{`P${panel.page ?? '-'}-${panel.index ?? '-'}`}</dd>
              </div>
              <div>
                <dt>场景</dt>
                <dd>{panel.content?.scene || '未填写'}</dd>
              </div>
            </dl>
          </div>
          <form className={styles.editForm} onSubmit={onSubmit}>
            <label>编辑模式</label>
            <div className={styles.modeButtons}>
              {(['inpaint', 'outpaint', 'bg_swap'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onModeChange(mode)}
                  className={editMode === mode ? styles.modeButtonActive : styles.modeButton}
                >
                  {modeLabel(mode)}
                </button>
              ))}
            </div>
            <label htmlFor="instruction">编辑指令</label>
            <textarea
              id="instruction"
              value={instruction}
              onChange={(event) => onInstructionChange(event.target.value)}
              rows={3}
            />
            <label htmlFor="mask">遮罩（可选）</label>
            <input id="mask" type="file" accept="image/png,image/jpeg" onChange={onMaskUpload} />
            {maskDataUrl && <img src={maskDataUrl} alt="Mask" className={styles.maskPreview} />}
            <div className={styles.sheetActions}>
              <button type="submit" className={styles.primaryButton} disabled={jobState.status === 'processing'}>
                {jobState.status === 'processing' ? '提交中...' : '提交编辑'}
              </button>
              <JobStatusLabel label="编辑任务" jobState={jobState} />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function modeLabel(mode: 'inpaint' | 'outpaint' | 'bg_swap') {
  switch (mode) {
    case 'inpaint':
      return '局部重绘 (Inpaint)';
    case 'outpaint':
      return '扩展画面 (Outpaint)';
    case 'bg_swap':
      return '背景替换 (BG Swap)';
    default:
      return mode;
  }
}

export default NovelDetailPage;
