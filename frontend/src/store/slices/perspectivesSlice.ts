import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { perspectiveApi } from '../../services/api';
import type { Perspective, ResolvedPerspective } from '../../types';

interface PerspectivesState {
  perspectives: Perspective[];
  current: ResolvedPerspective | null;
  loading: boolean;
  error: string | null;
}

const initialState: PerspectivesState = {
  perspectives: [],
  current: null,
  loading: false,
  error: null,
};

export const fetchPerspectives = createAsyncThunk('perspectives/fetchAll', async () => {
  return await perspectiveApi.getAll();
});

export const resolvePerspective = createAsyncThunk('perspectives/resolve', async (id: string) => {
  return await perspectiveApi.resolve(id);
});

export const createPerspectiveAction = createAsyncThunk(
  'perspectives/create',
  async (data: Partial<Perspective>) => {
    const result = await perspectiveApi.create(data);
    return result.data;
  },
);

export const updatePerspectiveAction = createAsyncThunk(
  'perspectives/update',
  async ({ id, data }: { id: string; data: Partial<Perspective> }) => {
    const result = await perspectiveApi.update(id, data);
    return result.data;
  },
);

export const deletePerspectiveAction = createAsyncThunk('perspectives/delete', async (id: string) => {
  await perspectiveApi.delete(id);
  return id;
});

const perspectivesSlice = createSlice({
  name: 'perspectives',
  initialState,
  reducers: {
    clearCurrent(state) {
      state.current = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPerspectives.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchPerspectives.fulfilled, (state, action) => {
        state.loading = false;
        state.perspectives = action.payload;
      })
      .addCase(fetchPerspectives.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch perspectives';
      })
      .addCase(resolvePerspective.pending, (state) => {
        state.loading = true;
      })
      .addCase(resolvePerspective.fulfilled, (state, action) => {
        state.loading = false;
        state.current = action.payload;
      })
      .addCase(resolvePerspective.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to resolve perspective';
      })
      .addCase(createPerspectiveAction.fulfilled, (state, action) => {
        state.perspectives.push(action.payload);
      })
      .addCase(deletePerspectiveAction.fulfilled, (state, action) => {
        state.perspectives = state.perspectives.filter((p) => p.uuid !== action.payload);
      });
  },
});

export const { clearCurrent } = perspectivesSlice.actions;
export default perspectivesSlice.reducer;
