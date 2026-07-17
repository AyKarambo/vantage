/**
 * GEP *service* status (Overwolf-side outage awareness) — public surface.
 * Import from `'core/gepService'`, not its siblings. Pure & Electron-free.
 */
export type { ServiceStatusLevel, ServiceStatus } from './types';
export { parseServiceStatus } from './parse';
export { decideGepNotification, nextNotifyBaseline, type GepNotification } from './notify';
