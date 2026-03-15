import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { servicesApi } from '../../services/api';
import type { SearchResult } from '../../types';

interface SearchState {
  query: string;
  results: SearchResult[];
  loading: boolean;
  error: string | null;
}

const initialState: SearchState = {
  query: '',
  results: [],
  loading: false,
  error: null,
};

export const searchEntities = createAsyncThunk(
  'search/searchEntities',
  async (query: string) => {
    return await servicesApi.searchEntities(query);
  }
);

const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    setSearchQuery(state, action) {
      state.query = action.payload;
    },
    clearSearch(state) {
      state.query = '';
      state.results = [];
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(searchEntities.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(searchEntities.fulfilled, (state, action) => {
        state.loading = false;
        state.results = action.payload;
      })
      .addCase(searchEntities.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Search failed';
      });
  },
});

export const { setSearchQuery, clearSearch } = searchSlice.actions;
export default searchSlice.reducer;
