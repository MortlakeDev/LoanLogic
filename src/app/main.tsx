// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/themes.css';
import '../styles/base.css';
import './layout/shell.css';

import { render } from 'preact';
import { App } from './layout/App';
import { syncDocumentLanguage } from './state/i18n';
import { syncDocumentTheme } from './state/theme';

syncDocumentTheme();
syncDocumentLanguage();

const root = document.getElementById('app');
if (root === null) {
  throw new Error('LoanLogic: #app root element is missing from index.html');
}
render(<App />, root);
