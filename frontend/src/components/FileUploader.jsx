import { useState, useRef } from 'react'
import toast from 'react-hot-toast'
import api from '../api/client'

// ── Icons ─────────────────────────────────────────────────────────────────────
function ImageIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function VideoIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="7" width="15" height="10" rx="2" />
      <path d="m17 9 5-3v12l-5-3V9z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function DocIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" />
    </svg>
  )
}
function UploadIcon() {
  return (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m17 8-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getFileIcon(fileType) {
  if (fileType === 'image')   return <ImageIcon />
  if (fileType === 'video')   return <VideoIcon />
  return <DocIcon />
}

function getAccept() {
  return [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv',
  ].join(',')
}

// ── Main component ────────────────────────────────────────────────────────────
/**
 * FileUploader — drag-drop or click-to-browse file uploader.
 *
 * Props:
 *   value   — { url, filename, originalName, mimetype, size, fileType } | null
 *   onChange — called with the above object on upload, or null on remove
 */
export default function FileUploader({ value, onChange }) {
  const [uploading,  setUploading]  = useState(false)
  const [progress,   setProgress]   = useState(0)
  const [dragging,   setDragging]   = useState(false)
  const inputRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    if (file.size > 64 * 1024 * 1024) {
      toast.error('File too large — max 64 MB')
      return
    }

    setUploading(true)
    setProgress(0)

    const fd = new FormData()
    fd.append('file', file)

    try {
      const res = await api.post('/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100))
        },
      })
      onChange(res.data)
      toast.success('File uploaded!')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed')
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  function onInputChange(e) {
    handleFile(e.target.files?.[0])
    e.target.value = ''        // allow re-selecting the same file
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  async function removeFile() {
    if (value?.filename) {
      // Fire-and-forget cleanup
      api.delete(`/upload/${value.filename}`).catch(() => {})
    }
    onChange(null)
  }

  // ── Preview (file already uploaded) ────────────────────────────────────────
  if (value) {
    const isImage = value.fileType === 'image'
    const isVideo = value.fileType === 'video'

    return (
      <div className="border border-green-200 bg-green-50 rounded-xl p-3 flex items-start gap-3">
        {/* Thumbnail */}
        <div className="flex-shrink-0">
          {isImage ? (
            <img
              src={value.url}
              alt={value.originalName}
              className="w-14 h-14 object-cover rounded-lg border border-green-100"
            />
          ) : isVideo ? (
            <video
              src={value.url}
              className="w-14 h-14 object-cover rounded-lg border border-green-100"
              muted
            />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-white border border-green-100 flex items-center justify-center text-green-500">
              {getFileIcon(value.fileType)}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{value.originalName}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {value.fileType} · {formatBytes(value.size)}
          </p>
          <p className="text-xs text-green-600 mt-0.5 font-mono truncate">{value.url}</p>
        </div>

        {/* Remove */}
        <button
          type="button"
          onClick={removeFile}
          className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Remove file"
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    )
  }

  // ── Drop zone ───────────────────────────────────────────────────────────────
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={e => e.key === 'Enter' && !uploading && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all select-none',
          dragging
            ? 'border-green-400 bg-green-50'
            : uploading
              ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
              : 'border-gray-200 hover:border-green-300 hover:bg-gray-50',
        ].join(' ')}
      >
        {uploading ? (
          <div className="space-y-2">
            <div className="text-gray-400 text-sm">Uploading…</div>
            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 bg-green-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-400">{progress}%</div>
          </div>
        ) : (
          <>
            <div className="flex justify-center mb-2 text-gray-300">
              <UploadIcon />
            </div>
            <p className="text-sm text-gray-500">
              {dragging ? 'Drop to upload' : 'Drop a file here, or '}
              {!dragging && (
                <span className="text-green-600 font-medium">browse</span>
              )}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Images · Videos · PDF · Word · Excel · PowerPoint · up to 64 MB
            </p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={getAccept()}
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  )
}
