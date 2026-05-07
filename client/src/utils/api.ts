import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

let refreshing = false;
let queue: Array<() => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (original.url?.includes('/auth/refresh') || original.url?.includes('/auth/login')) {
      return Promise.reject(err);
    }
    if (err.response?.status === 401 && !original._retry) {
      if (refreshing) {
        return new Promise((resolve) => {
          queue.push(() => resolve(api(original)));
        });
      }
      original._retry = true;
      refreshing = true;
      try {
        await axios.post('/api/auth/refresh', {}, { withCredentials: true });
        queue.forEach((cb) => cb());
        queue = [];
        return api(original);
      } catch {
        queue = [];
        const isStudentPath = window.location.pathname.includes('/students/') || window.location.pathname.includes('/student/login');
        window.location.href = isStudentPath ? '/student/login' : '/login';
        return Promise.reject(err);
      } finally {
        refreshing = false;
      }
    }
    return Promise.reject(err);
  },
);

export default api;
