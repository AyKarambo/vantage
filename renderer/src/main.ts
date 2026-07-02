/** Renderer entry point — mount the app shell and let the store drive it. */
import { App } from './app/shell';
import { must } from './dom';

new App(must('#app'));
