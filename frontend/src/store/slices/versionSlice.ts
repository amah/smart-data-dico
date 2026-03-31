import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { versionApi } from '../../services/api';
import type { CommitInfo } from '../../types';

interface VersionState {
  commits: CommitInfo[];
  loading: boolean;
  error: string | null;
  lastCommitResult: { success: boolean; message?: string } | null;
}

const initialState: VersionState = {
  commits: [],
  loading: false,
  error: null,
  lastCommitResult: null,
};

export const fetchCommitHistory = createAsyncThunk(
  'version/fetchHistory',
  async (limit: number = 10) => {
    return await versionApi.getCommitHistory(limit);
  }
);

export const commitChanges = createAsyncThunk(
  'version/commit',
  async (message: string) => {
    return await versionApi.commitChanges(message);
  }
);

export const revertToCommit = createAsyncThunk(
  'version/revert',
  async (commitHash: string) => {
    return await versionApi.revertToCommit(commitHash);
  }
);

const versionSlice = createSlice({
  name: 'version',
  initialState,
  reducers: {
    clearLastCommitResult(state) {
      state.lastCommitResult = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCommitHistory.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCommitHistory.fulfilled, (state, action) => {
        state.loading = false;
        state.commits = action.payload;
      })
      .addCase(fetchCommitHistory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch commit history';
      })
      .addCase(commitChanges.pending, (state) => {
        state.loading = true;
      })
      .addCase(commitChanges.fulfilled, (state) => {
        state.loading = false;
        state.lastCommitResult = { success: true, message: 'Changes committed' };
      })
      .addCase(commitChanges.rejected, (state, action) => {
        state.loading = false;
        state.lastCommitResult = { success: false, message: action.error.message };
      })
      .addCase(revertToCommit.fulfilled, (state) => {
        state.lastCommitResult = { success: true, message: 'Reverted successfully' };
      });
  },
});

export const { clearLastCommitResult } = versionSlice.actions;
export default versionSlice.reducer;
