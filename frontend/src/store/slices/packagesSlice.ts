import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { packageApi } from '../../services/api';
import type { Package } from '../../types';

interface PackagesState {
  currentPackage: Package | null;
  loading: boolean;
  error: string | null;
}

const initialState: PackagesState = {
  currentPackage: null,
  loading: false,
  error: null,
};

export const fetchPackageByPath = createAsyncThunk(
  'packages/fetchByPath',
  async ({ rootPackage, path }: { rootPackage: string; path: string[] }) => {
    return await packageApi.getPackageByPath(rootPackage, path);
  },
);

export const createPackage = createAsyncThunk(
  'packages/create',
  async (data: { name: string; description?: string; type?: string }) => {
    return await packageApi.createPackage(data);
  },
);

export const createSubPackage = createAsyncThunk(
  'packages/createSub',
  async ({ rootPackage, path, data }: { rootPackage: string; path: string[]; data: Partial<Package> }) => {
    return await packageApi.createSubPackage(rootPackage, path, data);
  },
);

export const updatePackageAction = createAsyncThunk(
  'packages/update',
  async ({ rootPackage, path, data }: { rootPackage: string; path: string[]; data: Partial<Package> }) => {
    return await packageApi.updatePackage(rootPackage, path, data);
  },
);

export const deletePackageAction = createAsyncThunk(
  'packages/delete',
  async ({ rootPackage, path, force }: { rootPackage: string; path: string[]; force?: boolean }) => {
    return await packageApi.deletePackage(rootPackage, path, force);
  },
);

const packagesSlice = createSlice({
  name: 'packages',
  initialState,
  reducers: {
    clearCurrentPackage(state) {
      state.currentPackage = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPackageByPath.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchPackageByPath.fulfilled, (state, action) => {
        state.loading = false;
        state.currentPackage = action.payload;
      })
      .addCase(fetchPackageByPath.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch package';
      });
  },
});

export const { clearCurrentPackage } = packagesSlice.actions;
export default packagesSlice.reducer;
