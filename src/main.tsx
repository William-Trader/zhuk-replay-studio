/*!
 * src/main.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-A3A1D78E
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
