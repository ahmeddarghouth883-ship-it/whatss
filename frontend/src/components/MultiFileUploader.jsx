import { useState, useRef } from 'react'
import toast from 'react-hot-toast'
import api from '../api/client'

const ACCEPT = [
  'image/jpeg','image/png','image/gif','image/webp',
  'video/mp4','video/quicktime','video/webm',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv',
].join(',')

const MAX_FILES = 5
const MAX_SIZE  = 64 * 1024 * 1024

function formatBytes(b) {
  if (b < 1024)        return `${b} B`
  if (b < 1024 * 1024) return `${(b/1024).toFixed(1)} KB`
  return `${(b/1024/1024).toFixed(1)} MB`
}

function typeOf(mime) {
  if (!mime) return 'document'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'document'
}

function FileChip({ file, onRemove }) {
  const t = typeOf(file.mimetype)
  const icon = t === 'image' ? '🖼' : t === 'video' ? '🎬' : '📄'
  return (
    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5 text-xs group">
      <span>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-gray-700 max-w-[140px]">{file.originalName}</p>
        <p className="text-gray-400">{formatBytes(file.size)}</p>
      </div>
      {t === 'image' && (
        <img src={file.url} alt="" className="w-8 h-8 object-cover rounded border border-green-100 flex-shrink-0" />
      )}
      <button
        type="button"
        onClick={() => onRemove(file)}
        className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0 text-base leading-none ml-1"
        title="Remove"
      >
        ×
      </button>
    </div>
  )
}

/**
 * MultiFileUploader
 *
 * Props:
 *   files    — array of { url, filename, originalName, mimetype, size }
 *   onChange — called with new array
 *   max      — max number of files (default 5)
 */
export default function MultiFileUploader({ files = [], onChange, max = MAX_FILES }) {
  const [uploading, setUploading] = useState(false)
  const [progress,  setProgress]  = useState(0)
  const [dragging,  setDragging]  = useState(false)
  const inputRef = useRef(null)

  async function handleFiles(fileList) {
    const toUpload = Array.from(fileList)
    const remaining = max - files.length
    if (remaining <= 0) return toast.error(`Max ${max} files allowed`)
    const subset = toUpload.slice(0, remaining)
    if (toUpload.length > remaining) toast(`Only uploading first ${remaining} file(s)`)

    for (const file of subset) {
      if (file.size > MAX_SIZE) { toast.error(`${file.name} too large (max 64 MB)`); continue }
    }

    const fd = new FormData()
    subset.forEach(f => fd.append('files', f))
    setUploading(true)
    setProgress(0)
    try {
      const res = await api.post('/upload/multi', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => { if (e.total) setProgress(Math.round(e.loaded / e.total * 100)) },
      })
      onChange([...files, ...res.data.files])
      toast.success(`${res.data.files.length} file(s) uploaded`)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed')
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  function onInputChange(e) {
    handleFiles(e.target.files)
    e.target.value = ''
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  function removeFile(file) {
    api.delete(`/upload/${file.filename}`).catch(() => {})
    onChange(files.filter(f => f.filename !== file.filename))
  }

  return (
    <div className="space-y-2">
      {/* Chips of already-uploaded files */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map(f => (
            <FileChip key={f.filename} file={f} onRemove={removeFile} />
          ))}
        </div>
      )}

      {/* Drop zone (hidden when max reached) */}
      {files.length < max && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => !uploading && inputRef.current?.click()}
          onKeyDown={e => e.key === 'Enter' && !uploading && inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={[
            'border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all select-none',
            dragging     ? 'border-green-400 bg-green-50'
            : uploading  ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
            : 'border-gray-200 hover:border-green-300 hover:bg-gray-50',
          ].join(' ')}
        >
          {uploading ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-400">Uploading…</p>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div className="h-1.5 bg-green-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-gray-400">{progress}%</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                {dragging ? 'Drop files here' : (
                  <>Drop files here or <span className="text-green-600 font-medium">browse</span></>
                )}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Images · Videos · PDF · Word · Excel · up to 64 MB each · max {max} files
                {files.length > 0 && ` · ${max - files.length} more`}
              </p>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  )
}
