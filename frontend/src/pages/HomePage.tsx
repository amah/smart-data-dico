import { Link } from 'react-router-dom'

const HomePage = () => {
  return (
    <div className="hero min-h-[70vh] bg-base-200 rounded-lg">
      <div className="hero-content text-center">
        <div className="max-w-md">
          <h1 className="text-5xl font-bold">Data Dictionary Management System</h1>
          <p className="py-6">
            A comprehensive solution for managing data dictionaries across your organization.
            Create, edit, and share data dictionaries with ease.
          </p>
          <div className="flex justify-center gap-4">
            <Link to="/dictionaries" className="btn btn-primary">
              Browse Dictionaries
            </Link>
            <Link to="/create" className="btn btn-outline">
              Create New Dictionary
            </Link>
          </div>
          
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h2 className="card-title">Centralized Repository</h2>
                <p>Store all your data dictionaries in one place for easy access and management.</p>
              </div>
            </div>
            
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h2 className="card-title">Version Control</h2>
                <p>Track changes to your data dictionaries with built-in version control.</p>
              </div>
            </div>
            
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h2 className="card-title">Export & Share</h2>
                <p>Export dictionaries in various formats and share them with your team.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HomePage