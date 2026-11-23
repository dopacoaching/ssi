import { useState, useCallback } from 'react';
import api from '../utils/api';
import type { Campus, LibrarySettings } from './useCampuses';
import type { LoanView } from './useCirculation';

export interface LibraryMe {
  isAdmin: boolean;
  campus: Campus | null;
  campuses: Campus[];
  settings: LibrarySettings;
}

export interface LibraryDashboardData {
  campus: { id: string; name: string; code: string } | null;
  dueToday: { count: number; items: LoanView[] };
  dueSoon: { count: number; items: LoanView[] };
  overdue: { count: number; items: LoanView[] };
  pendingFines: { balance: number; accruing: number; studentCount: number };
  todayCollection: { myTotal: number; myCount: number; campusTotal: number; campusCount: number };
  admin?: { pendingWaivers: number; lostCopies: number; damagedCopies: number; openStockChecks: number };
}

export function useLibrary() {
  const [me, setMe] = useState<LibraryMe | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchMe = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/library/me');
      setMe(data.data as LibraryMe);
      return data.data as LibraryMe;
    } finally { setLoading(false); }
  }, []);

  const fetchCampuses = useCallback(async () => {
    const { data } = await api.get('/library/campuses');
    return data.data as Campus[];
  }, []);

  const fetchDashboard = useCallback(async (campusId?: string) => {
    const { data } = await api.get('/library/dashboard', { params: campusId ? { campusId } : {} });
    return data.data as LibraryDashboardData;
  }, []);

  const updateCatalogSettings = useCallback(async (
    campusId: string,
    payload: { shelfLocations?: string[]; categories?: string[] },
  ) => {
    const { data } = await api.patch(`/library/campuses/${campusId}/catalog-settings`, payload);
    return data.data as Campus;
  }, []);

  return { me, loading, fetchMe, fetchCampuses, fetchDashboard, updateCatalogSettings };
}
