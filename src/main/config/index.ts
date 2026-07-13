/** Public surface of app configuration; import from './config', not from its siblings. */
// Config shape, defaults, and layered load/save.
export {
  userConfigPath, loadConfig, saveLocalConfig, saveLocalNotionConfig, saveLocalUiConfig, saveLocalReadiness, saveLocalAccounts, notionDatabaseSource,
} from './appConfig';
export type { NotionConfig, Sensor, AppConfig, UiConfig, WindowBounds, MasterDataConfig } from './appConfig';
// Notion token at rest (encrypted).
export { getNotionToken, setNotionToken, clearNotionToken } from './notionToken';
// Overwolf dev key at rest (plaintext at ~/.ow-cli/dev-key, for the launcher).
export { setDevKey, hasDevKey, clearDevKey } from './devKey';
