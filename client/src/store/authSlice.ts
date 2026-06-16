import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AuthUser {
  id: string;
  name: string;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT';
  batchIds: string[];
}

interface AuthState {
  user: AuthUser | null;
  checked: boolean;
}

const initialState: AuthState = { user: null, checked: false };

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload;
      state.checked = true;
    },
    clearUser(state) {
      state.user = null;
      state.checked = true;
    },
  },
});

export const { setUser, clearUser } = authSlice.actions;
export default authSlice.reducer;
export type { AuthUser };
