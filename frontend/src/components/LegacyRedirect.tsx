import { Navigate, useParams } from 'react-router-dom';

export default function LegacyRedirect() {
  const params = useParams();
  const wildcard = params['*'] || '';

  // Redirect /services/* to /packages/*
  return <Navigate to={`/packages/${wildcard}`} replace />;
}
