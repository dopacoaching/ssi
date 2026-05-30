import { useState, useCallback } from 'react';
import api from '../utils/api';

export interface Remark {
  id: string; studentId: string;
  teacherId: string;
  teacher: { id: string; name: string };
  category: string; text: string;
  isFlagged: boolean; createdAt: string;
}

export function useRemarks(studentId: string) {
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.get(`/students/${studentId}/remarks`);
      setRemarks(data.data);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load remarks');
    } finally { setLoading(false); }
  }, [studentId]);

  const add = useCallback(async (payload: { category: string; text: string; isFlagged?: boolean }) => {
    const { data } = await api.post(`/students/${studentId}/remarks`, payload);
    return data.data as Remark;
  }, [studentId]);

  const flag = useCallback(async (remarkId: string) => {
    const { data } = await api.patch(`/students/${studentId}/remarks/${remarkId}/flag`);
    return data.data as Remark;
  }, [studentId]);

  return { remarks, loading, error, fetch, add, flag };
}
