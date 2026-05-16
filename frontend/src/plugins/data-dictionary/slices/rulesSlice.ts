import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { RuleService } from '../services/RuleService';
import type { RuleListFilters } from '../services/RuleService';
import type { Rule } from '../../../types';

interface RulesState {
  /** Last full list returned by `list(...)`, used by RuleBrowserPage. */
  list: Rule[];
  /** Per-entity caches keyed by entityUuid, populated by `getRulesForEntity`. */
  byEntityUuid: Record<string, Rule[]>;
  loading: boolean;
  error: string | null;
}

const initialState: RulesState = {
  list: [],
  byEntityUuid: {},
  loading: false,
  error: null,
};

export const fetchRules = createAsyncThunk(
  'rules/fetchAll',
  async (filters: RuleListFilters | undefined) => {
    return await new RuleService().list(filters);
  },
);

export const fetchRulesForEntity = createAsyncThunk(
  'rules/fetchForEntity',
  async (entityUuid: string) => {
    const rules = await new RuleService().getRulesForEntity(entityUuid);
    return { entityUuid, rules };
  },
);

export const createRuleAction = createAsyncThunk(
  'rules/create',
  async (data: Partial<Rule>) => {
    return await new RuleService().create(data);
  },
);

export const updateRuleAction = createAsyncThunk(
  'rules/update',
  async ({ uuid, data }: { uuid: string; data: Partial<Rule> }) => {
    return await new RuleService().update(uuid, data);
  },
);

export const deleteRuleAction = createAsyncThunk('rules/delete', async (uuid: string) => {
  await new RuleService().delete(uuid);
  return uuid;
});

const rulesSlice = createSlice({
  name: 'rules',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchRules.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchRules.fulfilled, (state, action) => {
        state.loading = false;
        state.list = action.payload;
      })
      .addCase(fetchRules.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch rules';
      })
      .addCase(fetchRulesForEntity.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchRulesForEntity.fulfilled, (state, action) => {
        state.loading = false;
        state.byEntityUuid[action.payload.entityUuid] = action.payload.rules;
      })
      .addCase(fetchRulesForEntity.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch rules for entity';
      })
      .addCase(createRuleAction.fulfilled, (state, action) => {
        state.list.push(action.payload);
      })
      .addCase(deleteRuleAction.fulfilled, (state, action) => {
        state.list = state.list.filter((r) => r.uuid !== action.payload);
      });
  },
});

export default rulesSlice.reducer;
