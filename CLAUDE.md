# Koma

中文小說閱讀器(iOS 優先 + Web)。技術棧:Next.js 16 + React 19 + Tailwind v4 + shadcn + Drizzle + Turso。

## Design System
Always read [DESIGN.md](./DESIGN.md) before making any visual or UI decisions.
All font choices, colors, spacing, themes, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

Quick anchors:
- Memorable thing: 一隻陪你夜讀的貓.
- Default theme: **Cat-Eye Dusk**(霧綠 `#7FBBA2` / 暖炭 `#151A19`). Also ship Ember Night + Clean Paper as switchable themes.
- Reading body: **Noto Sans TC(黑體)default**; Noto Serif TC(明體)optional, not default.
- Display: Fraunces. Accent appears only on chapter titles, progress, primary actions.
