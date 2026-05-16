import { useState, useCallback } from 'react';
import api from '../utils/api';

export interface AuditEntry {
  id: string;
  userId:   string | null;
  userName: string | null;
  userRole: string | null;
  action: string;
  entity: string;
  entityId: string;
  description: string;
  createdAt: string;
}

export interface AuditFilters {
  page?: number;
  limit?: number;
  action?: string;
  entity?: string;
  search?: string;
  from?: string;
  to?: string;
}

export function useAudit() {
  const [items, setItems]   = useState<AuditEntry[]>([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async (filters: AuditFilters = {}) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {};
      if (filters.page)   params.page   = filters.page;
      if (filters.limit)  params.limit  = filters.limit;
      if (filters.action) params.action = filters.action;
      if (filters.entity) params.entity = filters.entity;
      if (filters.search) params.search = filters.search;
      if (filters.from)   params.from   = filters.from;
      if (filters.to)     params.to     = filters.to;
      const res = await api.get('/admin/audit', { params });
      setItems(res.data.data.items);
      setTotal(res.data.data.total);
    } finally {
      setLoading(false);
    }
  }, []);

  return { items, total, loading, fetch };
}
