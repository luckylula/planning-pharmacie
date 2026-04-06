/**
 * Supprime le dossier `.next` avant `next dev` quand OneDrive / la sync casse
 * les symlinks (readlink EINVAL) et empêche Next de nettoyer le cache.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const nextDir = path.join(root, '.next')

try {
  fs.rmSync(nextDir, { recursive: true, force: true })
} catch (e) {
  console.warn('[rm-next] Impossible de supprimer .next:', e instanceof Error ? e.message : e)
  process.exitCode = 1
}
