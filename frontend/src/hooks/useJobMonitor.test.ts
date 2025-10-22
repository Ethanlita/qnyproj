import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { useJobMonitor } from './useJobMonitor';
import { JobsService } from '../api/generated';

vi.mock('../api/generated', () => ({
  JobsService: {
    getJobs: vi.fn()
  }
}));

const mockGetJobs = JobsService.getJobs as unknown as vi.Mock;

describe('useJobMonitor', () => {
  beforeEach(() => {
    mockGetJobs.mockReset();
  });

  it('任务完成后更新状态并调用 onCompleted', async () => {
    const onCompleted = vi.fn();
    mockGetJobs.mockResolvedValue({
      id: 'job-1',
      status: 'completed',
      type: 'generate_preview',
      progress: {},
      createdAt: '',
      updatedAt: ''
    });

    const { result } = renderHook(() => useJobMonitor({ onCompleted }));

    await act(async () => {
      result.current.start('job-1');
    });

    await waitFor(() => {
      expect(onCompleted).toHaveBeenCalledTimes(1);
      expect(result.current.jobState.status).toBe('completed');
      if (result.current.jobState.status === 'completed') {
        expect(result.current.jobState.jobId).toBe('job-1');
      }
    });
  });

  it('任务失败后更新状态并调用 onFailed', async () => {
    const onFailed = vi.fn();
    mockGetJobs.mockResolvedValue({
      id: 'job-2',
      status: 'failed',
      error: '任务失败',
      type: 'generate_preview',
      progress: {},
      createdAt: '',
      updatedAt: ''
    });

    const { result } = renderHook(() => useJobMonitor({ onFailed }));

    await act(async () => {
      result.current.start('job-2');
    });

    await waitFor(() => {
      expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-2', error: '任务失败' }));
      expect(result.current.jobState.status).toBe('failed');
    });
  });

  it('轮询抛出异常时进入失败状态', async () => {
    const onFailed = vi.fn();
    mockGetJobs.mockRejectedValue(new Error('网络错误'));

    const { result } = renderHook(() => useJobMonitor({ onFailed }));

    await act(async () => {
      result.current.start('job-3');
    });

    await waitFor(() => {
      expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-3', error: '网络错误' }));
      expect(result.current.jobState.status).toBe('failed');
    });
  });
});
