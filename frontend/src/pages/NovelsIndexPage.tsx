import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NovelsService, type Novel } from '../api/generated';
import styles from './NovelsIndexPage.module.css';

const PAGE_SIZE = 12;

export function NovelsIndexPage() {
  const navigate = useNavigate();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [jumpId, setJumpId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Novel['status']>('all');

  const hasMore = Boolean(cursor);

  useEffect(() => {
    void fetchNovels({ append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const groupedByStatus = useMemo(() => {
    const summary = new Map<NonNullable<Novel['status']>, number>();
    novels.forEach((novel) => {
      if (!novel.status) return;
      summary.set(novel.status, (summary.get(novel.status) || 0) + 1);
    });
    return Array.from(summary.entries()).map(([status, count]) => ({ status, count }));
  }, [novels]);

  const fetchNovels = async ({ append }: { append: boolean }) => {
    try {
      setError(null);
      if (append) {
        setIsLoadingMore(true);
      } else {
        setLoading(true);
      }

      const response = await NovelsService.listNovels({
        limit: PAGE_SIZE,
        lastKey: append ? cursor ?? undefined : undefined
      });

      const items = response.items ?? [];
      const filtered = statusFilter === 'all' ? items : items.filter((item) => item.status === statusFilter);

      setNovels((prev) => (append ? [...prev, ...filtered] : filtered));
      setCursor(response.lastKey ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取作品列表失败';
      setError(message);
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (!cursor || isLoadingMore) return;
    void fetchNovels({ append: true });
  };

  const handleJump = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!jumpId.trim()) return;
    navigate(`/novels/${encodeURIComponent(jumpId.trim())}`);
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <h1>作品空间</h1>
          <p>浏览并管理你创建的小说作品，支持快速跳转、状态筛选与分页加载。</p>
        </div>
        <div className={styles.heroActions}>
          <form className={styles.jumpForm} onSubmit={handleJump}>
            <label htmlFor="novel-id">作品 ID</label>
            <div>
              <input
                id="novel-id"
                type="text"
                value={jumpId}
                onChange={(event) => setJumpId(event.target.value)}
                placeholder="输入作品 ID，快速跳转"
              />
              <button type="submit">跳转</button>
            </div>
          </form>
          <button type="button" className={styles.primaryButton} onClick={() => navigate('/upload')}>
            创建新作品
          </button>
        </div>
      </section>

      <section className={styles.filterBar}>
        <div className={styles.chips}>
          <FilterChip
            label="全部"
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
          />
          {groupedByStatus.map(({ status, count }) => (
            <FilterChip
              key={status}
              label={`${statusLabel(status)} · ${count}`}
              active={statusFilter === status}
              onClick={() => setStatusFilter(status)}
            />
          ))}
        </div>
        <span className={styles.totalCount}>共 {novels.length} 条记录</span>
      </section>

      {error && (
        <div className={styles.errorBox}>
          <div>
            <strong>加载失败</strong>
            <p>{error}</p>
          </div>
          <button type="button" onClick={() => fetchNovels({ append: false })}>
            重试
          </button>
        </div>
      )}

      {!error && (
        <section className={styles.gridSection}>
          {loading && novels.length === 0 ? (
            <div className={styles.loadingState}>
              <span className={styles.spinner} aria-hidden />
              <p>正在获取作品列表…</p>
            </div>
          ) : novels.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyEmoji}>📖</span>
              <h2>还没有作品</h2>
              <p>创建第一个作品，开始你的漫画创作之旅吧。</p>
              <button type="button" onClick={() => navigate('/upload')}>
                新建作品
              </button>
            </div>
          ) : (
            <>
              <div className={styles.grid}>
                {novels.map((novel) => (
                  <article
                    key={novel.id}
                    className={styles.card}
                    onClick={() => navigate(`/novels/${novel.id}`)}
                  >
                    <header>
                      <h3>{novel.title}</h3>
                      <StatusBadge status={novel.status} />
                    </header>
                    <dl>
                      <div>
                        <dt>创建时间</dt>
                        <dd>{formatDate(novel.createdAt)}</dd>
                      </div>
                      {novel.metadata?.genre && (
                        <div>
                          <dt>类型</dt>
                          <dd>{novel.metadata.genre}</dd>
                        </div>
                      )}
                      {Array.isArray(novel.metadata?.tags) && novel.metadata!.tags!.length > 0 && (
                        <div>
                          <dt>标签</dt>
                          <dd>{novel.metadata!.tags!.slice(0, 3).join('、')}</dd>
                        </div>
                      )}
                    </dl>
                    <footer>
                      <span>作品 ID</span>
                      <code>{novel.id}</code>
                    </footer>
                  </article>
                ))}
              </div>
              {hasMore && (
                <div className={styles.loadMore}>
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className={styles.secondaryButton}
                  >
                    {isLoadingMore ? '加载中…' : '加载更多'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function statusLabel(status?: string) {
  switch (status) {
    case 'analyzed':
      return '已分析';
    case 'analyzing':
      return '分析中';
    case 'generating':
      return '生成中';
    case 'completed':
      return '已完成';
    case 'created':
      return '已创建';
    case 'error':
      return '错误';
    default:
      return status || '未知';
  }
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function FilterChip({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? styles.chipActive : styles.chip}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status?: string }) {
  return <span className={`${styles.statusBadge} ${styles[`status-${status ?? 'created'}`]}`}>{statusLabel(status)}</span>;
}

export default NovelsIndexPage;
