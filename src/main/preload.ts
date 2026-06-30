import { contextBridge, ipcRenderer } from 'electron';
import type { DashboardFilters } from './dashboard';

// Minimal, safe bridge exposed to the dashboard renderer.
contextBridge.exposeInMainWorld('owstats', {
  getDashboard: (filters: DashboardFilters) => ipcRenderer.invoke('dashboard:data', filters),
  heroDetail: (hero: string, filters: DashboardFilters) => ipcRenderer.invoke('dashboard:hero-detail', hero, filters),
  exportNotion: (filters: DashboardFilters) => ipcRenderer.invoke('dashboard:export-notion', filters),
});
