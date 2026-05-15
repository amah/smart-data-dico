import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { useService } from '../../kernel/useService';
import { SEARCH_SERVICE_TOKEN } from '../../kernel/tokens';
import type { SearchService } from '../../plugins/search/services/SearchService';
import type { SearchResult } from '../../types';
// TODO(#154): when the search plugin grows its slices/ folder, move this file
// to frontend/src/plugins/search/slices/searchSlice.ts along with the
// reducer registration in bootstrap.ts. This slice stays put until that rehoming.

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
    // Resolve at call time (after bootstrap). `useService` is just a
    // kernel-resolve wrapper; despite the `use*` name it has no React
    // hooks contract and is safe to call inside thunks.
    // Bootstrap always completes before any thunk fires — the store itself
    // comes from the kernel, so dispatch cannot precede bootstrap. If this
    // thunk somehow fires pre-bootstrap, `useService` throws a clear error
    // rather than silently returning undefined (see #155-search Risk #1).
    // Pre-existing reducer bug: state.results is SearchResult[] but action.payload
    // is SearchResponse (envelope). The bug is invisible today — no component
    // reads state.search.results (the slice is dead code). #154 owners will
    // clean up when rehoming the slice to plugins/search/slices/.
    const service = useService<SearchService>(SEARCH_SERVICE_TOKEN);
    return await service.searchEntities(query);
  },
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
        // The thunk returns the full envelope {message, data: SearchResult[]};
        // unwrap to the array — fixes a pre-existing reducer correctness bug
        // surfaced by the typed SearchService return shape (was hidden under
        // `any` when the call went through servicesApi).
        state.results = action.payload.data;
      })
      .addCase(searchEntities.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Search failed';
      });
  },
});

export const { setSearchQuery, clearSearch } = searchSlice.actions;
export default searchSlice.reducer;
