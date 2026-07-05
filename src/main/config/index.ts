/** Public surface of app configuration; import from './config', not from its siblings. */
// Config shape, defaults, and layered load/save.
export {
  userConfigPath, loadConfig, saveLocalConfig, saveLocalNotionConfig, saveLocalUiConfig, saveLocalAccounts, notionDatabaseSource,
} from './appConfig';
export type { NotionConfig, Sensor, AppConfig, UiConfig, WindowBounds } from './appConfig';
// Notion token at rest (encrypted).
export { getNotionToken, setNotionToken, clearNotionToken } from './notionToken';
