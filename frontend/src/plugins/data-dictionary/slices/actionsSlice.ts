/**
 * Actions Redux slice (#179).
 *
 * Stores actions per-entity, keyed by entity UUID. Mirrors the shape of
 * `rulesSlice` (byEntityUuid cache).
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { actionsApi } from '../../../services/api';
import type { Action } from '../../../types';

interface ActionsState {
  /** Per-entity caches keyed by entityUuid */
  byEntityUuid: Record<string, Action[]>;
  loading: boolean;
  error: string | null;
}

const initialState: ActionsState = {
  byEntityUuid: {},
  loading: false,
  error: null,
};

export const fetchActionsForEntity = createAsyncThunk(
  'actions/fetchForEntity',
  async (entityUuid: string) => {
    const actions = await actionsApi.getForEntity(entityUuid);
    return { entityUuid, actions };
  },
);

export const createActionThunk = createAsyncThunk(
  'actions/create',
  async (data: Partial<Action>) => {
    return await actionsApi.create(data);
  },
);

export const updateActionThunk = createAsyncThunk(
  'actions/update',
  async ({ uuid, data }: { uuid: string; data: Partial<Action> }) => {
    return await actionsApi.update(uuid, data);
  },
);

export const deleteActionThunk = createAsyncThunk(
  'actions/delete',
  async ({ uuid, ownerRef }: { uuid: string; ownerRef: string }) => {
    await actionsApi.delete(uuid);
    return { uuid, ownerRef };
  },
);

const actionsSlice = createSlice({
  name: 'actions',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchActionsForEntity.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchActionsForEntity.fulfilled, (state, action) => {
        state.loading = false;
        state.byEntityUuid[action.payload.entityUuid] = action.payload.actions;
      })
      .addCase(fetchActionsForEntity.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch actions';
      })
      .addCase(createActionThunk.fulfilled, (state, action) => {
        const ownerRef = action.payload.ownerRef;
        if (!state.byEntityUuid[ownerRef]) state.byEntityUuid[ownerRef] = [];
        state.byEntityUuid[ownerRef].push(action.payload);
      })
      .addCase(updateActionThunk.fulfilled, (state, action) => {
        const ownerRef = action.payload.ownerRef;
        if (state.byEntityUuid[ownerRef]) {
          const idx = state.byEntityUuid[ownerRef].findIndex(a => a.uuid === action.payload.uuid);
          if (idx >= 0) state.byEntityUuid[ownerRef][idx] = action.payload;
        }
      })
      .addCase(deleteActionThunk.fulfilled, (state, action) => {
        const { uuid, ownerRef } = action.payload;
        if (state.byEntityUuid[ownerRef]) {
          state.byEntityUuid[ownerRef] = state.byEntityUuid[ownerRef].filter(a => a.uuid !== uuid);
        }
      });
  },
});

export default actionsSlice.reducer;
