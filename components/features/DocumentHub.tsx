'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type Department = 'marketing' | 'warehouse' | 'operations' | 'technical' | 'executive' | 'admin';

type AppDocument = {
  id: string;
  department: Department;
  branch: Branch | null;
  title: string;
  description: string | null;
  file_bucket: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
};

export function DocumentHub({ department, branch }: { department: Department; branch?: Branch | 'all' }) {
  const { businessUser } = useAuth();
  const [documents, setDocuments] = useState<AppDocument[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDocuments() {
    setLoading(true);
    setError(null);
    let query = getSupabaseClient()
      .from('app_documents')
      .select('*')
      .eq('department', department)
      .order('created_at', { ascending: false });

    if (branch && branch !== 'all') query = query.eq('branch', branch);

    const { data, error: loadError } = await query;
    if (loadError) setError(loadError.message);
    else setDocuments((data ?? []) as AppDocument[]);
    setLoading(false);
  }

  useEffect(() => {
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department, branch]);

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !businessUser) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    const bucket = 'dallmayrerp-documents';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${department}/${branch ?? 'national'}/${Date.now()}-${safeName}`;
    const client = getSupabaseClient();

    const { error: uploadError } = await client.storage.from(bucket).upload(path, file, { upsert: false });
    if (uploadError) {
      setSaving(false);
      setError(uploadError.message);
      return;
    }

    const { error: insertError } = await client.from('app_documents').insert({
      department,
      branch: branch === 'all' ? null : branch ?? null,
      title: title.trim() || file.name,
      description: description.trim() || null,
      file_bucket: bucket,
      file_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      file_size: file.size,
      uploaded_by: businessUser.id,
    });

    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setTitle('');
    setDescription('');
    setFile(null);
    setMessage('Document uploaded.');
    await loadDocuments();
  }

  async function downloadDocument(document: AppDocument) {
    const { data, error: signedError } = await getSupabaseClient()
      .storage
      .from(document.file_bucket)
      .createSignedUrl(document.file_path, 60);

    if (signedError) {
      setError(signedError.message);
      return;
    }

    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="grid grid-2">
      <div className="neo-card">
        <h2>{department[0].toUpperCase() + department.slice(1)} file upload</h2>
        <p>Upload campaign documents, warehouse sheets, SOPs, route packs or branch documentation for secure sharing.</p>
        {error ? <div className="error">{error}</div> : null}
        {message ? <div className="success">{message}</div> : null}
        <form className="grid" onSubmit={uploadDocument}>
          <label>Document title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <label>File<input required type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          <button className="button pulse-button" disabled={saving} type="submit">{saving ? 'Uploading...' : 'Upload document'}</button>
        </form>
      </div>

      <div className="neo-card">
        <h2>Shared documents</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Document</th><th>Branch</th><th>Size</th><th>Action</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={4}>Loading documents...</td></tr> : documents.length === 0 ? <tr><td colSpan={4}>No documents uploaded yet.</td></tr> : documents.map((document) => (
                <tr key={document.id}>
                  <td><strong>{document.title}</strong><br />{document.file_name}</td>
                  <td>{document.branch ?? 'national'}</td>
                  <td>{document.file_size ? `${Math.round(document.file_size / 1024)} KB` : '-'}</td>
                  <td><button className="button secondary" type="button" onClick={() => downloadDocument(document)}>Download</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
