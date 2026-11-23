import { useState, useCallback } from 'react';
import api from '../utils/api';

export type StaffRole = 'TEACHER' | 'LIBRARIAN';

export interface Staff {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  batchIds: string[];
  libraryCampusId: string | null;
  libraryCampus: { id: string; name: string; code: string } | null;
  isActive: boolean;
  createdAt: string;
}

export interface CreateStaffPayload {
  name: string;
  email: string;
  password: string;
  role: StaffRole;
  batchIds?: string[];
  libraryCampusId?: string | null;
}

export interface UpdateStaffPayload {
  name?: string;
  role?: StaffRole;
  batchIds?: string[];
  libraryCampusId?: string | null;
  isActive?: boolean;
  password?: string;
}

export function useStaff() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/staff');
      setStaff(data.data as Staff[]);
    } finally { setLoading(false); }
  }, []);

  const createStaff = useCallback(async (payload: CreateStaffPayload) => {
    const { data } = await api.post('/admin/staff', payload);
    return data.data as Staff;
  }, []);

  const updateStaff = useCallback(async (id: string, payload: UpdateStaffPayload) => {
    const { data } = await api.patch(`/admin/staff/${id}`, payload);
    return data.data as Staff;
  }, []);

  return { staff, loading, fetchStaff, createStaff, updateStaff };
}
