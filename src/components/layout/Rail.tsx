import {
  Bell,
  Building2,
  ClipboardList,
  Compass,
  Database,
  FileText,
  GraduationCap,
  History,
  LayoutList,
  LogOut,
  Moon,
  Settings,
  Sun,
  Users,
  UserRound,
} from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { InterfaceMode, Screen, TeamSection } from '../../appModel'
import type { TeamRole } from '../../api/phdApi'
import { useI18n } from '../hooks/useI18n'
import type { Theme } from '../hooks/useTheme'
import { UserAvatar } from '../shared/UserAvatar'

export function Rail({
  screen,
  unreadNotificationCount,
  theme,
  interfaceMode,
  teamViewerRole,
  teamSection,
  modeSwitchLocked = false,
  avatarUrl,
  userName,
  userEmail,
  onPrefetchScreen,
  onScreen,
  onTeamSection,
  onModeChange,
  onOpenNotifications,
  onToggleTheme,
  onLogout,
}: {
  screen: Screen
  unreadNotificationCount?: number
  theme: Theme
  // null for users without a team — every team role can switch into the team system.
  interfaceMode: InterfaceMode
  teamViewerRole: TeamRole | null
  teamSection: TeamSection
  modeSwitchLocked?: boolean
  avatarUrl?: string | null
  userName?: string
  userEmail?: string
  onPrefetchScreen?: (screen: Screen) => void
  onScreen: (screen: Screen) => void
  onTeamSection: (section: TeamSection, openTeamScreen?: boolean) => void
  onModeChange: (mode: InterfaceMode) => void
  onOpenNotifications?: () => void
  onToggleTheme: () => void
  onLogout: () => void
}) {
  const { tx, format, lang } = useI18n()
  const safeUnreadNotificationCount = unreadNotificationCount ?? 0

  const hasTeamMode = Boolean(teamViewerRole)
  const canToggleMode = hasTeamMode && !modeSwitchLocked
  const isTeamMode = hasTeamMode && interfaceMode === 'team'
  type NavItem = { screen: Screen; section?: TeamSection; label: string; shortLabel: string; icon: typeof LayoutList }
  const items = useMemo<NavItem[]>(() => {
    if (isTeamMode) {
      if (teamViewerRole === 'member') {
        const studentSections: Array<{ section: TeamSection; label: string; shortLabel: string; icon: typeof LayoutList }> = [
          { section: 'overview', label: tx('nav.dashboard'), shortLabel: tx('navShort.dashboard', tx('nav.dashboard')), icon: ClipboardList },
          { section: 'applications', label: tx('nav.applications'), shortLabel: tx('navShort.applications', tx('nav.applications')), icon: LayoutList },
          { section: 'resources', label: tx('nav.profile'), shortLabel: tx('navShort.profile', tx('nav.profile')), icon: UserRound },
          { section: 'settings', label: tx('nav.settings'), shortLabel: tx('navShort.settings', tx('nav.settings')), icon: Settings },
        ]
        return studentSections.map((item) => ({ screen: 'team' as const, ...item }))
      }
      const fallbacks: Record<TeamSection, string> = {
        overview: 'Workbench',
        applications: 'Applications',
        members: 'Members',
        resources: 'Resources',
        audit: 'Audit',
        settings: 'Settings',
      }
      const labelFor = (section: TeamSection) => {
        if (teamViewerRole === 'admin' && section === 'applications') return tx('team.tabTeacherApps', 'Student apps')
        if (teamViewerRole === 'admin' && section === 'members') return tx('team.tabTeacherStudents', 'Students')
        if ((teamViewerRole === 'admin' || teamViewerRole === 'owner') && section === 'resources') {
          return tx('team.tabTeacherResources', 'Student profiles')
        }
        return tx(`team.tab${section[0].toUpperCase()}${section.slice(1)}`, fallbacks[section])
      }
      const sections: TeamSection[] = ['overview', 'applications', 'members', 'resources', 'audit', 'settings']
      const shortLabelFor = (section: TeamSection) => {
        if (section === 'overview') return tx('navShort.teamOverview', tx('navShort.dashboard', labelFor(section)))
        if (section === 'applications') return tx('navShort.teamApplications', tx('navShort.applications', labelFor(section)))
        if (section === 'members') {
          return teamViewerRole === 'admin'
            ? tx('navShort.myStudents', labelFor(section))
            : tx('navShort.teamMembers', labelFor(section))
        }
        if (section === 'resources') return tx('navShort.profile', labelFor(section))
        if (section === 'settings') return tx('navShort.settings', labelFor(section))
        return labelFor(section)
      }
      return sections.map((section) => ({
          screen: 'team' as const,
          section,
          label: labelFor(section),
          shortLabel: shortLabelFor(section),
          icon: section === 'overview'
            ? ClipboardList
            : section === 'applications'
              ? FileText
              : section === 'members'
                ? Users
                : section === 'resources'
                  ? ((teamViewerRole === 'admin' || teamViewerRole === 'owner') ? UserRound : Database)
                  : section === 'audit'
                    ? History
                    : Settings,
        }))
    }
    return [
      { screen: 'dashboard', label: tx('nav.dashboard'), shortLabel: tx('navShort.dashboard', tx('nav.dashboard')), icon: ClipboardList },
      { screen: 'workspace', label: tx('nav.applications'), shortLabel: tx('navShort.applications', tx('nav.applications')), icon: LayoutList },
      { screen: 'discover', label: tx('nav.discover', tx('discover.nav', 'Discover')), shortLabel: tx('navShort.discover', tx('discover.navShort', 'Find')), icon: Compass },
      { screen: 'profile', label: tx('nav.profile'), shortLabel: tx('navShort.profile', tx('nav.profile')), icon: UserRound },
      { screen: 'settings', label: tx('nav.settings'), shortLabel: tx('navShort.settings', tx('nav.settings')), icon: Settings },
    ]
  }, [isTeamMode, lang, teamViewerRole, tx])

  const ModeIcon = isTeamMode ? Building2 : UserRound
  const modeLabel = isTeamMode ? tx('nav.modeTeam') : tx('nav.modePersonal')
  const nextModeLabel = isTeamMode ? tx('nav.modePersonal') : tx('nav.modeTeam')
  const ThemeIcon = theme === 'dark' ? Moon : Sun
  const themeLabel = theme === 'dark' ? tx('settings.dark') : tx('settings.light')
  const notificationsLabel = tx('notifications.title')
  const hasUnreadNotifications = safeUnreadNotificationCount > 0
  const itemKeyFor = (item: NavItem) => item.section ? `${item.screen}-${item.section}` : item.screen
  const currentKey = items.find((item) => (
    item.section
      ? (screen === 'team' && teamSection === item.section) || (screen === 'workspace' && item.section === 'applications')
      : item.screen === screen
  ))
  const currentActiveKey = currentKey ? itemKeyFor(currentKey) : itemKeyFor(items[0])
  const [optimisticKey, setOptimisticKey] = useState<string | null>(null)

  useEffect(() => {
    if (!optimisticKey) return undefined
    if (optimisticKey !== currentActiveKey && items.some((item) => itemKeyFor(item) === optimisticKey)) {
      // A navigation guard can keep the current screen in place. Preserve the
      // immediate press feedback briefly, then return the indicator to truth.
      const timeout = window.setTimeout(() => setOptimisticKey(null), 320)
      return () => window.clearTimeout(timeout)
    }

    const frame = window.requestAnimationFrame(() => setOptimisticKey(null))
    return () => window.cancelAnimationFrame(frame)
  }, [currentActiveKey, items, optimisticKey])

  const visualActiveKey = optimisticKey ?? currentActiveKey
  const activeIndex = Math.max(0, items.findIndex((item) => itemKeyFor(item) === visualActiveKey))
  const railStep = 56
  const activeIndicatorStyle = {
    '--rail-active-y': `${activeIndex * railStep}px`,
    '--rail-active-x': `${activeIndex * (100 / items.length)}%`,
    '--rail-item-count': items.length,
  } as CSSProperties

  const navigateToItem = (item: NavItem) => {
    const itemKey = itemKeyFor(item)
    setOptimisticKey(itemKey)
    if (item.section) {
      onTeamSection(item.section, item.screen !== screen)
      return
    }
    onScreen(item.screen)
  }

  return (
    <aside className={`atlas-rail ${isTeamMode ? 'team-rail' : ''}`} aria-label={tx('primaryNavigation')}>
      <div className={`rail-brand${avatarUrl ? ' has-avatar' : ''}`} aria-label="PhD Atlas">
        {avatarUrl ? (
          <UserAvatar
            avatarUrl={avatarUrl}
            name={userName}
            email={userEmail}
            className="rail-profile-avatar"
          />
        ) : (
          <GraduationCap size={23} aria-hidden="true" />
        )}
      </div>
      <nav style={activeIndicatorStyle}>
        <span className="rail-active-indicator" aria-hidden="true" />
        {items.map((item) => {
          const Icon = item.icon
          const itemKey = itemKeyFor(item)
          const isActive = itemKey === visualActiveKey
          return (
            <button
              key={itemKey}
              type="button"
              className={`rail-btn ${isActive ? 'active' : ''}`}
              onPointerDown={() => onPrefetchScreen?.(item.screen)}
              onPointerEnter={() => onPrefetchScreen?.(item.screen)}
              onFocus={() => onPrefetchScreen?.(item.screen)}
              onClick={() => {
                navigateToItem(item)
              }}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              title={item.label}
              data-tour={`nav-${item.screen}`}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{item.shortLabel}</span>
            </button>
          )
        })}
      </nav>
      <div className={`rail-bottom-stack${canToggleMode ? ' has-mode-toggle' : ''}`}>
        {canToggleMode ? (
          <button
            type="button"
            className="rail-btn rail-mode-toggle"
            aria-label={format(tx('nav.modeSwitchTo'), { mode: nextModeLabel })}
            title={format(tx('nav.modeSwitchTo'), { mode: nextModeLabel })}
            onClick={() => onModeChange(isTeamMode ? 'personal' : 'team')}
            data-tour="nav-mode-switch"
          >
            <ModeIcon size={18} aria-hidden="true" />
            <span>{modeLabel}</span>
          </button>
        ) : null}
        {onOpenNotifications ? (
          <button
            type="button"
            className={`rail-btn rail-notifications ${hasUnreadNotifications ? 'has-unread' : ''}`}
            aria-label={hasUnreadNotifications ? format(tx('notifications.badgeLabel'), { count: safeUnreadNotificationCount }) : tx('notifications.title')}
            title={tx('notifications.title')}
            onClick={onOpenNotifications}
          >
            <Bell size={18} aria-hidden="true" />
            <span>{tx('navShort.notifications', notificationsLabel)}</span>
            {hasUnreadNotifications ? (
              <span className="rail-count-badge" aria-hidden="true">{safeUnreadNotificationCount > 9 ? '9+' : safeUnreadNotificationCount}</span>
            ) : null}
          </button>
        ) : null}
        <button
          type="button"
          className="rail-btn rail-theme-toggle"
          aria-label={themeLabel}
          title={themeLabel}
          onClick={onToggleTheme}
        >
          <ThemeIcon size={18} aria-hidden="true" />
          <span>{themeLabel}</span>
        </button>
        <button
          type="button"
          className="rail-btn rail-logout"
          aria-label={tx('signOut')}
          title={tx('signOut')}
          onClick={onLogout}
        >
          <LogOut size={19} aria-hidden="true" />
          <span>{tx('navShort.signOut', tx('signOut'))}</span>
        </button>
      </div>
    </aside>
  )
}
