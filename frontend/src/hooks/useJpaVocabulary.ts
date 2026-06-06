import { useEffect, useState } from 'react';
import { jpaApi, type JpaVocabulary } from '../services/api';

// Module-level cache + in-flight promise so the vocabulary (small + static) is
// fetched once per session and shared by every JPA editor panel.
let cached: JpaVocabulary | null = null;
let inflight: Promise<JpaVocabulary> | null = null;

/** Fetch the reserved jpa.* vocabulary (GET /api/jpa/vocabulary), cached. */
export function useJpaVocabulary(): JpaVocabulary | null {
  const [vocab, setVocab] = useState<JpaVocabulary | null>(cached);

  useEffect(() => {
    if (cached) { setVocab(cached); return; }
    let cancelled = false;
    if (!inflight) inflight = jpaApi.getVocabulary().then(v => { cached = v; return v; });
    inflight
      .then(v => { if (!cancelled) setVocab(v); })
      .catch(() => { if (!cancelled) setVocab(null); });
    return () => { cancelled = true; };
  }, []);

  return vocab;
}
