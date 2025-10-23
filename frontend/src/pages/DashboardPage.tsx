import { useEffect, useMemo, useState } from 'react';
import { JobsService, type Job } from '../api/generated';
import styles from './DashboardPage.module.css';

type JobSummary = {
  id: string;
  status: string;
  type: string;
  updatedAt?: string;
  progress?: number;
};

export function DashboardPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedJobIds = JSON.parse(localStorage.getItem('qnyproj:recentJobs') || '[]') as string[];
    if (storedJobIds.length === 0) {
      return;
    }

    (async () => {
      try {
        const summaries = await Promise.all(
          storedJobIds.slice(0, 5).map(async (jobId) => {
            try {
              const job = await JobsService.getJobs({ id: jobId });
              return mapJob(job);
            } catch (err) {
              console.warn('[Dashboard] Failed to load job', jobId, err);
              return null;
            }
          })
        );

        setJobs(summaries.filter(Boolean) as JobSummary[]);
      } catch (err) {
        const message = err instanceof Error ? err.message : '加载任务失败';
        setError(message);
      }
    })();
  }, []);

  const activeJobs = useMemo(() => jobs.filter((job) => job.status !== 'completed'), [jobs]);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <h1>项目概览</h1>
          <p>
            跟踪小说转漫画流水线的最新进展。从生成面板、提交修改请求，到高清导出，一站式掌握 M4 关键指标。
          </p>
        </div>
        <div className={styles.heroHighlights}>
          <HighlightCard
            title="修改闭环"
            description="CR-DSL 解析、对白重写、布局调整已联通，开箱即用。"
            pill="Ready"
          />
          <HighlightCard
            title="高清批跑"
            description="支持 preview / hd 双模式选择，生成任务自动追踪。"
            pill="HD"
          />
          <HighlightCard
            title="导出中心"
            description="PDF · Webtoon · 资源包，统一出口管理，生成即得链接。"
            pill="Export"
          />
        </div>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <header>
            <h2>实时任务监控</h2>
            <span>最近 5 个任务</span>
          </header>
          {error && <div className={styles.errorBox}>⚠️ {error}</div>}
          {jobs.length === 0 && !error && (
            <div className={styles.emptyState}>
              <p>暂无任务，去上传作品或提交修改请求看看吧。</p>
            </div>
          )}
          {jobs.length > 0 && (
            <ul className={styles.jobList}>
              {jobs.map((job) => (
                <li key={job.id}>
                  <div>
                    <div className={styles.jobTitle}>
                      <span className={styles.jobType}>{labelForJobType(job.type)}</span>
                      <span className={styles.jobId}>#{job.id.slice(0, 8)}</span>
                    </div>
                    <div className={styles.jobMeta}>
                      <span>{statusLabel(job.status)}</span>
                      {job.progress !== undefined && <span>{job.progress}%</span>}
                      {job.updatedAt && <span>{formatDate(job.updatedAt)}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className={styles.card}>
          <header>
            <h2>进行中的修改</h2>
            <span>CR 执行状态</span>
          </header>
          {activeJobs.length === 0 ? (
            <div className={styles.emptyState}>
              <p>暂无进行中的任务。可在作品详情页提交修改请求。</p>
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
                      {job.progress !== undefined && <span>{job.progress}%</span>}
                      {job.updatedAt && <span>{formatDate(job.updatedAt)}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <footer className={styles.cardFooter}>
            <p>
              所有任务均可在 <span>作品详情 → 修改请求</span> 中触发，并自动写入本地最近任务记录。
            </p>
          </footer>
        </article>

        <article className={styles.card}>
          <header>
            <h2>M4 操作指引</h2>
            <span>三步完成修改闭环</span>
          </header>
          <ol className={styles.actionList}>
            <li>
              <span>1</span>
              <div>
                <strong>上传或选择作品</strong>
                <p>在「上传作品」或项目空间中选择目标小说，确保分镜已生成。</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>提交自然语言修改</strong>
                <p>作品详情页 → 修改请求，输入指令，即可触发 CR-DSL 解析与执行。</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>高清生成 + 导出</strong>
                <p>选择预览/高清模式生成面板，随后在导出中心输出 PDF / Webtoon。</p>
              </div>
            </li>
          </ol>
        </article>
      </section>
    </div>
  );
}

function HighlightCard({
  title,
  description,
  pill
}: {
  title: string;
  description: string;
  pill: string;
}) {
  return (
    <div className={styles.highlightCard}>
      <div className={styles.highlightPill}>{pill}</div>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function mapJob(job: Job): JobSummary {
  return {
    id: job.id,
    status: job.status || 'pending',
    type: job.type || 'unknown',
    updatedAt: job.updatedAt,
    progress: job.progress?.percentage
  };
}

function labelForJobType(type: string) {
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
    case 'export_webtoon':
    case 'export_resources':
      return '导出任务';
    default:
      return type;
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

function formatDate(value?: string) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default DashboardPage;
