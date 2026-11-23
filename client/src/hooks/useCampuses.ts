import { useState, useCallback } from 'react';
import api from '../utils/api';

export interface Campus {
  id: string;
  name: string;
  code: string;
  libraryName: string;
  receiptAddress: string;
  receiptPhone: string;
  openingHours: string;
  shelfLocations: string[];
  categories: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  batches?: { id: string; name: string; year: number }[];
}

export interface LibrarySettings {
  loanDays: number;
  finePerDay: number;
  maxBooks: number;
  maxRenewals: number;
  fineBlockThreshold: number;
  updatedAt: string;
}

export interface CampusPayload {
  name?: string;
  code?: string;
  libraryName?: string;
  receiptAddress?: string;
  receiptPhone?: string;
  openingHours?: string;
  shelfLocations?: string[];
  categories?: string[];
  isActive?: boolean;
}

export function useCampuses() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCampuses = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/campuses');
      setCampuses(data.data as Campus[]);
    } finally { setLoading(false); }
  }, []);

  const createCampus = useCallback(async (payload: CampusPayload & { name: string; code: string }) => {
    const { data } = await api.post('/admin/campuses', payload);
    return data.data as Campus;
  }, []);

  const updateCampus = useCallback(async (id: string, payload: Omit<CampusPayload, 'code'>) => {
    const { data } = await api.patch(`/admin/campuses/${id}`, payload);
    return data.data as Campus;
  }, []);

  const fetchSettings = useCallback(async () => {
    const { data } = await api.get('/admin/library-settings');
    setSettings(data.data as LibrarySettings);
    return data.data as LibrarySettings;
  }, []);

  const updateSettings = useCallback(async (payload: Partial<Omit<LibrarySettings, 'updatedAt'>>) => {
    const { data } = await api.patch('/admin/library-settings', payload);
    setSettings(data.data as LibrarySettings);
    return data.data as LibrarySettings;
  }, []);

  return { campuses, settings, loading, fetchCampuses, createCampus, updateCampus, fetchSettings, updateSettings };
}
