import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { CaseService } from '../services/CaseService';
import type { Case, ResolvedCase } from '../../../types';

interface CasesState {
  cases: Case[];
  current: ResolvedCase | null;
  loading: boolean;
  error: string | null;
}

const initialState: CasesState = {
  cases: [],
  current: null,
  loading: false,
  error: null,
};

export const fetchCases = createAsyncThunk('cases/fetchAll', async () => {
  return await new CaseService().getAll();
});

export const resolveCase = createAsyncThunk('cases/resolve', async (id: string) => {
  return await new CaseService().resolve(id);
});

export const createCaseAction = createAsyncThunk(
  'cases/create',
  async (data: Partial<Case>) => {
    const result = await new CaseService().create(data);
    return result.data;
  },
);

export const updateCaseAction = createAsyncThunk(
  'cases/update',
  async ({ id, data }: { id: string; data: Partial<Case> }) => {
    const result = await new CaseService().update(id, data);
    return result.data;
  },
);

export const deleteCaseAction = createAsyncThunk('cases/delete', async (id: string) => {
  await new CaseService().delete(id);
  return id;
});

const casesSlice = createSlice({
  name: 'cases',
  initialState,
  reducers: {
    clearCurrent(state) {
      state.current = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCases.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCases.fulfilled, (state, action) => {
        state.loading = false;
        state.cases = action.payload;
      })
      .addCase(fetchCases.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch cases';
      })
      .addCase(resolveCase.pending, (state) => {
        state.loading = true;
      })
      .addCase(resolveCase.fulfilled, (state, action) => {
        state.loading = false;
        state.current = action.payload;
      })
      .addCase(resolveCase.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to resolve case';
      })
      .addCase(createCaseAction.fulfilled, (state, action) => {
        state.cases.push(action.payload);
      })
      .addCase(deleteCaseAction.fulfilled, (state, action) => {
        state.cases = state.cases.filter((p) => p.uuid !== action.payload);
      });
  },
});

export const { clearCurrent } = casesSlice.actions;
export default casesSlice.reducer;
