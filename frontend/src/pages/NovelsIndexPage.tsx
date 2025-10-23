import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NovelsService } from '../api/generated';
import type { Novel } from '../api/generated';
import styles from './NovelsIndexPage.module.css';

const STORAGE_KEY = 'qnyproj:recentNovels';

export function NovelsIndexPage() {
  const navigate = useNavigate();
  const [inputId, setInputId] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as string[];
    setRecent(stored);
    
    // 加载用户的作品列表
    loadNovels();
  }, []);

  const loadNovels = async () => {
    try {
      setLoading(true);
      const data = await NovelsService.getNovels({});
      setNovels(data.items || []);
    } catch (err) {
      console.error('Failed to load novels:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inputId.trim()) return;
    pushRecent(inputId.trim());
    navigate(`/novels/${encodeURIComponent(inputId.trim())}`);
  };

  const handleOpen = (novelId: string) => {
    pushRecent(novelId);
    navigate(`/novels/${encodeURIComponent(novelId)}`);
  };

  const pushRecent = (novelId: string) => {
    setRecent((prev) => {
      const next = [novelId, ...prev.filter((id) => id !== novelId)].slice(0, 6);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1>项目空间</h1>
        <p>
          在这里可以快速定位到某个作品的工作区，查看分镜、提交修改、发起高清生成，以及下载导出成果。
        </p>
      </section>

      <section className={styles.card}>
        <header>
          <h2>直接跳转到作品详情</h2>
          <span>输入作品 ID，或从最近访问中选择</span>
        </header>

        <form className={styles.searchBar} onSubmit={handleSubmit}>
          <div className={styles.inputGroup}>
            <label htmlFor="novelId">作品 ID</label>
            <input
              id="novelId"
              type="text"
              placeholder="例如：novel-001 或 UUID"
              value={inputId}
              onChange={(event) => setInputId(event.target.value)}
            />
          </div>
          <button type="submit">打开项目</button>
        </form>

        <div className={styles.actions}>
          <button type="button" onClick={() => navigate('/upload')}>
            新建 / 上传作品
          </button>
          <button type="button" onClick={() => navigate('/')}>
            查看仪表盘
          </button>
        </div>

        <div className={styles.recentSection}>
          <h3>最近访问</h3>
          {recent.length === 0 ? (
            <p className={styles.empty}>暂无记录，上传作品后会自动记录。</p>
          ) : (
            <ul className={styles.recentList}>
              {recent.map((novelId) => (
                <li key={novelId}>
                  <span>{novelId}</span>
                  <button type="button" onClick={() => handleOpen(novelId)}>
                    打开
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 作品列表 */}
        <div className={styles.novelsSection}>
          <h3>我的作品列表</h3>
          {loading ? (
            <p className={styles.empty}>加载中...</p>
          ) : novels.length === 0 ? (
            <p className={styles.empty}>还没有作品，<button type="button" onClick={() => navigate('/upload')} style={{ textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>创建第一个吧</button>！</p>
          ) : (
            <ul className={styles.novelsList}>
              {novels.map((novel) => (
                <li key={novel.id}>
                  <div>
                    <strong>{novel.title}</strong>
                    <span style={{ marginLeft: '8px', fontSize: '12px', color: '#999' }}>
                      {novel.metadata?.genre || ''}
                    </span>
                  </div>
                  <button type="button" onClick={() => handleOpen(novel.id!)}>
                    打开
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

export default NovelsIndexPage;
