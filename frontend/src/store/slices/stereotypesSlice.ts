import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { stereotypeApi } from '../../services/api';
import type { Stereotype, StereotypeTarget } from '../../types';

interface StereotypesState {
  stereotypes: Stereotype[];
  loading: boolean;
  error: string | null;
}

const initialState: StereotypesState = {
  stereotypes: [],
  loading: false,
  error: null,
};

export const fetchStereotypes = createAsyncThunk(
  'stereotypes/fetchAll',
  async (appliesTo?: StereotypeTarget) => {
    return await stereotypeApi.getAll(appliesTo);
  },
);

export const createStereotypeAction = createAsyncThunk(
  'stereotypes/create',
  async (data: Stereotype) => {
    const result = await stereotypeApi.create(data);
    return result.data;
  },
);

export const updateStereotypeAction = createAsyncThunk(
  'stereotypes/update',
  async ({ id, data }: { id: string; data: Partial<Stereotype> }) => {
    const result = await stereotypeApi.update(id, data);
    return result.data;
  },
);

export const deleteStereotypeAction = createAsyncThunk(
  'stereotypes/delete',
  async (id: string) => {
    await stereotypeApi.delete(id);
    return id;
  },
);

const stereotypesSlice = createSlice({
  name: 'stereotypes',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchStereotypes.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchStereotypes.fulfilled, (state, action) => {
        state.loading = false;
        state.stereotypes = action.payload;
      })
      .addCase(fetchStereotypes.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch stereotypes';
      })
      .addCase(createStereotypeAction.fulfilled, (state, action) => {
        state.stereotypes.push(action.payload);
      })
      .addCase(updateStereotypeAction.fulfilled, (state, action) => {
        const index = state.stereotypes.findIndex((s) => s.id === action.payload.id);
        if (index >= 0) state.stereotypes[index] = action.payload;
      })
      .addCase(deleteStereotypeAction.fulfilled, (state, action) => {
        state.stereotypes = state.stereotypes.filter((s) => s.id !== action.payload);
      });
  },
});

export default stereotypesSlice.reducer;
