import { contextBridge, ipcRenderer } from 'electron';
import type {
  AuthoredTargetInput, DashboardFilters, ManualMatchInput, OwStatsApi,
} from '../shared/contract';

// Minimal, safe bridge exposed to the dashboard renderer.
const api: OwStatsApi = {
  getDashboard: (filters: DashboardFilters) => ipcRenderer.invoke('dashboard:data', filters),
  heroDetail: (hero: string, filters: DashboardFilters) =>
    ipcRenderer.invoke('dashboard:hero-detail', hero, filters),
  exportNotion: (filters: DashboardFilters) => ipcRenderer.invoke('dashboard:export-notion', filters),
  notionStatus: () => ipcRenderer.invoke('notion:status'),
  setNotionToken: (token: string) => ipcRenderer.invoke('notion:set-token', token),
  clearNotionToken: () => ipcRenderer.invoke('notion:clear-token'),
  logMatch: (input: ManualMatchInput) => ipcRenderer.invoke('manual:log-match', input),
  saveTarget: (input: AuthoredTargetInput) => ipcRenderer.invoke('manual:save-target', input),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
};

contextBridge.exposeInMainWorld('owstats', api);
