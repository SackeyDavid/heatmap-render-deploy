import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { captureToken } from './session/token';
import { rememberEventTag } from './request/event-tag';
import './styles.css';

captureToken();
rememberEventTag();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
