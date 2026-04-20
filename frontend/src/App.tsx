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
import RuleBrowserPage from './pages/RuleBrowserPage';
import IntegrityPage from './pages/IntegrityPage';
import LogicalDiffPage from './pages/LogicalDiffPage';
import PhysicalDiffPage from './pages/PhysicalDiffPage';
import VisualizationPage from './pages/VisualizationPage';
import PerspectiveListPage from './pages/PerspectiveListPage';
import PerspectiveDetailPage from './pages/PerspectiveDetailPage';
import PerspectiveCreatePage from './pages/PerspectiveCreatePage';

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

// Package Navigation
import PackageRouter from './components/PackageRouter';
import OrganizationDiagramPage from './pages/OrganizationDiagramPage';

// Auth Guard Component
import AuthGuard from './components/AuthGuard';
import { useAppMode } from './hooks/useAppMode';
import { Navigate } from 'react-router-dom';

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

        
        {/* Perspectives */}
        <Route path="perspectives">
          <Route index element={<PerspectiveListPage />} />
          <Route path="create" element={
            <AuthGuard roles={['admin', 'editor']}><PerspectiveCreatePage /></AuthGuard>
          } />
          <Route path=":id" element={<PerspectiveDetailPage />} />
          <Route path=":id/edit" element={
            <AuthGuard roles={['admin', 'editor']}><PerspectiveCreatePage /></AuthGuard>
          } />
        </Route>

        {/* Organization Diagram */}
        <Route path="diagram" element={<OrganizationDiagramPage />} />

        {/* Visualization — per-entity, per-service, or perspective overlay */}
        <Route path="visualization" element={<VisualizationPage />} />
        <Route path="visualization/:service" element={<VisualizationPage />} />
        <Route path="visualization/:service/:entity" element={<VisualizationPage />} />

        {/* Import/Export + Quality */}
        <Route path="import-export" element={<ImportExportPage />} />
        <Route path="quality" element={<QualityDashboardPage />} />

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
        
        {/* 404 - Not Found */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;