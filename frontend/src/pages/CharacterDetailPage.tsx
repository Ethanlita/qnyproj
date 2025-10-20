import { useEffect, useState } from 'react';
import { CharactersService } from '../api/generated';
import type { Character, CharacterConfiguration } from '../api/generated';

/**
 * 角色详情页 - 管理角色的多个配置
 */
export function CharacterDetailPage() {
  const charId = 'char-001'; // Mock ID for testing
  const [character, setCharacter] = useState<Character | null>(null);
  const [configs, setConfigs] = useState<CharacterConfiguration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newConfigName, setNewConfigName] = useState('');
  const [newConfigDesc, setNewConfigDesc] = useState('');

  useEffect(() => {
    if (charId) {
      loadCharacter();
    }
  }, [charId]);

  const loadCharacter = async () => {
    try {
      setLoading(true);
      const data = await CharactersService.getCharacters({ charId: charId! });
      setCharacter(data);
      setConfigs(data.configurations || []);
    } catch (err: any) {
      console.error('Failed to load character:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateConfig = async () => {
    if (!newConfigName.trim()) {
      alert('请输入配置名称');
      return;
    }

    setCreating(true);
    try {
      const config = await CharactersService.postCharactersConfigurations({
        charId: charId!,
        requestBody: {
          name: newConfigName,
          description: newConfigDesc || '',
          tags: [],
          isDefault: configs.length === 0
        }
      });

      console.log('Created configuration:', config);
      setConfigs([...configs, config]);
      setNewConfigName('');
      setNewConfigDesc('');
      alert('配置创建成功!');

    } catch (err: any) {
      console.error('Create config failed:', err);
      alert(`创建失败: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleGeneratePortraits = async (configId: string) => {
    try {
      const result = await CharactersService.postCharactersConfigurationsPortraits({
        charId: charId!,
        configId
      });
      console.log('Portrait generation started:', result);
      alert(`标准像生成已开始! Job ID: ${result.jobId}`);
    } catch (err: any) {
      console.error('Generate portraits failed:', err);
      alert(`生成失败: ${err.message}`);
    }
  };

  if (loading) {
    return <div style={{ padding: '20px' }}>加载中...</div>;
  }

  if (error || !character) {
    return <div style={{ padding: '20px', color: 'red' }}>错误: {error || '角色不存在'}</div>;
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>👤 {character.name}</h1>

      <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
        <p><strong>角色类型:</strong> {character.role}</p>
        <p><strong>性别:</strong> {character.baseInfo?.gender}</p>
        <p><strong>年龄:</strong> {character.baseInfo?.age}</p>
        <p><strong>性格:</strong> {character.baseInfo?.personality?.join(', ')}</p>
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

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handleGeneratePortraits(config.id)}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  flex: 1
                }}
              >
                生成标准像
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
              >
                编辑
              </button>
            </div>
          </div>
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

