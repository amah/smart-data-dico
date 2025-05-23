import { Link } from 'react-router-dom'

const NotFoundPage = () => {
  return (
    <div className="hero min-h-[70vh] bg-base-200 rounded-lg">
      <div className="hero-content text-center">
        <div className="max-w-md">
          <h1 className="text-5xl font-bold">404</h1>
          <h2 className="text-2xl mt-4">Page Not Found</h2>
          <p className="py-6">
            The page you are looking for doesn't exist or has been moved.
          </p>
          <Link to="/" className="btn btn-primary">
            Go Home
          </Link>
        </div>
      </div>
    </div>
  )
}

export default NotFoundPage