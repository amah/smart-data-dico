import { useState, useEffect } from 'react';
import { servicesApi } from '../services/api';
import type { ReviewComment } from '../types';

interface ReviewCommentsProps {
  service: string;
  entityName: string;
}

export default function ReviewComments({ service, entityName }: ReviewCommentsProps) {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [newField, setNewField] = useState('');

  const fetchComments = async () => {
    try {
      const data = await servicesApi.getComments(service, entityName);
      setComments(data);
    } catch { /* ok */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchComments(); }, [service, entityName]);

  const handleAdd = async () => {
    if (!newMessage.trim()) return;
    try {
      await servicesApi.addComment(service, entityName, {
        author: 'current-user',
        message: newMessage,
        targetField: newField || undefined,
      });
      setNewMessage('');
      setNewField('');
      fetchComments();
    } catch { /* ok */ }
  };

  const handleResolve = async (commentId: string) => {
    try {
      await servicesApi.resolveComment(service, entityName, commentId);
      fetchComments();
    } catch { /* ok */ }
  };

  if (loading) return <span className="loading loading-spinner loading-sm" />;

  const unresolvedCount = comments.filter(c => !c.resolved).length;

  return (
    <div className="space-y-4">
      {unresolvedCount > 0 && (
        <div className="text-sm text-warning">{unresolvedCount} unresolved comment{unresolvedCount > 1 ? 's' : ''}</div>
      )}

      {/* Comment list */}
      <div className="space-y-2">
        {comments.length === 0 && (
          <p className="text-sm text-base-content/50">No comments yet.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className={`card bg-base-200 p-3 ${c.resolved ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between">
              <div>
                <span className="font-semibold text-sm">{c.author}</span>
                <span className="text-xs text-base-content/60 ml-2">{new Date(c.timestamp).toLocaleString()}</span>
                {c.targetField && (
                  <span className="badge badge-ghost badge-xs ml-2 font-mono">{c.targetField}</span>
                )}
              </div>
              {!c.resolved && (
                <button className="btn btn-ghost btn-xs" onClick={() => handleResolve(c.id)}>
                  Resolve
                </button>
              )}
              {c.resolved && <span className="badge badge-success badge-xs">resolved</span>}
            </div>
            <p className="text-sm mt-1">{c.message}</p>
          </div>
        ))}
      </div>

      {/* Add comment form */}
      <div className="border-t border-base-300 pt-3 space-y-2">
        <textarea
          className="textarea textarea-bordered textarea-sm w-full"
          placeholder="Add a comment..."
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          rows={2}
        />
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="input input-bordered input-sm w-48"
            placeholder="Target field (optional)"
            value={newField}
            onChange={(e) => setNewField(e.target.value)}
          />
          <button className="btn btn-sm btn-primary" onClick={handleAdd} disabled={!newMessage.trim()}>
            Add Comment
          </button>
        </div>
      </div>
    </div>
  );
}
