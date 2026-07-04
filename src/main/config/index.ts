/** Public surface of app configuration; import from './config', not from its siblings. */
// Config shape, defaults, and layered load/save.
export {
  userConfigPath, loadConfig, saveLocalConfig, saveLocalNotionConfig, notionDatabaseSource,
} from './appConfig';
export type { NotionConfig, Sensor, AppConfig } from './appConfig';
// Notion token at rest (encrypted).
export { getNotionToken, setNotionToken, clearNotionToken } from './notionToken';
