import { useEffect } from 'react'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { ModalPortal } from './ModalPortal'

export default function KeyboardShortcuts(props: { open: boolean; onClose: () => void }) {
  var { open, onClose } = props
  var { tx } = useI18n()
  const { exiting, requestClose } = useAnimatedClose(open, onClose)
  var SHORTCUTS = [
    {
      name: tx('shortcuts.navigation', 'Navigation'),
      shortcuts: [
        { keys: ['Ctrl', 'F'], description: tx('shortcuts.focusSearch', 'Focus search') },
        { keys: ['Ctrl', 'K'], description: tx('shortcuts.openCommandPalette') },
        { keys: ['1', '2', '3', '4', '5', '6'], description: tx('shortcuts.switchTabs', 'Switch tabs (Dossier, Checklist, Correspondence, Funding, Timeline, Review)') },
        { keys: ['G', 'D'], description: tx('shortcuts.goDashboard') },
        { keys: ['G', 'A'], description: tx('shortcuts.goApplications') },
        { keys: ['G', 'P'], description: tx('shortcuts.goProfile') },
        { keys: ['G', 'S'], description: tx('shortcuts.goSettings') },
        { keys: ['G', 'T'], description: tx('shortcuts.goTeam') },
        { keys: ['Enter'], description: tx('shortcuts.openSelected', 'Open selected item') },
        { keys: ['Esc'], description: tx('shortcuts.closeDialog', 'Close any open dialog') },
        { keys: ['?'], description: tx('shortcuts.showReference', 'Show keyboard shortcuts reference') },
      ],
    },
    {
      name: tx('shortcuts.actions', 'Actions'),
      shortcuts: [
        { keys: ['Ctrl', 'S'], description: tx('shortcuts.saveApplication', 'Save current application') },
        { keys: ['Ctrl', 'Enter'], description: tx('shortcuts.sendEmail', 'Send email (in composer)') },
        { keys: ['Ctrl', 'N'], description: tx('shortcuts.newApplication', 'New application') },
      ],
    },
    {
      name: tx('shortcuts.workspace', 'Workspace'),
      shortcuts: [
        { keys: ['Ctrl', 'B'], description: tx('shortcuts.toggleApplicationPane') },
        { keys: ['Ctrl', 'I'], description: tx('shortcuts.toggleInspectorPane') },
        { keys: ['Ctrl', 'A'], description: tx('shortcuts.selectAllApplications') },
        { keys: ['←'], description: tx('shortcuts.moveBoardCardLeft') },
        { keys: ['→'], description: tx('shortcuts.moveBoardCardRight') },
        { keys: ['Delete'], description: tx('shortcuts.deleteSelected') },
        { keys: ['Esc'], description: tx('shortcuts.clearSelection') },
      ],
    },
  ]

  useEffect(function() {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', handleKey)
    return function() { window.removeEventListener('keydown', handleKey) }
  }, [open, requestClose])

  if (!open) return null

  var isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
  var modKey = isMac ? '⌘' : 'Ctrl'

  return (
    <ModalPortal>
      <div className={`dialog-layer${exiting ? ' exiting' : ''}`} onClick={() => requestClose()}>
      <div className="shortcuts-dialog" onClick={function(e) { e.stopPropagation() }}>
        <div className="shortcuts-header">
          <h2>{tx('shortcuts.title', 'Keyboard Shortcuts')}</h2>
          <button type="button" className="icon-action" onClick={() => requestClose()} aria-label={tx('close')}>&times;</button>
        </div>
        <div className="shortcuts-body">
          {SHORTCUTS.map(function(group) {
            return (
              <div key={group.name} className="shortcuts-group">
                <h3 className="shortcuts-group-title">{group.name}</h3>
                <div className="shortcuts-list">
                  {group.shortcuts.map(function(item, i) {
                    return (
                      <div key={i} className="shortcuts-row">
                        <div className="shortcuts-keys">
                          {item.keys.map(function(k, ki) {
                            var label = k === 'Ctrl' ? modKey : k
                            return (
                              <span key={k}>
                                {ki > 0 && <span className="kbd-plus">+</span>}
                                <kbd className="kbd-badge">{label}</kbd>
                              </span>
                            )
                          })}
                        </div>
                        <span className="shortcuts-desc">{item.description}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      </div>
    </ModalPortal>
  )
}
