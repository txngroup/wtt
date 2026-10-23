// NEAR account ids and the hash the bridge knows them by. Kept apart from near.ts, which loads separately, because
// Activity needs them on every visit.
import { sha256 } from '@noble/hashes/sha2'

// 2 to 64 characters of lowercase letters, digits and single - _ separators, in dot-separated parts. That also covers
// implicit accounts (64 hex characters).
export const isNearAccountId = (id: string) =>
  id.length >= 2 && id.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id)

// The bridge addresses NEAR accounts by the sha256 of their id, the 32 bytes a transfer's recipient field holds.
export const accountHash = (account: string) => sha256(new TextEncoder().encode(account))
