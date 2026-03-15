import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { diagramApi } from '../../services/api';
import type { DiagramLayout } from '../../types';

interface DiagramState {
  layouts: DiagramLayout[];
  current: DiagramLayout | null;
  loading: boolean;
  error: string | null;
}

const initialState: DiagramState = {
  layouts: [],
  current: null,
  loading: false,
  error: null,
};

export const fetchDiagramLayouts = createAsyncThunk(
  'diagram/fetchLayouts',
  async (service?: string) => {
    return await diagramApi.listDiagramLayouts(service);
  }
);

export const fetchDiagramLayout = createAsyncThunk(
  'diagram/fetchLayout',
  async (id: string) => {
    return await diagramApi.loadDiagramLayout(id);
  }
);

export const saveDiagramLayout = createAsyncThunk(
  'diagram/save',
  async (layout: any) => {
    return await diagramApi.saveDiagramLayout(layout);
  }
);

export const updateDiagramLayout = createAsyncThunk(
  'diagram/update',
  async ({ id, layout }: { id: string; layout: any }) => {
    return await diagramApi.updateDiagramLayout(id, layout);
  }
);

export const deleteDiagramLayout = createAsyncThunk(
  'diagram/delete',
  async (id: string) => {
    await diagramApi.deleteDiagramLayout(id);
    return id;
  }
);

const diagramSlice = createSlice({
  name: 'diagram',
  initialState,
  reducers: {
    clearCurrentDiagram(state) {
      state.current = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDiagramLayouts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDiagramLayouts.fulfilled, (state, action) => {
        state.loading = false;
        state.layouts = action.payload;
      })
      .addCase(fetchDiagramLayouts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch diagram layouts';
      })
      .addCase(fetchDiagramLayout.fulfilled, (state, action) => {
        state.current = action.payload;
      })
      .addCase(saveDiagramLayout.fulfilled, (state, action) => {
        state.layouts.push(action.payload);
      })
      .addCase(deleteDiagramLayout.fulfilled, (state, action) => {
        state.layouts = state.layouts.filter((l) => l.id !== action.payload);
      });
  },
});

export const { clearCurrentDiagram } = diagramSlice.actions;
export default diagramSlice.reducer;
