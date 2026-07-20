/**
 * Built-in organization profile presets.
 * Keep kinds/ids aligned with src/profileAssets.ts PROFILE_PRESET_KINDS /
 * PROFILE_PRESET_DEFAULT_KEYS and DEFAULT_PRESENTATION in src/profilePresets.ts.
 *
 * Tuple: [id, kind, nameZh, nameEn, descriptionZh, descriptionEn, contentZh, contentEn, icon, color]
 */
const definitions = [
  ['cv', 'CV', '简历 / CV', 'CV / Resume', '学术简历、多版本 CV 与申请材料包。', 'Academic CV, resume variants, and credential package.', '博士申请与套磁用的学术简历材料包。', 'Academic CV package for PhD applications and outreach.', 'file-check', 'blue'],
  ['personalStatement', 'Personal Statement', '个人陈述', 'Personal statement', '个人故事、动机与项目匹配的可复用段落。', 'Story, motivation, and fit paragraphs for personal statements.', '个人陈述相关段落，包括背景、动机和项目匹配说明。', 'Personal statement paragraphs and application-fit notes.', 'file-text', 'purple'],
  ['sop', 'SOP', '目的陈述 (SOP)', 'Statement of purpose', '网申用目的陈述与项目匹配表述。', 'Statement of purpose for portals and formal applications.', 'SOP/目的陈述草稿和项目匹配表述。', 'Statement of purpose draft material and program-fit language.', 'scroll-text', 'orange'],
  ['researchProposal', 'Research Proposal', '研究计划', 'Research proposal', '研究问题、方法、时间线与导师匹配。', 'Project plan: questions, methods, timeline, and lab fit.', '研究计划、项目摘要、研究方法和与导师方向的连接点。', 'Research proposal, project abstract, methods, and fit notes.', 'flask-conical', 'teal'],
  ['researchStatement', 'Research Statement', '研究陈述', 'Research statement', '过往研究、轨迹与未来方向。', 'Past research, trajectory, and future agenda.', '研究陈述——过往工作与未来议程。', 'Research statement — past work and future agenda.', 'flask-conical', 'blue'],
  ['teachingStatement', 'Teaching Statement', '教学陈述', 'Teaching statement', '教学理念、经历与可授课课程。', 'Teaching philosophy, experience, and course ideas.', '教学陈述与可授课课程说明。', 'Teaching statement and course ideas.', 'book-open', 'green'],
  ['coverLetter', 'Cover Letter', '套磁信 / 求职信', 'Cover letter / outreach', '套磁邮件、冷邮件与附信模板。', 'Cold email / professor outreach and cover letters.', '套磁信 / 附信模板。', 'Cover letter / professor outreach template.', 'mail', 'orange'],
  ['transcript', 'Transcript', '成绩单', 'Transcript', '成绩单、绩点证明与在读证明。', 'Transcripts, GPA proofs, and academic records.', '成绩单、绩点证明和相关学术记录。', 'Transcript, grade report, and academic record package.', 'graduation-cap', 'green'],
  ['languageScores', 'Language Scores', '语言与标化成绩', 'Language test scores', '托福、雅思、GRE 等成绩与报告。', 'TOEFL, IELTS, GRE, and other language or test scores.', '语言与标化考试成绩记录。', 'Language and standardized test score records.', 'graduation-cap', 'teal'],
  ['recommendation', 'Recommendation', '推荐信', 'Recommendation letter', '推荐人名单、进度与上传材料。', 'Recommender list, request status, and letter uploads.', '推荐信请求信息、推荐人备注和上传状态。', 'Recommendation letter request details, recommender notes, and upload status.', 'mail', 'pink'],
  ['writingSample', 'Writing Sample', '写作样本', 'Writing sample', '论文、课程作业或写作样本。', 'Papers, essays, or writing samples for review.', '写作样本、论文草稿或作品集片段。', 'Writing sample, paper draft, or portfolio excerpt.', 'pen-line', 'gray'],
  ['publications', 'Publications', '论文与成果列表', 'Publication list', '论文、预印本、海报与引用列表。', 'Papers, preprints, posters, and citation list.', '论文与成果列表。', 'Publication and output list.', 'book-open', 'purple'],
  ['portfolio', 'Portfolio', '作品集 / 项目集', 'Portfolio', '项目、演示、代码或设计作品。', 'Projects, demos, code, design, or creative work.', '项目 / 作品集。', 'Portfolio of projects and demos.', 'briefcase', 'blue'],
  ['scholarshipEssay', 'Scholarship Essay', '奖学金文书', 'Scholarship essay', '奖学金文书、资助动机与影响说明。', 'Funding essays, personal need, and impact statements.', '奖学金 / 基金文书。', 'Scholarship / fellowship essay drafts.', 'scroll-text', 'pink'],
]

export function defaultTeamProfilePresets() {
  return definitions.map(([id, kind, nameZh, nameEn, descriptionZh, descriptionEn, contentZh, contentEn, icon, color]) => ({
    id: `profile-preset-default-${id}`,
    kind,
    nameZh,
    nameEn,
    descriptionZh,
    descriptionEn,
    contentZh,
    contentEn,
    icon,
    color,
    builtIn: true,
    createdBy: null,
    createdByRole: null,
    syncToTeachers: true,
    syncToStudents: true,
  }))
}

/**
 * Keep stored team presets, refresh known built-ins, and append any catalog
 * kinds missing from older saved lists.
 */
export function mergeTeamProfilePresets(current) {
  const fresh = defaultTeamProfilePresets()
  if (!Array.isArray(current) || current.length === 0) return fresh

  const freshByKind = new Map(fresh.map((preset) => [preset.kind, preset]))
  const presentKinds = new Set()

  const remapped = current.map((preset) => {
    presentKinds.add(preset.kind)
    if (!preset.builtIn) return preset
    const next = freshByKind.get(preset.kind)
    if (!next) return preset
    return {
      ...next,
      id: preset.id,
      icon: preset.icon || next.icon,
      color: preset.color || next.color,
      createdBy: preset.createdBy ?? next.createdBy,
      createdByRole: preset.createdByRole ?? next.createdByRole,
      syncToTeachers: preset.syncToTeachers ?? next.syncToTeachers,
      syncToStudents: preset.syncToStudents ?? next.syncToStudents,
    }
  })

  const missing = fresh.filter((preset) => !presentKinds.has(preset.kind))
  return missing.length > 0 ? [...remapped, ...missing] : remapped
}
