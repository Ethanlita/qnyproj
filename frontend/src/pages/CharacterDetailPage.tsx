import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CharactersService } from '../api/generated';
import type { Character, CharacterConfiguration } from '../api/generated';
import { useJobMonitor } from '../hooks/useJobMonitor';

interface ConfigurationCardProps {
  config: CharacterConfiguration;
  onRefresh: (configId: string) => Promise<void>;
  onUpload: (configId: string, files: FileList | null) => Promise<void>;
  onStartPortraitJob: (configId: string) => Promise<string | null>;
}

function ConfigurationCard(props: ConfigurationCardProps) {
  const { config, onRefresh, onUpload, onStartPortraitJob } = props;
  const [uploading, setUploading] = useState(false);
  const { jobState, start } = useJobMonitor({
    onCompleted: async () => {
      await onRefresh(config.id);
    },
    onFailed: async () => {
      // 失败时刷新一次，确保错误状态同步
      await onRefresh(config.id);
    }
  });

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      await onUpload(config.id, files);
      await onRefresh(config.id);
      alert('参考图上传成功');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CharacterDetail] Upload failed:', error);
      alert(`上传失败：${message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    const jobId = await onStartPortraitJob(config.id);
    if (jobId) {
      start(jobId);
    }
  };

  const jobStatusLabel = useMemo(() => {
    if (jobState.status === 'processing') {
      return `⏳ 生成中... Job ID: ${jobState.jobId}`;
    }
    if (jobState.status === 'completed') {
      return '✅ 生成完成，标准像已刷新';
    }
    if (jobState.status === 'failed') {
      return `❌ 生成失败：${jobState.error || '请稍后重试'}`;
    }
    return null;
  }, [jobState]);

  return (
    <div
      key={config.id}
      style={{
        padding: '16px',
        border: '1px solid #ddd',
        borderRadius: '8px',
        backgroundColor: 'white'
      }}
    >
      <h3 style={{ marginTop: 0 }}>
        {config.name}
        {config.isDefault && (
          <span style={{
            marginLeft: '8px',
            fontSize: '12px',
            padding: '2px 6px',
            backgroundColor: '#007bff',
            color: 'white',
            borderRadius: '3px'
          }}>
            默认
          </span>
        )}
      </h3>
      <p style={{ color: '#666', fontSize: '14px' }}>{config.description}</p>

      {config.tags && config.tags.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          {config.tags.map((tag, idx) => (
            <span
              key={idx}
              style={{
                display: 'inline-block',
                padding: '4px 8px',
                marginRight: '4px',
                marginBottom: '4px',
                fontSize: '12px',
                backgroundColor: '#e9ecef',
                borderRadius: '3px'
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div style={{ marginBottom: '12px' }}>
        <p style={{ fontSize: '13px', fontWeight: 'bold' }}>参考图: {config.referenceImages?.length || 0}</p>
        <p style={{ fontSize: '13px', fontWeight: 'bold' }}>标准像: {config.generatedPortraits?.length || 0}</p>
      </div>

      {config.referenceImages && config.referenceImages.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
          {config.referenceImages.map((ref, idx) => (
            <div key={idx} style={{ width: '72px', height: '72px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #eee' }}>
              <img
                src={ref.url}
                alt={ref.caption || `参考图 ${idx + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          ))}
        </div>
      )}

      {config.generatedPortraits && config.generatedPortraits.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
          {config.generatedPortraits.map((portrait, idx) => (
            <div key={idx} style={{ width: '80px', height: '80px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #ddd' }}>
              <img
                src={portrait.url}
                alt={`${config.name} ${portrait.view}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 16px',
            fontSize: '14px',
            backgroundColor: '#17a2b8',
            color: 'white',
            borderRadius: '4px',
            cursor: uploading ? 'not-allowed' : 'pointer',
            flex: 1,
            opacity: uploading ? 0.7 : 1
          }}
        >
          {uploading ? '上传中...' : '上传参考图'}
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            disabled={uploading}
            onChange={(e) => handleUpload(e.target.files)}
          />
        </label>
        <button
          onClick={handleGenerate}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: jobState.status === 'processing' ? 'not-allowed' : 'pointer',
            flex: 1
          }}
          disabled={jobState.status === 'processing'}
        >
          {jobState.status === 'processing' ? '生成中...' : '生成标准像'}
        </button>
        <button
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
          onClick={() => alert(`配置 ID: ${config.id}\n(编辑功能待实现)`)}
        >
          编辑
        </button>
      </div>

      {jobStatusLabel && (
        <p style={{ marginTop: '8px', color: jobState.status === 'failed' ? '#c00' : jobState.status === 'completed' ? '#28a745' : '#007bff', fontSize: '12px' }}>
          {jobStatusLabel}
        </p>
      )}
    </div>
  );
}

/**
 * 角色详情页 - 管理角色配置、参考图与标准像
 */
export function CharacterDetailPage() {
  const { charId: routeCharId } = useParams<{ charId: string }>();
  const charId = routeCharId || '';
  const [character, setCharacter] = useState<Character | null>(null);
  const [configs, setConfigs] = useState<CharacterConfiguration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newConfigName, setNewConfigName] = useState('');
  const [newConfigDesc, setNewConfigDesc] = useState('');

  const loadCharacter = useCallback(async () => {
    if (!charId) return;
    try {
      setLoading(true);
      const data = await CharactersService.getCharacters({ charId });
      setCharacter(data);
      setConfigs(data.configurations || []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CharacterDetail] Load failed:', error);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [charId]);

  useEffect(() => {
    if (!charId) {
      setCharacter(null);
      setConfigs([]);
      return;
    }
    void loadCharacter();
  }, [charId, loadCharacter]);

  const refreshConfig = useCallback(async (configId: string) => {
    if (!charId) return;
    try {
      const updated = await CharactersService.getCharactersConfigurations1({ charId, configId });
      setConfigs((prev) => prev.map((cfg) => (cfg.id === updated.id ? updated : cfg)));
    } catch (error) {
      console.error('[CharacterDetail] Refresh config failed:', error);
      await loadCharacter();
    }
  }, [charId, loadCharacter]);

  const handleCreateConfig = async () => {
    if (!charId) return;
    if (!newConfigName.trim()) {
      alert('请输入配置名称');
      return;
    }

    setCreating(true);
    try {
      const config = await CharactersService.postCharactersConfigurations({
        charId,
        requestBody: {
          name: newConfigName,
          description: newConfigDesc || '',
          tags: [],
          isDefault: configs.length === 0
        }
      });
      setConfigs((prev) => [...prev, config]);
      setNewConfigName('');
      setNewConfigDesc('');
      alert('配置创建成功!');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CharacterDetail] Create config failed:', error);
      alert(`创建失败: ${message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleUploadReferences = useCallback(async (configId: string, files: FileList | null) => {
    if (!charId || !files || files.length === 0) return;
    const limitedFiles = Array.from(files).slice(0, 10);
    await CharactersService.postCharactersConfigurationsRefs({
      charId,
      configId,
      formData: {
        images: limitedFiles
      }
    });
  }, [charId]);

  const startPortraitJob = useCallback(async (configId: string) => {
    if (!charId) return null;
    try {
      const result = await CharactersService.postCharactersConfigurationsPortraits({
        charId,
        configId
      });
      return result.jobId || null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CharacterDetail] Start portrait job failed:', error);
      alert(`生成失败: ${message}`);
      return null;
    }
  }, [charId]);

  if (!charId) {
    return <div style={{ padding: '20px' }}>未指定角色 ID，请通过角色列表进入。</div>;
  }

  if (loading) {
    return <div style={{ padding: '20px' }}>加载中...</div>;
  }

  if (error && !character) {
    return <div style={{ padding: '20px', color: 'red' }}>错误: {error}</div>;
  }

  if (!character) {
    return <div style={{ padding: '20px' }}>角色不存在</div>;
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>👤 {character.name}</h1>

      <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
        <p><strong>角色类型:</strong> {character.role}</p>
        <p><strong>性别:</strong> {character.baseInfo?.gender || '-'}</p>
        <p><strong>年龄:</strong> {character.baseInfo?.age ?? '-'}</p>
        <p><strong>性格:</strong> {character.baseInfo?.personality?.join(', ') || '-'}</p>
      </div>

      <h2>🎨 角色配置 ({configs.length})</h2>

      <div style={{ marginBottom: '20px', padding: '16px', border: '2px dashed #ccc', borderRadius: '8px' }}>
        <h3>创建新配置</h3>
        <input
          type="text"
          placeholder="配置名称 (如: 战斗模式)"
          value={newConfigName}
          onChange={(e) => setNewConfigName(e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            marginBottom: '12px',
            fontSize: '14px',
            border: '1px solid #ccc',
            borderRadius: '4px'
          }}
        />
        <textarea
          placeholder="配置描述 (如: 穿着银白色铠甲，手持魔法剑)"
          value={newConfigDesc}
          onChange={(e) => setNewConfigDesc(e.target.value)}
          rows={3}
          style={{
            width: '100%',
            padding: '10px',
            marginBottom: '12px',
            fontSize: '14px',
            border: '1px solid #ccc',
            borderRadius: '4px'
          }}
        />
        <button
          onClick={handleCreateConfig}
          disabled={creating}
          style={{
            padding: '10px 20px',
            backgroundColor: creating ? '#ccc' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: creating ? 'not-allowed' : 'pointer'
          }}
        >
          {creating ? '创建中...' : '+ 创建配置'}
        </button>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: '16px'
      }}>
        {configs.map((config) => (
          <ConfigurationCard
            key={config.id}
            config={config}
            onRefresh={refreshConfig}
            onUpload={handleUploadReferences}
            onStartPortraitJob={startPortraitJob}
          />
        ))}
      </div>

      {configs.length === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
          暂无配置，请创建第一个配置
        </div>
      )}
    </div>
  );
}
