import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { servicesApi, entityApi } from '../../services/api';
import type { Entity, Package } from '../../types';

interface ServicesState {
  services: string[];
  packages: Package[];
  serviceEntities: Record<string, Entity[]>;
  loading: boolean;
  error: string | null;
}

const initialState: ServicesState = {
  services: [],
  packages: [],
  serviceEntities: {},
  loading: false,
  error: null,
};

export const fetchAllServices = createAsyncThunk(
  'services/fetchAll',
  async () => {
    const data = await servicesApi.getAllServices();
    return data;
  }
);

export const fetchServiceEntities = createAsyncThunk(
  'services/fetchEntities',
  async (service: string) => {
    const data = await servicesApi.getServiceEntities(service);
    return { service, entities: data };
  }
);

export const fetchAllPackages = createAsyncThunk(
  'services/fetchAllPackages',
  async () => {
    return await entityApi.getAllPackages();
  }
);

const servicesSlice = createSlice({
  name: 'services',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAllServices.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAllServices.fulfilled, (state, action) => {
        state.loading = false;
        state.services = action.payload;
      })
      .addCase(fetchAllServices.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch services';
      })
      .addCase(fetchServiceEntities.fulfilled, (state, action) => {
        state.serviceEntities[action.payload.service] = action.payload.entities;
      })
      .addCase(fetchAllPackages.fulfilled, (state, action) => {
        state.packages = action.payload;
      });
  },
});

export default servicesSlice.reducer;
