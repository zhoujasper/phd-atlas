/**
 * Re-evaluate one trash-retention candidate inside its write lane.
 *
 * The caller's earlier read is only a cheap admission hint. Returning removals
 * from that snapshot would let a concurrent restore race with binary cleanup.
 * This helper therefore exposes only applications removed from the fresh state
 * that has successfully reached durable storage.
 */
export async function commitApplicationTrashRetention({
  userId,
  readStore,
  writeStore,
  retentionPlan,
}) {
  const store = await readStore()
  const user = store.users.find((candidate) => candidate.id === userId)
  if (!user) return []

  const plan = retentionPlan(user)
  if (!plan.changed) return []

  user.settings = {
    ...(user.settings ?? {}),
    applicationTrash: plan.kept,
  }
  await writeStore(store)
  return plan.removed.map((item) => item.application)
}
