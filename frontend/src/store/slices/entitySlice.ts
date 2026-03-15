import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { servicesApi, entityApi } from '../../services/api';
import type { Entity } from '../../types';

interface EntityState {
  current: Entity | null;
  flatEntities: Entity[];
  loading: boolean;
  error: string | null;
}

const initialState: EntityState = {
  current: null,
  flatEntities: [],
  loading: false,
  error: null,
};

export const fetchEntity = createAsyncThunk(
  'entity/fetch',
  async ({ service, entity }: { service: string; entity: string }) => {
    return await servicesApi.getEntitySchema(service, entity);
  }
);

export const createEntity = createAsyncThunk(
  'entity/create',
  async ({ service, entityData }: { service: string; entityData: Entity }) => {
    return await servicesApi.createEntity(service, entityData);
  }
);

export const updateEntity = createAsyncThunk(
  'entity/update',
  async ({ service, entity, entityData }: { service: string; entity: string; entityData: Entity }) => {
    return await servicesApi.updateEntity(service, entity, entityData);
  }
);

export const deleteEntity = createAsyncThunk(
  'entity/delete',
  async ({ service, entity }: { service: string; entity: string }) => {
    await servicesApi.deleteEntity(service, entity);
    return { service, entity };
  }
);

export const fetchFlatEntities = createAsyncThunk(
  'entity/fetchFlat',
  async (params?: { name?: string; type?: string; package?: string }) => {
    return await entityApi.getFlatEntities(params);
  }
);

const entitySlice = createSlice({
  name: 'entity',
  initialState,
  reducers: {
    clearCurrentEntity(state) {
      state.current = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchEntity.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchEntity.fulfilled, (state, action) => {
        state.loading = false;
        state.current = action.payload;
      })
      .addCase(fetchEntity.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch entity';
      })
      .addCase(createEntity.fulfilled, (state, action) => {
        state.current = action.payload;
      })
      .addCase(updateEntity.fulfilled, (state, action) => {
        state.current = action.payload;
      })
      .addCase(fetchFlatEntities.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchFlatEntities.fulfilled, (state, action) => {
        state.loading = false;
        state.flatEntities = action.payload;
      })
      .addCase(fetchFlatEntities.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch flat entities';
      });
  },
});

export const { clearCurrentEntity } = entitySlice.actions;
export default entitySlice.reducer;
