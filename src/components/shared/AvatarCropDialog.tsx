import {
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  RotateCw,
  Scan,
  Trash2,
  Upload,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'
import { UserAvatar } from './UserAvatar'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const OUTPUT_SIZE = 512
const MIN_ZOOM = 1
const MAX_ZOOM = 3

type ImageSize = { width: number; height: number }
type Point = { x: number; y: number }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read-failed'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}

function decodeImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('decode-failed'))
    image.src = source
  })
}

export function AvatarCropDialog({
  open,
  currentAvatar,
  name,
  email,
  onClose,
  onSave,
}: {
  open: boolean
  currentAvatar?: string | null
  name: string
  email: string
  onClose: () => void
  onSave: (avatarDataUrl: string) => Promise<boolean | void> | boolean | void
}) {
  const { tx } = useI18n()
  const titleId = useId()
  const descriptionId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chooseButtonRef = useRef<HTMLButtonElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const decodedImageRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{ pointerId: number; start: Point; origin: Point } | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<ImageSize | null>(null)
  const [stageSize, setStageSize] = useState(320)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { exiting, requestClose } = useAnimatedClose(open, onClose)
  const dialogRef = useModalA11y<HTMLDivElement>({
    open: open && !exiting,
    onClose: () => {
      if (!busy) requestClose(onClose)
    },
    initialFocusRef: chooseButtonRef,
  })

  const baseScale = useMemo(() => {
    if (!imageSize) return 1
    return Math.max(stageSize / imageSize.width, stageSize / imageSize.height)
  }, [imageSize, stageSize])

  const offsetBounds = useCallback((nextZoom = zoom, nextRotation = rotation) => {
    if (!imageSize) return { x: 0, y: 0 }
    const quarterTurn = Math.abs(nextRotation / 90) % 2 === 1
    const width = (quarterTurn ? imageSize.height : imageSize.width) * baseScale * nextZoom
    const height = (quarterTurn ? imageSize.width : imageSize.height) * baseScale * nextZoom
    return {
      x: Math.max(0, (width - stageSize) / 2),
      y: Math.max(0, (height - stageSize) / 2),
    }
  }, [baseScale, imageSize, rotation, stageSize, zoom])

  const clampOffset = useCallback((point: Point, nextZoom = zoom, nextRotation = rotation) => {
    const bounds = offsetBounds(nextZoom, nextRotation)
    return {
      x: clamp(point.x, -bounds.x, bounds.x),
      y: clamp(point.y, -bounds.y, bounds.y),
    }
  }, [offsetBounds, rotation, zoom])

  const installSource = useCallback(async (nextSource: string) => {
    setError('')
    try {
      const image = await decodeImage(nextSource)
      decodedImageRef.current = image
      setSource(nextSource)
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight })
      setZoom(MIN_ZOOM)
      setRotation(0)
      setOffset({ x: 0, y: 0 })
    } catch {
      setError(tx('settings.avatarInvalidImage'))
    }
  }, [tx])

  useEffect(() => {
    if (!open) return
    setBusy(false)
    setError('')
    setDragOver(false)
    setDragging(false)
    if (currentAvatar) {
      void installSource(currentAvatar)
    } else {
      decodedImageRef.current = null
      setSource(null)
      setImageSize(null)
      setZoom(MIN_ZOOM)
      setRotation(0)
      setOffset({ x: 0, y: 0 })
    }
  }, [currentAvatar, installSource, open])

  useEffect(() => {
    const stage = stageRef.current
    if (!open || !stage) return undefined
    // clientWidth is the content box the image is laid out in (excludes border),
    // matching createCroppedAvatar's coordinate space more closely than border-box.
    const update = () => setStageSize(stage.clientWidth || stage.getBoundingClientRect().width || 320)
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [open, source])

  useEffect(() => {
    setOffset((current) => clampOffset(current))
  }, [clampOffset, stageSize])

  const acceptFile = useCallback(async (file?: File) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(tx('settings.avatarFileType'))
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(tx('settings.avatarFileSize'))
      return
    }
    try {
      await installSource(await readFile(file))
    } catch {
      setError(tx('settings.avatarInvalidImage'))
    }
  }, [installSource, tx])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void acceptFile(event.target.files?.[0])
    event.target.value = ''
  }

  const updateZoom = (nextZoom: number) => {
    const resolved = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    setOffset((current) => clampOffset(current, resolved, rotation))
    setZoom(resolved)
  }

  const rotate = (delta: number) => {
    const nextRotation = (rotation + delta + 360) % 360
    setOffset((current) => clampOffset(current, zoom, nextRotation))
    setRotation(nextRotation)
  }

  const resetCrop = () => {
    setZoom(MIN_ZOOM)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!source || busy) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: offset,
    }
    setDragging(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setOffset(clampOffset({
      x: drag.origin.x + event.clientX - drag.start.x,
      y: drag.origin.y + event.clientY - drag.start.y,
    }))
  }

  const endPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!source) return
    event.preventDefault()
    updateZoom(zoom + (event.deltaY > 0 ? -0.08 : 0.08))
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    void acceptFile(event.dataTransfer.files?.[0])
  }

  /**
   * Export the full stage viewport (1:1 with the rounded-square guide), so
   * the saved image and every rendered avatar share the same silhouette.
   */
  const createCroppedAvatar = () => {
    const image = decodedImageRef.current
    if (!image || !imageSize || stageSize <= 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const context = canvas.getContext('2d')
    if (!context) return null
    // Map the square stage CSS pixels to the square output bitmap.
    const ratio = OUTPUT_SIZE / stageSize
    context.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    context.save()
    // Match the CSS pipeline: center + pan, rotate, then cover-scale.
    context.translate(OUTPUT_SIZE / 2 + offset.x * ratio, OUTPUT_SIZE / 2 + offset.y * ratio)
    context.rotate((rotation * Math.PI) / 180)
    const outputScale = baseScale * zoom * ratio
    context.scale(outputScale, outputScale)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, -imageSize.width / 2, -imageSize.height / 2)
    context.restore()
    return canvas.toDataURL('image/webp', 0.9)
  }

  const save = async () => {
    const cropped = createCroppedAvatar()
    if (!cropped) return
    setBusy(true)
    const saved = await onSave(cropped)
    setBusy(false)
    if (saved !== false) requestClose(onClose)
  }

  const remove = async () => {
    setBusy(true)
    const saved = await onSave('')
    setBusy(false)
    if (saved !== false) requestClose(onClose)
  }

  if (!open) return null

  const imageTransform = imageSize
    ? {
        left: `calc(50% + ${offset.x}px)`,
        top: `calc(50% + ${offset.y}px)`,
        width: `${imageSize.width}px`,
        height: `${imageSize.height}px`,
        transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${baseScale * zoom})`,
      }
    : undefined
  const previewRatio = 88 / stageSize
  const previewImageTransform = imageSize
    ? {
        left: `calc(50% + ${offset.x * previewRatio}px)`,
        top: `calc(50% + ${offset.y * previewRatio}px)`,
        width: `${imageSize.width}px`,
        height: `${imageSize.height}px`,
        transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${baseScale * zoom * previewRatio})`,
      }
    : undefined

  return (
    <ModalPortal>
      <div
        className={`dialog-layer avatar-crop-layer${exiting ? ' exiting' : ''}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) requestClose(onClose)
        }}
      >
        <div
          ref={dialogRef}
          className="avatar-crop-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <header className="avatar-crop-header">
            <div>
              <span className="eyebrow">{tx('settings.avatarEyebrow')}</span>
              <h3 id={titleId}>{tx('settings.avatarTitle')}</h3>
              <p id={descriptionId}>{tx('settings.avatarDescription')}</p>
            </div>
            <button
              type="button"
              className="avatar-crop-close"
              aria-label={tx('close')}
              disabled={busy}
              onClick={() => requestClose(onClose)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="avatar-crop-body">
            <div className="avatar-crop-workspace">
              <div className="avatar-crop-toolbar">
                <button ref={chooseButtonRef} type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                  <ImagePlus size={15} aria-hidden="true" />
                  {source ? tx('settings.avatarReplace') : tx('settings.avatarChoose')}
                </button>
                <span className="avatar-crop-toolbar-divider" aria-hidden="true" />
                <button type="button" aria-label={tx('settings.avatarRotateLeft')} title={tx('settings.avatarRotateLeft')} onClick={() => rotate(-90)} disabled={!source || busy}>
                  <RotateCcw size={15} aria-hidden="true" />
                </button>
                <button type="button" aria-label={tx('settings.avatarRotateRight')} title={tx('settings.avatarRotateRight')} onClick={() => rotate(90)} disabled={!source || busy}>
                  <RotateCw size={15} aria-hidden="true" />
                </button>
                <button type="button" aria-label={tx('settings.avatarReset')} title={tx('settings.avatarReset')} onClick={resetCrop} disabled={!source || busy}>
                  <Scan size={15} aria-hidden="true" />
                </button>
              </div>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
              />

              <div
                ref={stageRef}
                className={`avatar-crop-stage${dragging ? ' is-dragging' : ''}${dragOver ? ' is-drag-over' : ''}${source ? ' has-image' : ''}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endPointerDrag}
                onPointerCancel={endPointerDrag}
                onDoubleClick={resetCrop}
                onWheel={handleWheel}
                onDragEnter={(event) => { event.preventDefault(); setDragOver(true) }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false)
                }}
                onDrop={handleDrop}
              >
                {source ? (
                  <>
                    <img className="avatar-crop-image" src={source} alt="" draggable={false} style={imageTransform} />
                    <span className="avatar-crop-mask" aria-hidden="true" />
                    <span className="avatar-crop-grid" aria-hidden="true" />
                    <span className="avatar-crop-drag-hint" aria-hidden="true">{tx('settings.avatarDragHint')}</span>
                  </>
                ) : (
                  <button type="button" className="avatar-crop-empty" onClick={() => fileInputRef.current?.click()}>
                    <span><Upload size={22} aria-hidden="true" /></span>
                    <strong>{tx('settings.avatarDropTitle')}</strong>
                    <small>{tx('settings.avatarDropDescription')}</small>
                  </button>
                )}
              </div>

              <div className="avatar-crop-zoom">
                <ZoomOut size={15} aria-hidden="true" />
                <input
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step="0.01"
                  value={zoom}
                  disabled={!source || busy}
                  aria-label={tx('settings.avatarZoom')}
                  onChange={(event) => updateZoom(Number(event.target.value))}
                />
                <ZoomIn size={17} aria-hidden="true" />
              </div>
              {error ? <p className="avatar-crop-error" role="alert">{error}</p> : null}
            </div>

            <aside className="avatar-crop-preview-panel">
              <span className="eyebrow">{tx('settings.avatarPreview')}</span>
              {source ? (
                <span className="avatar-crop-preview" aria-hidden="true">
                  <img src={source} alt="" draggable={false} style={previewImageTransform} />
                </span>
              ) : (
                <UserAvatar
                  avatarUrl={currentAvatar}
                  name={name}
                  email={email}
                  className="avatar-crop-preview"
                />
              )}
              <strong>{name}</strong>
              <small>{email}</small>
              <div className="avatar-crop-sharing-note">
                <Users size={15} aria-hidden="true" />
                <span>
                  <strong>{tx('settings.avatarSharedTitle')}</strong>
                  <small>{tx('settings.avatarSharedDescription')}</small>
                </span>
              </div>
              <p>{tx('settings.avatarFormatHint')}</p>
            </aside>
          </div>

          <footer className="avatar-crop-footer">
            <div>
              {currentAvatar ? (
                <button type="button" className="avatar-remove-action" onClick={remove} disabled={busy}>
                  <Trash2 size={15} aria-hidden="true" />
                  {tx('settings.avatarRemove')}
                </button>
              ) : null}
            </div>
            <div className="avatar-crop-footer-actions">
              <button type="button" className="quiet-action" onClick={() => requestClose(onClose)} disabled={busy}>
                {tx('cancel')}
              </button>
              <button type="button" className="primary-action" onClick={save} disabled={!source || busy}>
                {busy ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}
                {busy ? tx('settings.avatarSaving') : tx('settings.avatarSave')}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}
