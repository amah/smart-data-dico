import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { dictionaryApi } from '../../services/api';
import type { Dictionary } from '../../types';

interface DictionaryState {
  dictionaries: Dictionary[];
  current: Dictionary | null;
  loading: boolean;
  error: string | null;
}

const initialState: DictionaryState = {
  dictionaries: [],
  current: null,
  loading: false,
  error: null,
};

export const fetchAllDictionaries = createAsyncThunk(
  'dictionary/fetchAll',
  async () => {
    return await dictionaryApi.getAllDictionaries();
  }
);

export const fetchDictionary = createAsyncThunk(
  'dictionary/fetch',
  async (id: string) => {
    return await dictionaryApi.getDictionaryById(id);
  }
);

export const createDictionary = createAsyncThunk(
  'dictionary/create',
  async (data: any) => {
    return await dictionaryApi.createDictionary(data);
  }
);

export const updateDictionary = createAsyncThunk(
  'dictionary/update',
  async ({ id, data }: { id: string; data: any }) => {
    return await dictionaryApi.updateDictionary(id, data);
  }
);

export const deleteDictionary = createAsyncThunk(
  'dictionary/delete',
  async (id: string) => {
    await dictionaryApi.deleteDictionary(id);
    return id;
  }
);

const dictionarySlice = createSlice({
  name: 'dictionary',
  initialState,
  reducers: {
    clearCurrentDictionary(state) {
      state.current = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAllDictionaries.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAllDictionaries.fulfilled, (state, action) => {
        state.loading = false;
        state.dictionaries = action.payload;
      })
      .addCase(fetchAllDictionaries.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch dictionaries';
      })
      .addCase(fetchDictionary.fulfilled, (state, action) => {
        state.current = action.payload;
      })
      .addCase(createDictionary.fulfilled, (state, action) => {
        state.dictionaries.push(action.payload);
      })
      .addCase(deleteDictionary.fulfilled, (state, action) => {
        state.dictionaries = state.dictionaries.filter((d) => d.id !== action.payload);
      });
  },
});

export const { clearCurrentDictionary } = dictionarySlice.actions;
export default dictionarySlice.reducer;
