import '../../styles/project-footer.css'
import { GitFork, GraduationCap, Heart, LoaderCircle, QrCode, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'

const PROJECT_REPOSITORY_URL = 'https://github.com/zhoujasper/phd-atlas'
const SUPPORT_METHODS = [
  {
    key: 'wechat',
    codeImage: '/assets/support/wechat-pay-qr.png',
    artImage: '/assets/support/wechat-support-art.png',
  },
  {
    key: 'alipay',
    codeImage: '/assets/support/alipay-qr.png',
    artImage: '/assets/support/alipay-support-art.png',
  },
] as const

let supportImagesPromise: Promise<void> | null = null

function warmSupportImages() {
  if (supportImagesPromise) return supportImagesPromise
  if (typeof Image === 'undefined') return Promise.resolve()

  supportImagesPromise = Promise.all(
    SUPPORT_METHODS.flatMap((method) => [method.codeImage, method.artImage]).map(
      (source) => new Promise<void>((resolve) => {
        const image = new Image()
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          const decode = typeof image.decode === 'function' ? image.decode() : null
          if (decode) {
            void decode.catch(() => undefined).finally(resolve)
            return
          }
          resolve()
        }
        image.decoding = 'async'
        image.onload = finish
        image.onerror = finish
        image.src = source
        if (image.complete) finish()
      }),
    ),
  ).then(() => undefined)

  return supportImagesPromise
}

export function ProjectFooter() {
  const { format, tx } = useI18n()
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportPreparing, setSupportPreparing] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  const footerRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const openRequestRef = useRef(0)
  const { exiting, requestClose } = useAnimatedClose(
    supportOpen,
    () => setSupportOpen(false),
  )
  const closeSupport = () => requestClose(() => setSupportOpen(false))
  const dialogRef = useModalA11y<HTMLDivElement>({
    open: supportOpen,
    onClose: closeSupport,
    initialFocusRef: closeButtonRef,
  })

  useEffect(() => {
    const footer = footerRef.current
    if (!footer || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      void warmSupportImages()
      observer.disconnect()
    }, { rootMargin: '360px' })
    observer.observe(footer)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    openRequestRef.current += 1
  }, [])

  const openSupport = useCallback(async () => {
    if (supportOpen || supportPreparing) return
    const requestId = ++openRequestRef.current
    setSupportPreparing(true)
    await warmSupportImages()
    if (openRequestRef.current !== requestId) return
    setSupportPreparing(false)
    setSupportOpen(true)
  }, [supportOpen, supportPreparing])

  return (
    <>
      <footer ref={footerRef} className="project-footer" aria-label={tx('projectFooter.ariaLabel')}>
        <div className="project-footer-inner">
          <a
            className="project-footer-brand"
            href="/"
            aria-label={tx('projectFooter.projectHome')}
          >
            <GraduationCap size={14} aria-hidden="true" />
            <strong>{tx('projectFooter.projectName')}</strong>
          </a>

          <span className="project-footer-author">
            {tx('projectFooter.by')} <strong>{tx('projectFooter.authorName')}</strong>
          </span>

          <div className="project-footer-actions">
            <a
              className="project-footer-link"
              href={PROJECT_REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={tx('projectFooter.repositoryAria')}
            >
              <GitFork size={13} aria-hidden="true" />
              <span>{tx('projectFooter.repository')}</span>
            </a>
            <button
              type="button"
              className={`project-footer-link project-footer-support${supportPreparing ? ' is-preparing' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={supportOpen}
              aria-busy={supportPreparing || undefined}
              aria-label={tx('projectFooter.supportAria')}
              onFocus={() => void warmSupportImages()}
              onClick={() => void openSupport()}
              onPointerDown={() => void warmSupportImages()}
              onPointerEnter={() => void warmSupportImages()}
            >
              {supportPreparing
                ? <LoaderCircle className="spin-icon" size={13} aria-hidden="true" />
                : <Heart size={13} aria-hidden="true" />}
              <span>{tx('projectFooter.support')}</span>
            </button>
          </div>
        </div>
      </footer>

      {supportOpen ? (
        <ModalPortal>
          <div
            className={`dialog-layer project-support-layer${exiting ? ' exiting' : ''}`}
            onClick={(event) => {
              if (event.target === event.currentTarget) closeSupport()
            }}
          >
            <div
              ref={dialogRef}
              className="project-support-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
            >
              <header className="project-support-head">
                <span className="project-support-icon" aria-hidden="true">
                  <Heart size={18} />
                </span>
                <div>
                  <h2 id={titleId}>{tx('projectFooter.dialogTitle')}</h2>
                  <p id={descriptionId}>{tx('projectFooter.dialogDescription')}</p>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="project-support-close"
                  onClick={closeSupport}
                  aria-label={tx('close')}
                  title={tx('close')}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </header>

              <div className="project-support-methods">
                {SUPPORT_METHODS.map((method) => {
                  const methodLabel = tx(`projectFooter.${method.key}`)
                  return (
                    <figure className={`project-support-method is-${method.key}`} key={method.key}>
                      <figcaption>
                        <span aria-hidden="true">
                          <QrCode size={14} />
                        </span>
                        {methodLabel}
                      </figcaption>
                      <div className="project-support-artwork">
                        <img
                          className="project-support-art-backdrop"
                          src={method.artImage}
                          alt=""
                          aria-hidden="true"
                          decoding="async"
                          draggable={false}
                        />
                        <img
                          className="project-support-code"
                          src={method.codeImage}
                          alt={format(tx('projectFooter.qrAlt'), { method: methodLabel })}
                          decoding="async"
                          draggable={false}
                        />
                      </div>
                    </figure>
                  )
                })}
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  )
}
