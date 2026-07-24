import { configureStore, createSlice } from '@reduxjs/toolkit';

const shellSlice = createSlice({
  initialState: {
    sidebarCollapsed: false,
  },
  name: 'shell',
  reducers: {
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
  },
});

export const shellActions = shellSlice.actions;

export const store = configureStore({
  reducer: {
    shell: shellSlice.reducer,
  },
});

export type AppDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
