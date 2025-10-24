import { useEffect, useMemo, useState } from 'react';
import { JobsService, type Job } from '../api/generated';
import styles from './DashboardPage.module.css';

type JobFilter = {
  type: 'all' | Job['type'];
  status: 'all' | Job['status'];
};

const PAGE_SIZE = 10;

export function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filters, setFilters] = useState<JobFilter>({ type: 'all', status: 'all' });
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMore = Boolean(cursor);

  useEffect(() => {
    void fetchJobs({ append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const stats = useMemo(() => {
    const total = jobs.length;
    const completed = jobs.filter((job) => job.status === 'completed').length;
    const running = jobs.filter((job) => job.status === 'in_progress').length;
    const failed = jobs.filter((job) => job.status === 'failed').length;
    return { total, completed, running, failed };
  }, [jobs]);

  const activeJobs = useMemo(() => jobs.filter((job) => job.status !== 'completed'), [jobs]);

  const fetchJobs = async ({ append }: { append: boolean }) => {
    try {
      setError(null);
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const response = await JobsService.listJobs({
        limit: PAGE_SIZE,
        lastKey: append ? cursor ?? undefined : undefined,
        type: filters.type === 'all' ? undefined : filters.type,
        status: filters.status === 'all' ? undefined : filters.status
      });

      const items = response.items ?? [];
      setJobs((prev) => (append ? [...prev, ...items] : items));
      setCursor(response.lastKey ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载任务失败';
      setError(message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (!cursor || loadingMore) return;
    void fetchJobs({ append: true });
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <h1>工作台</h1>
          <p>实时掌握小说转漫画链路的任务状态，查看修改闭环、高清批跑与导出中心的运行情况。</p>
        </div>
        <div className={styles.metrics}>
          <MetricCard label="任务总数" value={stats.total} tone="primary" />
          <MetricCard label="进行中" value={stats.running} tone="accent" />
          <MetricCard label="已完成" value={stats.completed} tone="success" />
          <MetricCard label="失败" value={stats.failed} tone="warning" />
        </div>
      </section>

      <section className={styles.controls}>
        <div className={styles.selectGroup}>
          <Select
            label="类型"
            value={filters.type}
            onChange={(value) => setFilters((prev) => ({ ...prev, type: value as JobFilter['type'] }))}
            options={jobTypeOptions}
          />
          <Select
            label="状态"
            value={filters.status}
            onChange={(value) => setFilters((prev) => ({ ...prev, status: value as JobFilter['status'] }))}
            options={jobStatusOptions}
          />
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => fetchJobs({ append: false })} disabled={loading}>
          {loading ? '刷新中…' : '刷新列表'}
        </button>
      </section>

      {error && (
        <div className={styles.errorBox}>
          <div>
            <strong>加载失败</strong>
            <p>{error}</p>
          </div>
          <button type="button" onClick={() => fetchJobs({ append: false })}>
            重试
          </button>
        </div>
      )}

      {!error && (
        <section className={styles.grid}>
          <article className={styles.card}>
            <header>
              <h2>任务总览</h2>
              <span>最新任务按时间排序</span>
            </header>
            {loading && jobs.length === 0 ? (
              <div className={styles.loadingState}>
                <span className={styles.spinner} aria-hidden />
                <p>正在加载任务列表…</p>
              </div>
            ) : jobs.length === 0 ? (
              <div className={styles.emptyState}>
                <p>暂时没有任务，去作品详情页尝试提交修改或生成面板吧。</p>
              </div>
            ) : (
              <>
                <ul className={styles.jobList}>
                  {jobs.map((job) => (
                    <li key={job.id}>
                      <div>
                        <div className={styles.jobHeader}>
                          <span className={`${styles.jobType} ${styles[`jobType-${job.type}`]}`}>{labelForJobType(job.type)}</span>
                          <code>#{job.id.slice(0, 8)}</code>
                        </div>
                        <div className={styles.jobMeta}>
                          <span>{statusLabel(job.status)}</span>
                          {job.progress?.percentage !== undefined && (
                            <span>{Math.round(job.progress.percentage)}%</span>
                          )}
                          {job.updatedAt && <span>{formatDate(job.updatedAt)}</span>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {hasMore && (
                  <div className={styles.loadMore}>
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className={styles.secondaryButton}
                    >
                      {loadingMore ? '加载中…' : '加载更多'}
                    </button>
                  </div>
                )}
              </>
            )}
          </article>

          <article className={styles.card}>
            <header>
              <h2>进行中的修改</h2>
              <span>CR / 导出 / 面板任务进展</span>
            </header>
            {activeJobs.length === 0 ? (
              <div className={styles.emptyState}>
                <p>暂无进行中的任务。</p>
              </div>
            ) : (
              <ul className={styles.timeline}>
                {activeJobs.map((job) => (
                  <li key={job.id}>
                    <div className={styles.timelineDot} />
                    <div>
                      <strong>{labelForJobType(job.type)}</strong>
                      <div className={styles.timelineMeta}>
                        <span>{statusLabel(job.status)}</span>
                        {job.progress?.percentage !== undefined && (
                          <span>{Math.round(job.progress.percentage)}%</span>
                        )}
                        {job.updatedAt && <span>{formatDate(job.updatedAt)}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <footer className={styles.cardFooter}>
              <p>
                所有任务均可在 <span>作品详情 → 修改请求 / 导出中心</span> 中触发，执行进度将在此同步更新。
              </p>
            </footer>
          </article>

          <article className={styles.cardGuide}>
            <header>
              <h2>操作指引</h2>
              <span>三步完成创作闭环</span>
            </header>
            <ol className={styles.actionList}>
              <li>
                <span>1</span>
                <div>
                  <strong>上传或选择作品</strong>
                  <p>在「项目空间」确认作品信息，确保已经生成分镜。</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>提交自然语言修改</strong>
                  <p>作品详情页 → 修改请求，输入自然语言即可触发 CR-DSL 解析。</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>高清生成与导出</strong>
                  <p>选择预览/高清模式生成面板，完成后在导出中心获取 PDF / Webtoon。</p>
                </div>
              </li>
            </ol>
          </article>
        </section>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: 'primary' | 'accent' | 'success' | 'warning';
}) {
  return (
    <div className={`${styles.metricCard} ${styles[`metric-${tone}`]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <label className={styles.select}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const jobTypeOptions: { label: string; value: string }[] = [
  { label: '全部类型', value: 'all' },
  { label: '分析小说', value: 'analyze' },
  { label: '面板预览', value: 'generate_preview' },
  { label: '面板高清', value: 'generate_hd' },
  { label: '修改请求', value: 'change_request' },
  { label: '面板编辑', value: 'panel_edit' },
  { label: '角色标准像', value: 'generate_portrait' },
  { label: '导出 PDF', value: 'export_pdf' },
  { label: '导出 Webtoon', value: 'export_webtoon' },
  { label: '导出资源包', value: 'export_resources' }
];

const jobStatusOptions: { label: string; value: string }[] = [
  { label: '全部状态', value: 'all' },
  { label: '排队中', value: 'pending' },
  { label: '进行中', value: 'in_progress' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' }
];

function labelForJobType(type?: string) {
  switch (type) {
    case 'generate_preview':
      return '面板预览生成';
    case 'generate_hd':
      return '面板高清生成';
    case 'generate_portrait':
      return '角色标准像';
    case 'change_request':
      return '修改请求执行';
    case 'panel_edit':
      return '面板编辑';
    case 'export_pdf':
      return '导出 PDF';
    case 'export_webtoon':
      return '导出 Webtoon';
    case 'export_resources':
      return '导出资源包';
    case 'analyze':
      return '分析小说';
    default:
      return type || '未知任务';
  }
}

function statusLabel(status?: string) {
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
      return status || '未知状态';
  }
}

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export default DashboardPage;
