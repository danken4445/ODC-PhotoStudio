import React from 'react';
import { createRoot } from 'react-dom/client';
import { OperatorCaptureApp } from './App.js';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <OperatorCaptureApp />
    </React.StrictMode>
  );
}
