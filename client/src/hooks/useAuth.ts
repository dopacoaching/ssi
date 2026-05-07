import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { setUser, clearUser } from '../store/authSlice';
import api from '../utils/api';

export function useAuth() {
  const dispatch = useDispatch();
  const { user, checked } = useSelector((s: RootState) => s.auth);

  const login = useCallback(async (credentials: { email?: string; regNumber?: string }, password: string) => {
    const { data } = await api.post('/auth/login', { ...credentials, password });
    dispatch(setUser(data.data));
  }, [dispatch]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    dispatch(clearUser());
  }, [dispatch]);

  const restore = useCallback(async () => {
    const hasSession = document.cookie.split(';').some((c) => c.trim().startsWith('sessionExists='));
    if (!hasSession) {
      dispatch(clearUser());
      return;
    }
    try {
      const { data } = await api.post('/auth/refresh');
      dispatch(setUser(data.data));
    } catch {
      // Expire the session flag so we don't retry on every reload
      document.cookie = 'sessionExists=; Max-Age=0; path=/';
      dispatch(clearUser());
    }
  }, [dispatch]);

  return { user, checked, login, logout, restore };
}
