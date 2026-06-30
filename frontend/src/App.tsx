import { Routes, Route } from 'react-router-dom';
import ShellLayout from './plugins/shell/ShellLayout';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import CreateDictionaryPage from './pages/CreateDictionaryPage';
import StereotypesPage from './pages/StereotypesPage';
import SavePublishPage from './pages/SavePublishPage';
import WorkspacesPage from './pages/WorkspacesPage';
import MergePage from './pages/MergePage';
import ImportExportPage from './pages/ImportExportPage';
import QualityDashboardPage from './pages/QualityDashboardPage';
import RuleBrowserPage from './plugins/data-dictionary/pages/rules/RuleBrowserPage';
import IntegrityPage from './pages/IntegrityPage';
import LogicalDiffPage from './pages/LogicalDiffPage';
import PhysicalDiffPage from './pages/PhysicalDiffPage';
import VisualizationPage from './pages/VisualizationPage';
import CaseListPage from './plugins/data-dictionary/pages/cases/CaseListPage';
import CaseDetailPage from './plugins/data-dictionary/pages/cases/CaseDetailPage';
import CaseCreatePage from './plugins/data-dictionary/pages/cases/CaseCreatePage';

// Service and Entity Components
import ServiceList from './components/ServiceList';
import EntityFlatTable from './components/EntityFlatTable';
import PackageFlatTable from './components/PackageFlatTable';
import AttributeFlatTable from './components/AttributeFlatTable';

// Search Component
import SearchComponent from './components/SearchComponent';

// Version Control Components
import CommitChanges from './components/CommitChanges';
import CommitHistory from './components/CommitHistory';

// Authentication Components
import Login from './components/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import DerivedTypesPage from './pages/DerivedTypesPage';
import ReverseEngineerPage from './pages/ReverseEngineerPage';
import DesignSystemPage from './pages/DesignSystemPage';
import CommandsDebugPage from './pages/CommandsDebugPage';

// Package Navigation
import PackageRouter from './components/PackageRouter';

// Auth Guard Component
import AuthGuard from './components/AuthGuard';
import { useAppMode } from './hooks/useAppMode';
import { Navigate, useParams } from 'react-router-dom';

// Preserves the splat so /perspectives/<uuid>/edit → /cases/<uuid>/edit, etc.
function LegacyPerspectiveRedirect() {
  const params = useParams<{ '*': string }>();
  const rest = params['*'] || '';
  return <Navigate to={`/cases${rest ? '/' + rest : ''}`} replace />;
}

function App() {
  const { mode } = useAppMode();

  return (
    <Routes>
      {/* Public Routes — redirect to home in desktop mode */}
      <Route path="/login" element={mode === 'desktop' ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={mode === 'desktop' ? <Navigate to="/" replace /> : <Register />} />
      <Route path="/forgot-password" element={mode === 'desktop' ? <Navigate to="/" replace /> : <ForgotPassword />} />
      
      {/* Protected Routes */}
      <Route path="/" element={<ShellLayout />}>
        {/* Home */}
        <Route index element={<HomePage />} />
        
        {/* Dictionary */}
        <Route path="create" element={<CreateDictionaryPage />} />
        <Route path="dictionaries" element={<ServiceList />} />

        {/* Packages (nested URL routing) */}
        <Route path="packages">
          <Route index element={<ServiceList />} />
          <Route path="*" element={<PackageRouter />} />
        </Route>

        
        {/* Cases (#121 — renamed from Perspectives) */}
        <Route path="cases">
          <Route index element={<CaseListPage />} />
          <Route path="create" element={
            <AuthGuard roles={['admin', 'editor']}><CaseCreatePage /></AuthGuard>
          } />
          <Route path=":id" element={<CaseDetailPage />} />
          <Route path=":id/edit" element={
            <AuthGuard roles={['admin', 'editor']}><CaseCreatePage /></AuthGuard>
          } />
        </Route>

        {/* Legacy /perspectives/* — redirects to /cases/* for one release */}
        <Route path="perspectives" element={<Navigate to="/cases" replace />} />
        <Route path="perspectives/*" element={<LegacyPerspectiveRedirect />} />

        {/* Diagram — org-wide, per-service, per-entity, or case overlay */}
        <Route path="diagram" element={<VisualizationPage />} />
        <Route path="diagram/:service" element={<VisualizationPage />} />
        <Route path="diagram/:service/:entity" element={<VisualizationPage />} />

        {/* Import/Export + Quality */}
        <Route path="import-export" element={<ImportExportPage />} />
        <Route path="quality" element={<QualityDashboardPage />} />

        {/* Reverse-engineer (plugin owns /reverse-engineer) */}
        <Route path="reverse-engineer" element={<ReverseEngineerPage />} />

        {/* Stereotypes */}
        <Route path="stereotypes" element={<StereotypesPage />} />

        {/* Search */}
        <Route path="search" element={<SearchComponent />} />
        
        {/* Flat Views */}
        <Route path="entities/flat" element={<EntityFlatTable />} />
        <Route path="flat/packages" element={<PackageFlatTable />} />
        <Route path="flat/entities" element={<EntityFlatTable />} />
        <Route path="flat/attributes" element={<AttributeFlatTable />} />

        {/* Validation Rules (#74) — kept for back-compat; the Integrity page is the new home */}
        <Route path="rules" element={<RuleBrowserPage />} />

        {/* Integrity (#85 R5) — unified validation + constraints + rules */}
        <Route path="integrity" element={<IntegrityPage />} />

        {/* Model Diff (#86) — logical model comparison */}
        <Route path="diff/logical" element={<LogicalDiffPage />} />
        <Route path="diff/physical" element={<PhysicalDiffPage />} />

        {/* Commands Debug (#163 Phase 6) */}
        <Route path="commands" element={<CommandsDebugPage />} />

        {/* Version Control */}
        <Route path="version">
          <Route path="save" element={
            <AuthGuard roles={['admin', 'editor']}>
              <SavePublishPage />
            </AuthGuard>
          } />
          <Route path="history" element={<CommitHistory />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="merge" element={
            <AuthGuard roles={['admin', 'editor']}>
              <MergePage />
            </AuthGuard>
          } />
          <Route path="commit" element={
            <AuthGuard roles={['admin', 'editor']}>
              <CommitChanges />
            </AuthGuard>
          } />
        </Route>
        
        {/* User Profile & Settings */}
        <Route path="profile" element={
          <AuthGuard>
            <Profile />
          </AuthGuard>
        } />
        <Route path="settings" element={<Settings />} />
        <Route path="types" element={<DerivedTypesPage />} />

        {/* Living style guide — tokens + every ui/* primitive + the
            patterns that hold them together. */}
        <Route path="design-system" element={<DesignSystemPage />} />
        <Route path="design/tokens" element={<Navigate to="/design-system" replace />} />
        <Route path="design/primitives" element={<Navigate to="/design-system" replace />} />

        {/* 404 - Not Found */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;