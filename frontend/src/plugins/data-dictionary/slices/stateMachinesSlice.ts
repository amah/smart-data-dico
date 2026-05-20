/**
 * State Machines Redux slice (#179).
 *
 * Stores state machines per-entity, keyed by entity UUID.
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { stateMachinesApi } from '../../../services/api';
import type { StateMachine } from '../../../types';

interface StateMachinesState {
  /** Per-entity caches keyed by entityUuid */
  byEntityUuid: Record<string, StateMachine[]>;
  loading: boolean;
  error: string | null;
}

const initialState: StateMachinesState = {
  byEntityUuid: {},
  loading: false,
  error: null,
};

export const fetchStateMachinesForEntity = createAsyncThunk(
  'stateMachines/fetchForEntity',
  async (entityUuid: string) => {
    const machines = await stateMachinesApi.getForEntity(entityUuid);
    return { entityUuid, machines };
  },
);

export const createStateMachineThunk = createAsyncThunk(
  'stateMachines/create',
  async (data: Partial<StateMachine>) => {
    return await stateMachinesApi.create(data);
  },
);

export const updateStateMachineThunk = createAsyncThunk(
  'stateMachines/update',
  async ({ uuid, data }: { uuid: string; data: Partial<StateMachine> }) => {
    return await stateMachinesApi.update(uuid, data);
  },
);

export const deleteStateMachineThunk = createAsyncThunk(
  'stateMachines/delete',
  async ({ uuid, ownerRef }: { uuid: string; ownerRef: string }) => {
    await stateMachinesApi.delete(uuid);
    return { uuid, ownerRef };
  },
);

const stateMachinesSlice = createSlice({
  name: 'stateMachines',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchStateMachinesForEntity.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchStateMachinesForEntity.fulfilled, (state, action) => {
        state.loading = false;
        state.byEntityUuid[action.payload.entityUuid] = action.payload.machines;
      })
      .addCase(fetchStateMachinesForEntity.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch state machines';
      })
      .addCase(createStateMachineThunk.fulfilled, (state, action) => {
        const ownerRef = action.payload.ownerRef;
        if (!state.byEntityUuid[ownerRef]) state.byEntityUuid[ownerRef] = [];
        state.byEntityUuid[ownerRef].push(action.payload);
      })
      .addCase(updateStateMachineThunk.fulfilled, (state, action) => {
        const ownerRef = action.payload.ownerRef;
        if (state.byEntityUuid[ownerRef]) {
          const idx = state.byEntityUuid[ownerRef].findIndex(m => m.uuid === action.payload.uuid);
          if (idx >= 0) state.byEntityUuid[ownerRef][idx] = action.payload;
        }
      })
      .addCase(deleteStateMachineThunk.fulfilled, (state, action) => {
        const { uuid, ownerRef } = action.payload;
        if (state.byEntityUuid[ownerRef]) {
          state.byEntityUuid[ownerRef] = state.byEntityUuid[ownerRef].filter(m => m.uuid !== uuid);
        }
      });
  },
});

export default stateMachinesSlice.reducer;
