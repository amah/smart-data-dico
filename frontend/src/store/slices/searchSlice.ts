import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { host } from '../../kernel/bootstrap';
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
    // Resolve at call time (after bootstrap) via the command bus.
    // Bootstrap always completes before any thunk fires — the store itself
    // comes from the kernel, so dispatch cannot precede bootstrap. If this
    // thunk somehow fires pre-bootstrap, the ctx guard throws a clear error.
    // Pre-existing reducer bug: state.results is SearchResult[] but action.payload
    // is SearchResponse (envelope). The bug is invisible today — no component
    // reads state.search.results (the slice is dead code). #154 owners will
    // clean up when rehoming the slice to plugins/search/slices/.
    const ctx = host.rootActivationCtx;
    if (!ctx) {
      throw new Error('searchEntities thunk fired before bootstrap completed');
    }
    return await ctx.commands.run('search.search', { query });
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
