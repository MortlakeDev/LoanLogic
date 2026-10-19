// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

// The single place where web fonts are loaded. Inter (self-hosted, OFL) is the provisional
// font from the T01 brief; the final fonts come from docs/DESIGN.md. To change fonts, swap
// this import and the --font-sans / --font-sans-cjk tokens in tokens.css.
// Imported from JavaScript (not CSS @import) so the build's third-party notices see it.
import '@fontsource-variable/inter/wght.css';
