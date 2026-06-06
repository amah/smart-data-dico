import { useEffect, useState } from 'react';
import { ormApi, type OrmVocabulary } from '../services/api';

// Module-level cache + in-flight promise so the vocabulary (small + static) is
// fetched once per session and shared by every ORM editor panel.
let cached: OrmVocabulary | null = null;
let inflight: Promise<OrmVocabulary> | null = null;

/** Fetch the reserved orm.* vocabulary (GET /api/orm/vocabulary), cached. */
export function useOrmVocabulary(): OrmVocabulary | null {
  const [vocab, setVocab] = useState<OrmVocabulary | null>(cached);

  useEffect(() => {
    if (cached) { setVocab(cached); return; }
    let cancelled = false;
    if (!inflight) inflight = ormApi.getVocabulary().then(v => { cached = v; return v; });
    inflight
      .then(v => { if (!cancelled) setVocab(v); })
      .catch(() => { if (!cancelled) setVocab(null); });
    return () => { cancelled = true; };
  }, []);

  return vocab;
}
