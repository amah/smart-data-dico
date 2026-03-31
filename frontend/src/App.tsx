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

// Package Navigation
import PackageRouter from './components/PackageRouter';

// Auth Guard Component
import AuthGuard from './components/AuthGuard';

function App() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      
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
        <Route path="settings" element={
          <AuthGuard>
            <Settings />
          </AuthGuard>
        } />
        
        {/* 404 - Not Found */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;