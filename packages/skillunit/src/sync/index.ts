export { sync, type SyncOptions, type SyncOrphan, type SyncResult, type SyncSource, type SyncUnit, type UnitState } from './sync.js';
export { entryFor, formatLock, LOCK_FILE, LOCK_VERSION, lockLine, lockPath, readLock, sourceKey, type Lock } from './lock.js';
export { CODE_EXTENSIONS, declarationLines, fileFingerprint, fingerprint, normalizeText, type FingerprintError, type FingerprintResult, type Unparsed } from './fingerprint.js';
