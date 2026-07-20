import { describe, expect, it } from 'vitest'
import type { ProfileAsset } from './api/phdApi'
import {
  clusterFamiliesByKind,
  groupProfileAssetsIntoFamilies,
  nextVersionNumber,
  profileAssetFamilyId,
} from './profileAssets'

function asset(partial: Partial<ProfileAsset> & Pick<ProfileAsset, 'id' | 'name' | 'kind'>): ProfileAsset {
  return {
    description: '',
    attachments: [],
    ...partial,
  }
}

describe('profile asset type groups', () => {
  it('groups legacy assets without family ids by material type', () => {
    const items = [
      asset({ id: 'a1', name: 'CV general', kind: 'CV' }),
      asset({ id: 'a2', name: 'CV robotics', kind: 'CV' }),
      asset({ id: 'a3', name: 'PS', kind: 'Personal Statement' }),
    ]
    const families = groupProfileAssetsIntoFamilies(items)
    expect(families).toHaveLength(2)
    expect(families.find((family) => family.kind === 'CV')?.versionCount).toBe(2)
    expect(profileAssetFamilyId(items[0])).toBe('kind:cv')
  })

  it('merges old manual families of the same type and picks the primary item', () => {
    const items = [
      asset({
        id: 'cv1',
        name: 'CV general',
        kind: 'CV',
        familyId: 'old-general-cv-family',
        versionLabel: 'General',
        versionNumber: 1,
        isPrimary: false,
      }),
      asset({
        id: 'cv2',
        name: 'CV MIT',
        kind: 'CV',
        familyId: 'old-mit-cv-family',
        versionLabel: 'MIT-focused',
        versionNumber: 2,
        isPrimary: true,
      }),
      asset({
        id: 'ps1',
        name: 'PS',
        kind: 'Personal Statement',
        familyId: 'fam-ps',
        versionNumber: 1,
        isPrimary: true,
      }),
    ]
    const families = groupProfileAssetsIntoFamilies(items)
    const cv = families.find((family) => family.familyId === 'kind:cv')
    expect(cv?.versionCount).toBe(2)
    expect(cv?.primary.id).toBe('cv2')
    expect(nextVersionNumber(cv!.versions)).toBe(3)

    const clusters = clusterFamiliesByKind(families)
    expect(clusters[0].kind).toBe('CV')
    expect(clusters.some((cluster) => cluster.kind === 'Personal Statement')).toBe(true)
  })

  it('keeps differently named custom material types in separate groups', () => {
    const items = [
      asset({ id: 'custom-1', name: 'Methods summary', kind: 'Custom', customLabelEn: 'Methods' }),
      asset({ id: 'custom-2', name: 'Methods short', kind: 'Custom', customLabelEn: 'Methods' }),
      asset({ id: 'custom-3', name: 'Project evidence', kind: 'Custom', customLabelEn: 'Portfolio evidence' }),
    ]

    const families = groupProfileAssetsIntoFamilies(items)
    expect(families).toHaveLength(2)
    expect(families.find((family) => family.familyName === 'Methods')?.versionCount).toBe(2)
  })
})
