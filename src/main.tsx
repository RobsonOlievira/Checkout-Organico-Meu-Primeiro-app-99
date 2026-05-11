import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import CheckoutPage from './pages/CheckoutPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CheckoutPage />
  </StrictMode>,
);
