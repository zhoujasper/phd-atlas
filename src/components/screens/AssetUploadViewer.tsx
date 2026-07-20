import { CheckCircle2, FileText, Lock, UploadCloud } from 'lucide-react'
import { useEffect, useState } from 'react'
import { phdApi } from '../../api/phdApi'
import { normalizeErrorMessage } from '../../errorMessages'
import {
  DEFAULT_UPLOAD_ALLOWED_TYPES,
  MAX_UPLOAD_FILE_SIZE,
  MAX_UPLOAD_FILES_PER_BATCH,
  formatFileSize,
} from '../../fileUploads'
import { useI18n } from '../hooks/useI18n'
import { FileDropzone } from '../shared/FileDropzone'
import { LaunchScreen } from '../shared/LaunchScreen'

export function AssetUploadViewer({ token }: { token: string }) {
  const { tx, format, lang } = useI18n()
  const [info, setInfo] = useState<{ assetName: string; note: string; attachmentCount: number; allowedFileTypes?: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; size: number }>>([])

  useEffect(() => {
    let ignore = false
    setLoading(true)
    phdApi
      .getAssetUploadInfo(token)
      .then((payload) => {
        if (!ignore) setInfo(payload)
      })
      .catch((err: unknown) => {
        if (!ignore) setError(normalizeErrorMessage(err, lang, tx('assetUpload.loadFailed')))
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [token, tx, lang])

  const handleUpload = async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      const result = await phdApi.uploadFilesToAssetShare(token, files)
      setUploadedFiles(files.map((file) => ({ name: file.name, size: file.size })))
      setInfo((current) => (current
        ? { ...current, attachmentCount: result.attachmentCount ?? current.attachmentCount + files.length }
        : current))
    } catch (err) {
      setUploadError(normalizeErrorMessage(err, lang, tx('assetUpload.uploadFailed')))
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return <LaunchScreen variant="standalone" message={tx('assetUpload.loading')} />
  }

  if (error || !info) {
    return (
      <main className="auth-canvas route-content-reveal">
        <section className="auth-sheet" aria-label={tx('assetUpload.accessDenied')}>
          <div className="auth-mark">
            <Lock size={24} aria-hidden="true" />
          </div>
          <h1>{tx('assetUpload.accessDenied')}</h1>
          <p>{error ?? tx('assetUpload.loadFailed')}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="share-viewer route-content-reveal">
      <header className="share-header">
        <UploadCloud size={28} aria-hidden="true" />
        <h1>{tx('assetUpload.title')}</h1>
        <p>{tx('assetUpload.subtitle')}</p>
      </header>

      <div className="share-content asset-upload-content">
        <section className="section-card asset-upload-card">
          <div className="asset-upload-card-head">
            <div>
              <span className="eyebrow">{tx('assetUpload.destination')}</span>
              <h2>{info.assetName}</h2>
            </div>
            <span className="asset-upload-count">
              {format(tx(info.attachmentCount === 1 ? 'assetUpload.existingCountOne' : 'assetUpload.existingCountMany'), { count: info.attachmentCount })}
            </span>
          </div>

          {info.note ? (
            <div className="asset-upload-note">
              <span className="eyebrow">{tx('assetUpload.note')}</span>
              <p>{info.note}</p>
            </div>
          ) : null}

          <FileDropzone
            title={uploading ? tx('assetUpload.uploading') : tx('assetUpload.dropTitle')}
            hint={tx('assetUpload.dropHint')}
            browseLabel={tx('assetUpload.chooseFiles')}
            allowedTypes={(info.allowedFileTypes && info.allowedFileTypes.length > 0)
              ? info.allowedFileTypes
              : DEFAULT_UPLOAD_ALLOWED_TYPES}
            maxFileSize={MAX_UPLOAD_FILE_SIZE}
            maxFiles={MAX_UPLOAD_FILES_PER_BATCH}
            disabled={uploading}
            onFiles={handleUpload}
          />

          {uploadError ? <p className="settings-inline-error" role="alert">{uploadError}</p> : null}

          {uploadedFiles.length > 0 ? (
            <div className="asset-upload-success" role="status">
              <div className="asset-upload-success-head">
                <span><CheckCircle2 size={18} aria-hidden="true" /></span>
                <div>
                  <strong>
                    {format(tx(uploadedFiles.length === 1 ? 'assetUpload.successCountOne' : 'assetUpload.successCountMany'), { count: uploadedFiles.length })}
                  </strong>
                  <small>{tx('assetUpload.uploadAnother')}</small>
                </div>
              </div>
              <div className="asset-upload-file-list">
                {uploadedFiles.map((file) => (
                  <div key={`${file.name}-${file.size}`} className="asset-upload-file-row">
                    <FileText size={14} aria-hidden="true" />
                    <span>{file.name}</span>
                    <em>{formatFileSize(file.size)}</em>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}
