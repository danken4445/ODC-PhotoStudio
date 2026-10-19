import { createRoot } from 'react-dom/client';

const rootEl = document.getElementById('root');
if (rootEl) {
  const isCustomerSurface = new URLSearchParams(window.location.search).get('surface') === 'customer';
  const root = createRoot(rootEl);
  if (isCustomerSurface) {
    document.title = 'ODC Photo Booth';
    void import('./customer-display/CustomerDisplayApp.js').then(({ CustomerDisplayApp }) => {
      root.render(<CustomerDisplayApp />);
    });
  } else {
    void import('./App.js').then(({ OperatorCaptureApp }) => {
      root.render(<OperatorCaptureApp />);
    });
  }
}
