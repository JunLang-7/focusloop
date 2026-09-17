import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => {
  // The renderer must never crash silently: surface startup failures in the UI.
  const container = document.body;
  if (container) {
    const pre = document.createElement('pre');
    pre.className = 'fatal';
    pre.textContent = `FocusLoop failed to start:\n${String(error)}`;
    container.replaceChildren(pre);
  }
});
