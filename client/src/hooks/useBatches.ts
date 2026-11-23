import { useState, useCallback } from 'react';
import api from '../utils/api';

export interface Batch {
  id: string;
  name: string;
  year: number;
  isActive: boolean;
  campusId: string | null;
  campus: { id: string; name: string; code: string } | null;
  _count?: { students: number };
}

export function useBatches() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/batches');
      setBatches(data.data);
    } finally { setLoading(false); }
  }, []);

  const create = useCallback(async (name: string, year: number, campusId: string) => {
    const { data } = await api.post('/admin/batches', { name, year, campusId });
    return data.data as Batch;
  }, []);

  const update = useCallback(async (id: string, payload: { name?: string; year?: number; campusId?: string }) => {
    const { data } = await api.patch(`/admin/batches/${id}`, payload);
    return data.data as Batch;
  }, []);

  return { batches, loading, fetch, create, update };
}
