import { useCallback, useEffect, useRef, useState } from 'react';
import { JobsService } from '../api/generated';
import type { Job } from '../api/generated';

export type JobState =
  | { status: 'idle' }
  | { status: 'processing'; jobId: string; job?: Job }
  | { status: 'completed'; jobId: string; job?: Job }
  | { status: 'failed'; jobId?: string; error: string };

interface UseJobMonitorOptions {
  intervalMs?: number;
  onCompleted?: (job: Job) => void | Promise<void>;
  onFailed?: (payload: { jobId: string; error?: string; job?: Job }) => void | Promise<void>;
}

/**
 * 通用任务轮询 Hook
 * 管理 job 状态、轮询以及完成/失败回调
 */
export function useJobMonitor(options: UseJobMonitorOptions = {}) {
  const { intervalMs = 2500, onCompleted, onFailed } = options;
  const [jobState, setJobState] = useState<JobState>({ status: 'idle' });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeJobId = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string) => {
      try {
        const job = await JobsService.getJob({ id: jobId });
        if (job.status === 'completed') {
          clearTimer();
          activeJobId.current = null;
          setJobState({ status: 'completed', jobId, job });
          if (onCompleted) {
            await onCompleted(job);
          }
        } else if (job.status === 'failed') {
          clearTimer();
          activeJobId.current = null;
          setJobState({ status: 'failed', jobId, error: job.error || '任务失败' });
          await onFailed?.({ jobId, job, error: job.error });
        } else {
          setJobState({ status: 'processing', jobId, job });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '任务轮询失败';
        console.error('[useJobMonitor] Polling error:', error);
        clearTimer();
        activeJobId.current = null;
        setJobState({
          status: 'failed',
          jobId,
          error: message
        });
        await onFailed?.({ jobId, error: message });
      }
    },
    [clearTimer, onCompleted, onFailed]
  );

  const start = useCallback(
    (jobId: string) => {
      if (!jobId) return;
      clearTimer();
      activeJobId.current = jobId;
      setJobState({ status: 'processing', jobId });
      // 立即轮询一次，后续按间隔执行
      pollJob(jobId);
      intervalRef.current = setInterval(() => {
        pollJob(jobId);
      }, intervalMs);
    },
    [clearTimer, intervalMs, pollJob]
  );

  const stop = useCallback(() => {
    activeJobId.current = null;
    clearTimer();
    setJobState({ status: 'idle' });
  }, [clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return {
    jobState,
    start,
    stop
  };
}
