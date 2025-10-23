import { FormEvent, useEffect, useState } from 'react';
import { ExportsService, type Export } from '../api/generated';
import styles from './ExportsPage.module.css';

const STORAGE_KEY = 'qnyproj:recentExports';

export function ExportsPage() {
  const [inputId, setInputId] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [exportData, setExportData] = useState<Export | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as string[];
    setRecent(stored);
  }, []);

  const pushRecent = (exportId: string) => {
    setRecent((prev) => {
      const next = [exportId, ...prev.filter((id) => id !== exportId)].slice(0, 10);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleLoad = async (exportId: string) => {
    if (!exportId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await ExportsService.getExports({ id: exportId });
      setExportData(data);
      pushRecent(exportId);
    } catch (err) {
      const message = err instanceof Error ? err.message : '导出信息获取失败';
      setError(message);
      setExportData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleLoad(inputId.trim());
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>导出中心</h1>
        <p>
          查询导出结果、复制下载链接、追踪导出历史。支持 PDF、Webtoon 长图、资源包三种格式。
        </p>
      </header>

      <section className={styles.card}>
        <form className={styles.search} onSubmit={handleSubmit}>
          <label htmlFor="exportId">导出 ID</label>
          <div className={styles.searchRow}>
            <input
              id="exportId"
              type="text"
              placeholder="例如：export-1234"
              value={inputId}
              onChange={(event) => setInputId(event.target.value)}
            />
            <button type="submit" disabled={loading || !inputId}>
              {loading ? '查询中...' : '查询'}
            </button>
          </div>
        </form>

        {error && <div className={styles.errorBox}>⚠️ {error}</div>}

        {exportData && (
          <div className={styles.result}>
            <header>
              <h2>导出详情</h2>
              <span>#{exportData.id}</span>
            </header>
            <dl>
              <div>
                <dt>作品 ID</dt>
                <dd>{exportData.novelId}</dd>
              </div>
              <div>
                <dt>格式</dt>
                <dd>{formatLabel(exportData.format)}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{statusLabel(exportData.status)}</dd>
              </div>
              {exportData.fileSize !== undefined && (
                <div>
                  <dt>文件大小</dt>
                  <dd>{formatBytes(exportData.fileSize)}</dd>
                </div>
              )}
              <div>
                <dt>创建时间</dt>
                <dd>{formatDate(exportData.createdAt)}</dd>
              </div>
            </dl>

            {exportData.fileUrl ? (
              <a href={exportData.fileUrl} target="_blank" rel="noreferrer">
                打开下载链接
              </a>
            ) : (
              <p className={styles.tip}>文件链接暂不可用，请稍后刷新或重新生成导出。</p>
            )}
          </div>
        )}
      </section>

      <section className={styles.card}>
        <header>
          <h2>最近的导出记录</h2>
          <span>本地缓存，仅保存最近 10 项</span>
        </header>
        {recent.length === 0 ? (
          <div className={styles.empty}>暂无记录，完成导出后将自动显示。</div>
        ) : (
          <ul className={styles.list}>
            {recent.map((item) => (
              <li key={item}>
                <span>{item}</span>
                <button type="button" onClick={() => handleLoad(item)}>
                  查看
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatLabel(format: Export['format']) {
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

function statusLabel(status: Export['status']) {
  switch (status) {
    case 'pending':
      return '排队中';
  }
  switch (status) {
    case 'processing':
      return '生成中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

function formatDate(value?: string) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatBytes(size?: number) {
  if (!size || Number.isNaN(size)) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default ExportsPage;
