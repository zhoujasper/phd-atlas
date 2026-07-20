import '../../styles/uploads.css'
import clsx from 'clsx'
import { AlertCircle, UploadCloud } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import {
  DEFAULT_UPLOAD_ALLOWED_TYPES,
  MAX_UPLOAD_FILE_SIZE,
  MAX_UPLOAD_FILES_PER_BATCH,
  filesRejectedForReason,
  formatFileSize,
  uploadAcceptValue,
  validateUploadFiles,
  type FileUploadRejection,
} from '../../fileUploads'
import { allowedFileTypesLabel } from '../../fileTypes'
import { useI18n } from '../hooks/useI18n'

function compactFileNames(files: readonly File[], limit = 3) {
  const visible = files.slice(0, limit).map((file) => file.name)
  if (files.length > limit) visible.push(`+${files.length - limit}`)
  return visible.join(', ')
}

export function FileDropzone({
  title,
  hint,
  browseLabel,
  allowedTypes = DEFAULT_UPLOAD_ALLOWED_TYPES,
  maxFileSize = MAX_UPLOAD_FILE_SIZE,
  maxFiles = MAX_UPLOAD_FILES_PER_BATCH,
  existingFileCount = 0,
  multiple = true,
  disabled = false,
  compact = false,
  className,
  onFiles,
  onRejected,
}: {
  title: string
  hint?: string
  browseLabel?: string
  allowedTypes?: readonly string[]
  maxFileSize?: number
  maxFiles?: number
  existingFileCount?: number
  multiple?: boolean
  disabled?: boolean
  compact?: boolean
  className?: string
  onFiles: (files: File[]) => void | Promise<void>
  onRejected?: (rejected: FileUploadRejection[]) => void
}) {
  const { tx, format } = useI18n()
  const inputId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const [dragActive, setDragActive] = useState(false)
  const [validationMessage, setValidationMessage] = useState('')

  const buildValidationMessage = (rejected: readonly FileUploadRejection[]) => {
    const messages: string[] = []
    const sizeFiles = filesRejectedForReason(rejected, 'size')
    const typeFiles = filesRejectedForReason(rejected, 'type')
    const countFiles = filesRejectedForReason(rejected, 'count')
    const singleFiles = filesRejectedForReason(rejected, 'single')

    if (sizeFiles.length > 0) {
      messages.push(format(tx('fileUpload.filesTooLarge'), {
        names: compactFileNames(sizeFiles),
        size: formatFileSize(maxFileSize),
      }))
    }
    if (typeFiles.length > 0) {
      messages.push(format(tx('fileUpload.filesWrongType'), {
        names: compactFileNames(typeFiles),
        types: allowedFileTypesLabel(allowedTypes, tx('fileUpload.supportedTypes')),
      }))
    }
    if (singleFiles.length > 0) messages.push(tx('fileUpload.singleFileOnly'))
    if (countFiles.length > 0) {
      messages.push(format(tx('fileUpload.tooManyFiles'), { count: maxFiles }))
    }
    return messages.join(' ')
  }

  const processFiles = (files: FileList | readonly File[] | null) => {
    const result = validateUploadFiles(files, {
      allowedTypes,
      maxFileSize,
      maxFiles,
      existingFileCount,
      multiple,
    })
    const nextMessage = result.rejected.length > 0 ? buildValidationMessage(result.rejected) : ''
    setValidationMessage(nextMessage)
    onRejected?.(result.rejected)
    if (result.accepted.length > 0) void onFiles(result.accepted)
    if (inputRef.current) inputRef.current.value = ''
  }

  const defaultHint = multiple
    ? format(tx('fileUpload.defaultMultipleHint'), {
        count: maxFiles,
        size: formatFileSize(maxFileSize),
      })
    : format(tx('fileUpload.defaultSingleHint'), { size: formatFileSize(maxFileSize) })

  return (
    <div className={clsx('file-dropzone-shell', compact && 'compact', className)}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="hidden-input"
        accept={uploadAcceptValue(allowedTypes)}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => processFiles(event.currentTarget.files)}
      />
      <button
        type="button"
        className={clsx('file-dropzone', dragActive && 'dragging')}
        disabled={disabled}
        aria-describedby={validationMessage ? errorId : undefined}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          if (disabled) return
          dragDepthRef.current += 1
          setDragActive(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (disabled) return
          event.dataTransfer.dropEffect = 'copy'
          setDragActive(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          if (disabled) return
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
          if (dragDepthRef.current === 0) setDragActive(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          dragDepthRef.current = 0
          setDragActive(false)
          if (!disabled) processFiles(event.dataTransfer.files)
        }}
      >
        <span className="file-dropzone-icon" aria-hidden="true"><UploadCloud size={compact ? 17 : 21} /></span>
        <span className="file-dropzone-copy">
          <strong>{dragActive ? tx('fileUpload.releaseToAdd') : title}</strong>
          <span>{hint ?? defaultHint}</span>
          {hint ? <small>{defaultHint}</small> : null}
        </span>
        <span className="file-dropzone-browse">{browseLabel ?? tx(multiple ? 'fileUpload.chooseFiles' : 'fileUpload.chooseFile')}</span>
      </button>
      {validationMessage ? (
        <p id={errorId} className="file-dropzone-error" role="alert">
          <AlertCircle size={12} aria-hidden="true" />
          {validationMessage}
        </p>
      ) : null}
    </div>
  )
}
