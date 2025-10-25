import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  NovelsService,
  StoryboardsService,
  ChangeRequestsService,
  PanelsService,
  ExportsService,
  BibleService,
  BibleUploadRequest,
  type Novel,
  type Storyboard,
  type Panel as PanelModel,
  type CRDSL,
  type Export,
  type Bible,
  type BibleCharacter,
  type BibleScene,
  BibleReferenceImage
} from '../api/generated';
import { useNavigate, useParams } from 'react-router-dom';
import { useJobMonitor } from '../hooks/useJobMonitor';
import styles from './NovelDetailPage.module.css';

type PanelForDisplay = PanelModel & {
  previewUrl?: string;
  hdUrl?: string;
  status?: string;
};

type CharacterDraft = {
  name: string;
  role: BibleCharacter['role'];
  gender: string;
  age: string;
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  build: string;
  clothing: string;
  distinctive: string;
  personality: string;
};

type SceneDraft = {
  id: string;
  name: string;
  description: string;
  architecture: string;
  colorScheme: string;
  landmarks: string;
  layout: string;
  atmosphere: string;
};

type PanelTextDraft = {
  id: string;
  scene: string;
  shotType: string;
  cameraAngle: string;
  visualPrompt: string;
  charactersText: string;
  dialogueText: string;
  originalCharacters?: PanelModel['characters'];
  originalDialogue?: PanelModel['dialogue'];
};

const SHOT_OPTIONS = [
  { value: '', label: '自动' },
  { value: 'close-up', label: '特写 (Close-Up)' },
  { value: 'medium', label: '中景 (Medium)' },
  { value: 'wide', label: '大全景 (Wide)' },
  { value: 'extreme-wide', label: '远景 (Extreme Wide)' }
];

const CAMERA_OPTIONS = [
  { value: '', label: '自动' },
  { value: 'eye-level', label: '平视 Eye-level' },
  { value: 'high-angle', label: '俯视 High-angle' },
  { value: 'low-angle', label: '仰视 Low-angle' },
  { value: 'birds-eye', label: '俯瞰 Bird\'s-eye' },
  { value: 'worms-eye', label: '仰视极端 Worm\'s-eye' },
  { value: 'dutch-angle', label: '倾斜 Dutch-angle' }
];

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
  const [activePanelTextId, setActivePanelTextId] = useState<string | null>(null);
  const [panelTextDraft, setPanelTextDraft] = useState<PanelTextDraft | null>(null);
  const [savingPanelTextId, setSavingPanelTextId] = useState<string | null>(null);

  const [bible, setBible] = useState<Bible | null>(null);
  const [bibleLoading, setBibleLoading] = useState(false);
  const [bibleError, setBibleError] = useState<string | null>(null);
  const [activeCharacterName, setActiveCharacterName] = useState<string | null>(null);
  const [characterDraft, setCharacterDraft] = useState<CharacterDraft | null>(null);
  const [savingCharacter, setSavingCharacter] = useState<string | null>(null);
  const [uploadingCharacter, setUploadingCharacter] = useState<string | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [sceneDraft, setSceneDraft] = useState<SceneDraft | null>(null);
  const [savingScene, setSavingScene] = useState<string | null>(null);
  const [uploadingScene, setUploadingScene] = useState<string | null>(null);

  const {
    jobState: analyzeJobState,
    start: startAnalyzeJob
  } = useJobMonitor({
    onCompleted: async () => {
      setAnalysisPending(false);
      await loadNovel();
      await loadBible();
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
  const loadBible = useCallback(async () => {
    if (!novelId) {
      setBible(null);
      return;
    }
    try {
      setBibleLoading(true);
      setBibleError(null);
      const data = await BibleService.getNovelsBible({ id: novelId });
      setBible(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBibleError(message);
    } finally {
      setBibleLoading(false);
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

  useEffect(() => {
    if (!editingPanel) return;
    const latest = panels.find((panel) => panel.id === editingPanel.id);
    if (latest && latest !== editingPanel) {
      setEditingPanel(latest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, editingPanel?.id]);

  useEffect(() => {
    void loadBible();
  }, [loadBible]);

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

  const toggleCharacterEditor = (character: BibleCharacter) => {
    if (activeCharacterName === character.name) {
      setActiveCharacterName(null);
      setCharacterDraft(null);
      return;
    }
    setActiveCharacterName(character.name);
    setCharacterDraft({
      name: character.name,
      role: character.role,
      gender: character.appearance?.gender || '',
      age: character.appearance?.age ? String(character.appearance.age) : '',
      hairColor: character.appearance?.hairColor || '',
      hairStyle: character.appearance?.hairStyle || '',
      eyeColor: character.appearance?.eyeColor || '',
      build: character.appearance?.build || '',
      clothing: (character.appearance?.clothing || []).join('、'),
      distinctive: (character.appearance?.distinctiveFeatures || []).join('、'),
      personality: (character.personality || []).join('、')
    });
  };

  const toggleSceneEditor = (scene: BibleScene) => {
    if (activeSceneId === scene.id) {
      setActiveSceneId(null);
      setSceneDraft(null);
      return;
    }
    setActiveSceneId(scene.id);
    setSceneDraft({
      id: scene.id,
      name: scene.name,
      description: scene.description,
      architecture: scene.visualCharacteristics?.architecture || '',
      colorScheme: scene.visualCharacteristics?.colorScheme || '',
      landmarks: (scene.visualCharacteristics?.keyLandmarks || []).join('、'),
      layout: scene.spatialLayout?.layout || '',
      atmosphere: scene.visualCharacteristics?.atmosphere || ''
    });
  };

  const handleCharacterDraftChange = (field: keyof CharacterDraft, value: string) => {
    setCharacterDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSceneDraftChange = (field: keyof SceneDraft, value: string) => {
    setSceneDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSaveCharacterDraft = async () => {
    if (!novelId || !characterDraft) return;
    try {
      setSavingCharacter(characterDraft.name);
      const parsedAge = Number(characterDraft.age);
      await BibleService.patchNovelsBibleCharacters({
        id: novelId,
        characterName: characterDraft.name,
        requestBody: {
          role: characterDraft.role,
          appearance: {
            gender: characterDraft.gender || undefined,
            age: Number.isFinite(parsedAge) ? parsedAge : undefined,
            hairColor: characterDraft.hairColor || undefined,
            hairStyle: characterDraft.hairStyle || undefined,
            eyeColor: characterDraft.eyeColor || undefined,
          build: characterDraft.build || undefined,
          clothing: splitList(characterDraft.clothing),
          distinctiveFeatures: splitList(characterDraft.distinctive)
        },
          personality: splitList(characterDraft.personality)
        }
      });
      await loadBible();
      setActiveCharacterName(null);
      setCharacterDraft(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSavingCharacter(null);
    }
  };

  const handleSaveSceneDraft = async () => {
    if (!novelId || !sceneDraft) return;
    try {
      setSavingScene(sceneDraft.id);
      await BibleService.patchNovelsBibleScenes({
        id: novelId,
        sceneId: sceneDraft.id,
        requestBody: {
          name: sceneDraft.name,
          description: sceneDraft.description,
          visualCharacteristics: {
            architecture: sceneDraft.architecture || undefined,
            colorScheme: sceneDraft.colorScheme || undefined,
            keyLandmarks: splitList(sceneDraft.landmarks),
            atmosphere: sceneDraft.atmosphere || undefined
          },
          spatialLayout: {
            layout: sceneDraft.layout || undefined
          }
        }
      });
      await loadBible();
      setActiveSceneId(null);
      setSceneDraft(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSavingScene(null);
    }
  };

  const handleCharacterFileChange = async (
    character: BibleCharacter,
    event: ChangeEvent<HTMLInputElement>
  ) => {
    if (!novelId) return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setUploadingCharacter(character.name);
      const upload = await BibleService.postNovelsBibleUploads({
        id: novelId,
        requestBody: {
          filename: file.name,
          contentType: file.type || 'image/png',
          scope: BibleUploadRequest.scope.CHARACTER,
          target: character.name
        }
      });
      const response = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'image/png'
        },
        body: file
      });
      if (!response.ok) {
        throw new Error('上传参考图失败');
      }
      const newImage: BibleReferenceImage = {
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tmp-${Date.now()}`,
        s3Key: upload.fileKey,
        label: file.name,
        source: BibleReferenceImage.source.USER,
        uploadedAt: new Date().toISOString()
      };
      const nextImages = serializeReferenceImages([
        ...(character.referenceImages || []),
        newImage
      ]);
      await BibleService.patchNovelsBibleCharacters({
        id: novelId,
        characterName: character.name,
        requestBody: { referenceImages: nextImages }
      });
      await loadBible();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setUploadingCharacter(null);
    }
  };

  const handleSceneFileChange = async (scene: BibleScene, event: ChangeEvent<HTMLInputElement>) => {
    if (!novelId) return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setUploadingScene(scene.id);
      const upload = await BibleService.postNovelsBibleUploads({
        id: novelId,
        requestBody: {
          filename: file.name,
          contentType: file.type || 'image/png',
          scope: BibleUploadRequest.scope.SCENE,
          target: scene.id
        }
      });
      const response = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'image/png'
        },
        body: file
      });
      if (!response.ok) {
        throw new Error('上传参考图失败');
      }
      const newImage: BibleReferenceImage = {
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tmp-${Date.now()}`,
        s3Key: upload.fileKey,
        label: file.name,
        source: BibleReferenceImage.source.USER,
        uploadedAt: new Date().toISOString()
      };
      const nextImages = serializeReferenceImages([
        ...(scene.referenceImages || []),
        newImage
      ]);
      await BibleService.patchNovelsBibleScenes({
        id: novelId,
        sceneId: scene.id,
        requestBody: { referenceImages: nextImages }
      });
      await loadBible();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setUploadingScene(null);
    }
  };

  const handleRemoveCharacterReference = async (character: BibleCharacter, image: BibleReferenceImage) => {
    if (!novelId) return;
    if (!window.confirm('确定要删除这张参考图吗？')) {
      return;
    }
    try {
      const nextImages = serializeReferenceImages(
        (character.referenceImages || []).filter((item) => item.id !== image.id)
      );
      await BibleService.patchNovelsBibleCharacters({
        id: novelId,
        characterName: character.name,
        requestBody: { referenceImages: nextImages }
      });
      await loadBible();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  const handleRemoveSceneReference = async (scene: BibleScene, image: BibleReferenceImage) => {
    if (!novelId) return;
    if (!window.confirm('确定要删除这张参考图吗？')) {
      return;
    }
    try {
      const nextImages = serializeReferenceImages(
        (scene.referenceImages || []).filter((item) => item.id !== image.id)
      );
      await BibleService.patchNovelsBibleScenes({
        id: novelId,
        sceneId: scene.id,
        requestBody: { referenceImages: nextImages }
      });
      await loadBible();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  const openPanelTextEditor = (panel: PanelForDisplay) => {
    if (activePanelTextId === panel.id) {
      setActivePanelTextId(null);
      setPanelTextDraft(null);
      return;
    }
    const rawCharacters =
      (panel.characters as PanelModel['characters']) ||
      ((panel as Record<string, any>).content?.characters as PanelModel['characters']) ||
      [];
    const rawDialogue =
      (panel.dialogue as PanelModel['dialogue']) ||
      ((panel as Record<string, any>).content?.dialogue as PanelModel['dialogue']) ||
      [];
    const charactersText = formatCharactersText(rawCharacters);
    const dialogueText = formatDialogueText(rawDialogue);
    setPanelTextDraft({
      id: panel.id,
      scene: panel.scene || (panel as Record<string, any>).content?.scene || '',
      shotType: panel.shotType || '',
      cameraAngle: (panel as Record<string, any>).cameraAngle || '',
      visualPrompt: panel.visualPrompt || '',
      charactersText,
      dialogueText,
      originalCharacters: rawCharacters,
      originalDialogue: rawDialogue
    });
    setActivePanelTextId(panel.id);
  };

  const handlePanelTextDraftChange = (field: keyof PanelTextDraft, value: string) => {
    setPanelTextDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSavePanelText = async () => {
    if (!panelTextDraft) return;
    try {
      setSavingPanelTextId(panelTextDraft.id);
      const payload = {
        scene: panelTextDraft.scene,
        shotType: panelTextDraft.shotType || undefined,
        cameraAngle: panelTextDraft.cameraAngle || undefined,
        visualPrompt: panelTextDraft.visualPrompt || undefined,
        characters: parseCharactersText(panelTextDraft.charactersText, panelTextDraft.originalCharacters),
        dialogue: parseDialogueText(panelTextDraft.dialogueText, panelTextDraft.originalDialogue)
      };
      await PanelsService.patchPanels({
        panelId: panelTextDraft.id,
        requestBody: payload
      });
      await loadStoryboard();
      setActivePanelTextId(null);
      setPanelTextDraft(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSavingPanelTextId(null);
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
          <div className={styles.fieldGroup}>
            <label htmlFor="mode" className={styles.fieldLabel}>生成模式</label>
            <select
              id="mode"
              value={generatingMode}
              onChange={(event) => setGeneratingMode(event.target.value as 'preview' | 'hd')}
            >
              <option value="preview">预览模式（512×288）</option>
              <option value="hd">高清模式（1920×1080）</option>
            </select>
          </div>
          <div className={styles.cardActions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleGeneratePanels}
              disabled={panelJobState.status === 'processing'}
            >
              {panelJobState.status === 'processing' ? '生成中...' : '开始生成'}
            </button>
            <JobStatusLabel label="最近任务" jobState={panelJobState} jobIdHint={storyboard?.id} />
          </div>
          {panelError && <div className={styles.errorBox}>⚠️ {panelError}</div>}
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
            <div className={styles.fieldGroup}>
              <label htmlFor="cr-input" className={styles.fieldLabel}>修改指令</label>
              <textarea
                id="cr-input"
                value={crInput}
                onChange={(event) => setCrInput(event.target.value)}
                rows={4}
                placeholder="例：把第 2 页第 1 个面板的背景换成夜晚城市"
              />
            </div>
            <div className={styles.cardActions}>
              <button type="submit" className={styles.primaryButton} disabled={crJobState.status === 'processing'}>
                {crJobState.status === 'processing' ? '执行中...' : '提交修改请求'}
              </button>
              <JobStatusLabel label="任务状态" jobState={crJobState} jobIdHint={crJobId ?? undefined} />
            </div>
            <p className={styles.helperText}>{crMessage}</p>
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
            <div className={styles.fieldGroup}>
              <label htmlFor="export-format" className={styles.fieldLabel}>导出格式</label>
              <select
                id="export-format"
                value={exportFormat}
                onChange={(event) => setExportFormat(event.target.value as 'pdf' | 'webtoon' | 'resources')}
              >
                <option value="pdf">PDF</option>
                <option value="webtoon">Webtoon 长图</option>
                <option value="resources">资源包（ZIP）</option>
              </select>
            </div>
            <div className={styles.cardActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={exportJobState.status === 'processing'}
              >
                {exportJobState.status === 'processing' ? '导出中...' : '创建导出'}
              </button>
              <JobStatusLabel label="导出任务" jobState={exportJobState} jobIdHint={exportJobId ?? undefined} />
            </div>
          </form>
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

      <section className={styles.bibleSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>圣经总览</h2>
            {bible && <span>版本 #{bible.version}</span>}
          </div>
          <div className={styles.cardActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void loadBible()}
              disabled={bibleLoading}
            >
              {bibleLoading ? '刷新中...' : '刷新圣经'}
            </button>
          </div>
        </div>
        {bibleError && <div className={styles.errorBox}>⚠️ {bibleError}</div>}
        <div className={styles.bibleGrid}>
          <article className={styles.card}>
            <header>
              <h3>角色圣经</h3>
              <span>{bible?.characters?.length ?? 0} 个角色</span>
            </header>
            {bibleLoading ? (
              <p>加载中...</p>
            ) : bible?.characters && bible.characters.length > 0 ? (
              <div className={styles.bibleList}>
                {bible.characters.map((character) => (
                  <div key={character.name} className={styles.bibleCard}>
                    <div className={styles.bibleCardHeader}>
                      <div>
                        <strong>{character.name}</strong>
                        <span>{character.role}</span>
                      </div>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => toggleCharacterEditor(character)}
                      >
                        {activeCharacterName === character.name ? '收起' : '编辑'}
                      </button>
                    </div>
                    <p className={styles.helperText}>外观：{formatAppearanceSummary(character.appearance)}</p>
                    <p className={styles.helperText}>
                      个性：{character.personality && character.personality.length > 0 ? character.personality.join('、') : '未填写'}
                    </p>
                    <div className={styles.referenceGallery}>
                      {(character.referenceImages || []).map((image) => (
                        <figure key={image.id} className={styles.referenceItem}>
                          {image.url ? (
                            <img src={image.url} alt={image.label || character.name} />
                          ) : (
                            <div className={styles.referencePlaceholder}>暂无预览</div>
                          )}
                          <figcaption>
                            <span>{image.label || '参考图'}</span>
                            <button
                              type="button"
                              className={styles.linkButton}
                              onClick={() => handleRemoveCharacterReference(character, image)}
                            >
                              删除
                            </button>
                          </figcaption>
                        </figure>
                      ))}
                      <label className={styles.uploadButton}>
                        <span>{uploadingCharacter === character.name ? '上传中...' : '上传参考图'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(event) => void handleCharacterFileChange(character, event)}
                          disabled={uploadingCharacter === character.name}
                        />
                      </label>
                    </div>
                    {activeCharacterName === character.name && characterDraft && (
                      <form
                        className={styles.bibleForm}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleSaveCharacterDraft();
                        }}
                      >
                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>角色定位</label>
                          <select
                            value={characterDraft.role}
                            onChange={(event) =>
                              setCharacterDraft((prev) =>
                                prev ? { ...prev, role: event.target.value as BibleCharacter['role'] } : prev
                              )
                            }
                          >
                            <option value="protagonist">主角</option>
                            <option value="antagonist">反派</option>
                            <option value="supporting">配角</option>
                            <option value="background">背景</option>
                          </select>
                        </div>
                        <div className={styles.bibleFormGrid}>
                          <label>
                            性别
                            <input
                              type="text"
                              value={characterDraft.gender}
                              onChange={(event) => handleCharacterDraftChange('gender', event.target.value)}
                            />
                          </label>
                          <label>
                            年龄
                            <input
                              type="text"
                              value={characterDraft.age}
                              onChange={(event) => handleCharacterDraftChange('age', event.target.value)}
                            />
                          </label>
                          <label>
                            眼睛颜色
                            <input
                              type="text"
                              value={characterDraft.eyeColor}
                              onChange={(event) => handleCharacterDraftChange('eyeColor', event.target.value)}
                            />
                          </label>
                          <label>
                            体型
                            <input
                              type="text"
                              value={characterDraft.build}
                              onChange={(event) => handleCharacterDraftChange('build', event.target.value)}
                            />
                          </label>
                        </div>
                        <div className={styles.bibleFormGrid}>
                          <label>
                            发色
                            <input
                              type="text"
                              value={characterDraft.hairColor}
                              onChange={(event) => handleCharacterDraftChange('hairColor', event.target.value)}
                            />
                          </label>
                          <label>
                            发型
                            <input
                              type="text"
                              value={characterDraft.hairStyle}
                              onChange={(event) => handleCharacterDraftChange('hairStyle', event.target.value)}
                            />
                          </label>
                        </div>
                        <label>
                          服饰（使用 、 分隔）
                          <input
                            type="text"
                            value={characterDraft.clothing}
                            onChange={(event) => handleCharacterDraftChange('clothing', event.target.value)}
                          />
                        </label>
                        <label>
                          明显特征
                          <input
                            type="text"
                            value={characterDraft.distinctive}
                            onChange={(event) => handleCharacterDraftChange('distinctive', event.target.value)}
                          />
                        </label>
                        <label>
                          个性标签
                          <input
                            type="text"
                            value={characterDraft.personality}
                            onChange={(event) => handleCharacterDraftChange('personality', event.target.value)}
                          />
                        </label>
                        <div className={styles.cardActions}>
                          <button type="submit" className={styles.primaryButton} disabled={savingCharacter === characterDraft.name}>
                            {savingCharacter === characterDraft.name ? '保存中...' : '保存修改'}
                          </button>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => {
                              setActiveCharacterName(null);
                              setCharacterDraft(null);
                            }}
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.helperText}>暂无角色数据，先运行一次分析吧。</p>
            )}
          </article>
          <article className={styles.card}>
            <header>
              <h3>场景圣经</h3>
              <span>{bible?.scenes?.length ?? 0} 个场景</span>
            </header>
            {bibleLoading ? (
              <p>加载中...</p>
            ) : bible?.scenes && bible.scenes.length > 0 ? (
              <div className={styles.bibleList}>
                {bible.scenes.map((scene) => (
                  <div key={scene.id} className={styles.bibleCard}>
                    <div className={styles.bibleCardHeader}>
                      <div>
                        <strong>{scene.name}</strong>
                        <span>{scene.id}</span>
                      </div>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => toggleSceneEditor(scene)}
                      >
                        {activeSceneId === scene.id ? '收起' : '编辑'}
                      </button>
                    </div>
                    <p className={styles.helperText}>类型：{scene.type}</p>
                    <p className={styles.helperText}>概述：{formatSceneSummary(scene)}</p>
                    <div className={styles.referenceGallery}>
                      {(scene.referenceImages || []).map((image) => (
                        <figure key={image.id} className={styles.referenceItem}>
                          {image.url ? (
                            <img src={image.url} alt={image.label || scene.name} />
                          ) : (
                            <div className={styles.referencePlaceholder}>暂无预览</div>
                          )}
                          <figcaption>
                            <span>{image.label || '参考图'}</span>
                            <button
                              type="button"
                              className={styles.linkButton}
                              onClick={() => handleRemoveSceneReference(scene, image)}
                            >
                              删除
                            </button>
                          </figcaption>
                        </figure>
                      ))}
                      <label className={styles.uploadButton}>
                        <span>{uploadingScene === scene.id ? '上传中...' : '上传参考图'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(event) => void handleSceneFileChange(scene, event)}
                          disabled={uploadingScene === scene.id}
                        />
                      </label>
                    </div>
                    {activeSceneId === scene.id && sceneDraft && (
                      <form
                        className={styles.bibleForm}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleSaveSceneDraft();
                        }}
                      >
                        <label>
                          场景名称
                          <input
                            type="text"
                            value={sceneDraft.name}
                            onChange={(event) => handleSceneDraftChange('name', event.target.value)}
                          />
                        </label>
                        <label>
                          场景描述
                          <textarea
                            value={sceneDraft.description}
                            onChange={(event) => handleSceneDraftChange('description', event.target.value)}
                            rows={3}
                          />
                        </label>
                        <label>
                          建筑特征
                          <input
                            type="text"
                            value={sceneDraft.architecture}
                            onChange={(event) => handleSceneDraftChange('architecture', event.target.value)}
                          />
                        </label>
                        <label>
                          配色
                          <input
                            type="text"
                            value={sceneDraft.colorScheme}
                            onChange={(event) => handleSceneDraftChange('colorScheme', event.target.value)}
                          />
                        </label>
                        <label>
                          关键地标
                          <input
                            type="text"
                            value={sceneDraft.landmarks}
                            onChange={(event) => handleSceneDraftChange('landmarks', event.target.value)}
                          />
                        </label>
                        <label>
                          布局说明
                          <input
                            type="text"
                            value={sceneDraft.layout}
                            onChange={(event) => handleSceneDraftChange('layout', event.target.value)}
                          />
                        </label>
                        <label>
                          氛围备注
                          <input
                            type="text"
                            value={sceneDraft.atmosphere}
                            onChange={(event) => handleSceneDraftChange('atmosphere', event.target.value)}
                          />
                        </label>
                        <div className={styles.cardActions}>
                          <button type="submit" className={styles.primaryButton} disabled={savingScene === sceneDraft.id}>
                            {savingScene === sceneDraft.id ? '保存中...' : '保存修改'}
                          </button>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => {
                              setActiveSceneId(null);
                              setSceneDraft(null);
                            }}
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.helperText}>暂无场景数据。</p>
            )}
          </article>
        </div>
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
                  <span>{(panel.scene || (panel as Record<string, any>).content?.scene || '未填写场景描述').slice(0, 48)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={styles.storyboardSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>分镜文本编辑</h2>
            <span>共 {panels.length} 个面板</span>
          </div>
          <p className={styles.helperTextSmall}>逐个修订场景描述与 Prompt，保存后即可复用最新文本生成面板</p>
        </div>
        {panels.length === 0 ? (
          <div className={styles.empty}>暂无面板，先进行分析和生成吧。</div>
        ) : (
          <div className={styles.storyboardList}>
            {panels.map((panel) => (
              <div key={`${panel.id}-text`} className={styles.storyboardCard}>
                <div className={styles.storyboardCardHeader}>
                  <div>
                    <strong>{`第 ${panel.page ?? '-'} 页 · 第 ${panel.index ?? '-'} 格`}</strong>
                    <span>{statusLabel(panel.status || 'pending')}</span>
                  </div>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => openPanelTextEditor(panel)}
                  >
                    {activePanelTextId === panel.id ? '收起编辑' : '编辑文案'}
                  </button>
                </div>
                <dl className={styles.panelMetaList}>
                  <div>
                    <dt>场景</dt>
                    <dd>{panel.scene || (panel as Record<string, any>).content?.scene || '未填写'}</dd>
                  </div>
                  <div>
                    <dt>景别 / 机位</dt>
                    <dd>{[panel.shotType, (panel as Record<string, any>).cameraAngle].filter(Boolean).join(' · ') || '未填写'}</dd>
                  </div>
                  <div>
                    <dt>角色</dt>
                    <dd>
                      {(panel.characters as PanelModel['characters']) && (panel.characters as PanelModel['characters'])!.length > 0
                        ? (panel.characters as PanelModel['characters'])!.map((character) => character?.name || '未知').join('、')
                        : '未填写'}
                    </dd>
                  </div>
                  <div>
                    <dt>对白</dt>
                    <dd>
                      {(panel.dialogue as PanelModel['dialogue']) && (panel.dialogue as PanelModel['dialogue'])!.length > 0
                        ? (panel.dialogue as PanelModel['dialogue'])!.map((item) => `${item?.speaker || '旁白'}：${item?.text || ''}`).join(' / ')
                        : '未填写'}
                    </dd>
                  </div>
                </dl>
                {activePanelTextId === panel.id && panelTextDraft?.id === panel.id && (
                  <form
                    className={styles.panelTextForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSavePanelText();
                    }}
                  >
                    <label>
                      场景描述
                      <textarea
                        rows={3}
                        value={panelTextDraft.scene}
                        onChange={(event) => handlePanelTextDraftChange('scene', event.target.value)}
                      />
                    </label>
                    <div className={styles.bibleFormGrid}>
                      <label>
                        景别
                        <select
                          value={panelTextDraft.shotType}
                          onChange={(event) => handlePanelTextDraftChange('shotType', event.target.value)}
                        >
                          {SHOT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        机位
                        <select
                          value={panelTextDraft.cameraAngle}
                          onChange={(event) => handlePanelTextDraftChange('cameraAngle', event.target.value)}
                        >
                          {CAMERA_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      角色（每行：姓名|姿态|表情）
                      <textarea
                        rows={3}
                        value={panelTextDraft.charactersText}
                        onChange={(event) => handlePanelTextDraftChange('charactersText', event.target.value)}
                      />
                    </label>
                    <label>
                      对白（每行：说话人:内容，留空默认为旁白）
                      <textarea
                        rows={3}
                        value={panelTextDraft.dialogueText}
                        onChange={(event) => handlePanelTextDraftChange('dialogueText', event.target.value)}
                      />
                    </label>
                    <label>
                      Imagen Prompt
                      <textarea
                        rows={3}
                        value={panelTextDraft.visualPrompt}
                        onChange={(event) => handlePanelTextDraftChange('visualPrompt', event.target.value)}
                      />
                    </label>
                    <div className={styles.cardActions}>
                      <button
                        type="submit"
                        className={styles.primaryButton}
                        disabled={savingPanelTextId === panel.id}
                      >
                        {savingPanelTextId === panel.id ? '保存中...' : '保存文案'}
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => {
                          setActivePanelTextId(null);
                          setPanelTextDraft(null);
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </form>
                )}
              </div>
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
          onSceneUpdated={() => void loadStoryboard()}
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
  return panels.map((panel) => {
    const legacyContent = (panel as Record<string, any>).content || {};
    const scene = (panel as Record<string, any>).scene ?? legacyContent.scene ?? '';
    const shotType = (panel as Record<string, any>).shotType ?? legacyContent.shotType ?? '';
    const cameraAngle = (panel as Record<string, any>).cameraAngle ?? legacyContent.cameraAngle ?? '';
    const characters =
      (panel.characters as PanelModel['characters']) ||
      (legacyContent.characters as PanelModel['characters']) ||
      [];
    const dialogue =
      (panel.dialogue as PanelModel['dialogue']) ||
      (legacyContent.dialogue as PanelModel['dialogue']) ||
      [];

    return {
      ...panel,
      scene,
      shotType,
      cameraAngle,
      characters,
      dialogue,
      previewUrl: panel.images?.preview,
      hdUrl: panel.images?.hd,
      status: typeof (panel as Record<string, unknown>).status === 'string'
        ? ((panel as Record<string, unknown>).status as string)
        : undefined
    };
  });
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

function formatAppearanceSummary(appearance?: BibleCharacter['appearance']) {
  if (!appearance) return '未填写';
  const segments: string[] = [];
  if (appearance.gender) segments.push(appearance.gender);
  if (appearance.age) segments.push(String(appearance.age));
  if (appearance.hairColor) segments.push(`${appearance.hairColor}发`);
  if (appearance.hairStyle) segments.push(appearance.hairStyle);
  if (appearance.eyeColor) segments.push(`${appearance.eyeColor}眼`);
  if (appearance.build) segments.push(appearance.build);
  if (appearance.clothing && appearance.clothing.length > 0) {
    segments.push(`服饰: ${appearance.clothing.join('、')}`);
  }
  if (appearance.distinctiveFeatures && appearance.distinctiveFeatures.length > 0) {
    segments.push(`特征: ${appearance.distinctiveFeatures.join('、')}`);
  }
  return segments.length > 0 ? segments.join(' · ') : '未填写';
}

function formatSceneSummary(scene: BibleScene) {
  const parts: string[] = [];
  if (scene.description) parts.push(scene.description);
  if (scene.visualCharacteristics?.architecture) {
    parts.push(`建筑: ${scene.visualCharacteristics.architecture}`);
  }
  if (scene.visualCharacteristics?.keyLandmarks && scene.visualCharacteristics.keyLandmarks.length > 0) {
    parts.push(`地标: ${scene.visualCharacteristics.keyLandmarks.join('、')}`);
  }
  if (scene.visualCharacteristics?.colorScheme) {
    parts.push(`配色: ${scene.visualCharacteristics.colorScheme}`);
  }
  return parts.length > 0 ? parts.join(' / ') : '暂无描述';
}

function splitList(value: string) {
  if (!value) return [];
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeReferenceImages(images: BibleReferenceImage[] = []) {
  return images
    .filter((image) => image && (image.s3Key || image.url))
    .map((image) => ({
      id: image.id,
      s3Key: image.s3Key,
      url: image.url && !image.s3Key ? image.url : undefined,
      label: image.label,
      source: image.source,
      uploadedAt: image.uploadedAt,
      uploadedBy: image.uploadedBy
    }));
}

function formatCharactersText(characters?: PanelModel['characters']) {
  if (!characters || characters.length === 0) return '';
  return characters
    .map((character) => `${character?.name || ''}|${character?.pose || ''}|${character?.expression || ''}`)
    .join('\n');
}

function formatDialogueText(dialogue?: PanelModel['dialogue']) {
  if (!dialogue || dialogue.length === 0) return '';
  return dialogue
    .map((item) => {
      const speaker = item?.speaker || '旁白';
      const text = item?.text || '';
      if (!text) {
        return speaker;
      }
      return `${speaker}: ${text}`;
    })
    .join('\n');
}

function parseCharactersText(text: string, originals: PanelModel['characters'] = []) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  return lines.map((line, index) => {
    const [nameRaw = '', poseRaw = '', expressionRaw = ''] = line.split('|').map((part) => part.trim());
    const original = originals[index] || {};
    return {
      charId: original?.charId || undefined,
      configId: original?.configId || undefined,
      name: nameRaw || original?.name || '',
      pose: poseRaw || original?.pose || '',
      expression: expressionRaw || original?.expression || ''
    };
  });
}

function parseDialogueText(text: string, originals: PanelModel['dialogue'] = []) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  return lines.map((line, index) => {
    const [speakerPart, ...rest] = line.split(':');
    const hasSpeaker = rest.length > 0;
    const speaker = hasSpeaker ? speakerPart.trim() : (originals[index]?.speaker || '旁白');
    const content = hasSpeaker ? rest.join(':').trim() : line.trim();

    return {
      speaker: speaker || '旁白',
      text: content,
      bubbleType: originals[index]?.bubbleType || 'speech'
    };
  });
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
  onSceneUpdated,
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
  onSceneUpdated?: () => void | Promise<void>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  jobState: JobStateSnapshot;
}) {
  const [sceneText, setSceneText] = useState(
    panel.scene || (panel as Record<string, any>).content?.scene || ''
  );
  const [sceneSaving, setSceneSaving] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);

  useEffect(() => {
    setSceneText(panel.scene || (panel as Record<string, any>).content?.scene || '');
    setSceneError(null);
  }, [panel.id, panel.scene]);

  const handleSceneSave = async () => {
    try {
      setSceneSaving(true);
      setSceneError(null);
      await PanelsService.patchPanels({
        panelId: panel.id,
        requestBody: {
          scene: sceneText
        }
      });
      if (onSceneUpdated) {
        await onSceneUpdated();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSceneError(message);
    } finally {
      setSceneSaving(false);
    }
  };

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
                <dd>{panel.scene || '未填写'}</dd>
              </div>
            </dl>
          </div>
          <div className={styles.sheetScene}>
            <label>
              场景描述
              <textarea
                className={styles.sheetTextarea}
                rows={4}
                value={sceneText}
                onChange={(event) => setSceneText(event.target.value)}
              />
            </label>
            <p className={styles.sheetNotice}>保存后重新生成面板会使用更新后的场景内容。</p>
            {sceneError && <p className={styles.errorText}>⚠️ {sceneError}</p>}
            <div className={styles.sheetActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleSceneSave()}
                disabled={sceneSaving}
              >
                {sceneSaving ? '保存场景中...' : '保存场景文本'}
              </button>
            </div>
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
