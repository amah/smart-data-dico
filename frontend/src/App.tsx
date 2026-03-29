import { Routes, Route } from 'react-router-dom';
import ShellLayout from './plugins/shell/ShellLayout';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import CreateDictionaryPage from './pages/CreateDictionaryPage';
import EntityDiagramPage from './pages/EntityDiagramPage';
import OrganizationDiagramPage from './pages/OrganizationDiagramPage';
import StereotypesPage from './pages/StereotypesPage';
import PerspectiveListPage from './pages/PerspectiveListPage';
import PerspectiveDetailPage from './pages/PerspectiveDetailPage';
import PerspectiveCreatePage from './pages/PerspectiveCreatePage';

// Service and Entity Components
import ServiceList from './components/ServiceList';
import EntityList from './components/EntityList';
import EntityDetail from './components/EntityDetail';
import AttributeEditor from './components/AttributeEditor';
import RelationshipEditor from './components/RelationshipEditor';

// Visualization Component
import CytoscapeGraph from './components/CytoscapeGraph';

// Search Component
import SearchComponent from './components/SearchComponent';
import EntityFlatTable from './components/EntityFlatTable';
import EntityHierarchyView from './components/EntityHierarchyView';
import PackageFlatTable from './components/PackageFlatTable';
import AttributeFlatTable from './components/AttributeFlatTable';
import EntityTreeTable from './components/EntityTreeTable';

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

        {/* Services (legacy — redirects to /packages/) */}
        <Route path="services">
          <Route index element={<ServiceList />} />
          <Route path=":service">
            <Route index element={<EntityList />} />
            <Route path="entities">
              <Route index element={<EntityList />} />
              <Route path=":entity">
                <Route index element={<EntityDetail />} />
                <Route path="edit" element={
                  <AuthGuard roles={['admin', 'editor']}>
                    <EntityDetail />
                  </AuthGuard>
                } />
                <Route path="hierarchy" element={<EntityHierarchyView />} />
                <Route path="attributes">
                  <Route path="create" element={
                    <AuthGuard roles={['admin', 'editor']}>
                      <AttributeEditor />
                    </AuthGuard>
                  } />
                  <Route path=":attribute/edit" element={
                    <AuthGuard roles={['admin', 'editor']}>
                      <AttributeEditor isEdit={true} />
                    </AuthGuard>
                  } />
                </Route>
                <Route path="relationships">
                  <Route path="create" element={
                    <AuthGuard roles={['admin', 'editor']}>
                      <RelationshipEditor />
                    </AuthGuard>
                  } />
                  <Route path=":relationship/edit" element={
                    <AuthGuard roles={['admin', 'editor']}>
                      <RelationshipEditor isEdit={true} />
                    </AuthGuard>
                  } />
                </Route>
              </Route>
              <Route path="create" element={<EntityDetail />} />
            </Route>
          </Route>
          <Route path="create" element={
            <AuthGuard roles={['admin']}>
              <ServiceList />
            </AuthGuard>
          } />
        </Route>
        
        {/* Visualization */}
        <Route path="visualization">
          <Route index element={<CytoscapeGraph />} />
          <Route path=":service" element={<CytoscapeGraph />} />
          <Route path=":service/:entity" element={<CytoscapeGraph />} />
        </Route>

        {/* Entity Diagram Editor */}
        <Route path="diagram">
          <Route index element={<EntityDiagramPage />} />
          <Route path=":service" element={<EntityDiagramPage />} />
          <Route path=":service/:entity" element={<CytoscapeGraph />} />
        </Route>
        
        {/* Organization Class Diagram */}
        <Route path="organization-diagram" element={<OrganizationDiagramPage />} />
        
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
        <Route path="tree/hierarchy" element={<EntityTreeTable />} />
        <Route path="version">
          <Route path="history" element={<CommitHistory />} />
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