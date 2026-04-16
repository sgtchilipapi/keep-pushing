## RUNARA — Bright Atmospheric Design Tokens

### TypeScript token object

```ts
export const tokens = {
  color: {
    base: {
      page: "#EEF5FB",
      pageAlt: "#E6F0F6",
      surface: "rgba(255, 255, 255, 0.62)",
      surfaceStrong: "rgba(255, 255, 255, 0.78)",
      surfaceSoft: "rgba(248, 251, 255, 0.58)",
      surfaceTint: "rgba(232, 241, 248, 0.72)",

      border: "rgba(140, 159, 177, 0.34)",
      borderStrong: "rgba(124, 145, 166, 0.48)",
      borderSoft: "rgba(255, 255, 255, 0.56)",

      text: "#203040",
      textMuted: "#516579",
      textSoft: "#7C8EA0",
      textInverse: "#FFFFFF",
    },

    brand: {
      primary: "#76AEDA",
      primaryHover: "#6AA4D2",
      primaryActive: "#5E98C8",
      primarySoft: "rgba(118, 174, 218, 0.14)",
      primaryBorder: "rgba(118, 174, 218, 0.34)",

      secondary: "#86BFA8",
      secondaryHover: "#78B398",
      secondaryActive: "#6BA78C",
      secondarySoft: "rgba(134, 191, 168, 0.14)",
      secondaryBorder: "rgba(134, 191, 168, 0.34)",

      accent: "#A9D7D8",
      accentSoft: "rgba(169, 215, 216, 0.16)",
    },

    world: {
      sky: "#CFE6F7",
      cloud: "#F7FBFE",
      grass: "#9DBA84",
      grassSoft: "rgba(157, 186, 132, 0.14)",
      earth: "#B8AA9A",
      earthSoft: "rgba(184, 170, 154, 0.12)",
      metal: "#AAB7C4",
      metalSoft: "rgba(170, 183, 196, 0.16)",
    },

    state: {
      success: "#7EAF8C",
      successHover: "#729F80",
      successSoft: "rgba(126, 175, 140, 0.16)",
      successBorder: "rgba(126, 175, 140, 0.34)",

      warning: "#D0B27C",
      warningHover: "#C1A36E",
      warningSoft: "rgba(208, 178, 124, 0.16)",
      warningBorder: "rgba(208, 178, 124, 0.34)",

      danger: "#C98A8A",
      dangerHover: "#BA7B7B",
      dangerSoft: "rgba(201, 138, 138, 0.16)",
      dangerBorder: "rgba(201, 138, 138, 0.34)",

      info: "#8CB9DD",
      infoHover: "#7FADD2",
      infoSoft: "rgba(140, 185, 221, 0.16)",
      infoBorder: "rgba(140, 185, 221, 0.34)",
    },

    overlay: {
      haze: "rgba(255, 255, 255, 0.22)",
      hazeStrong: "rgba(255, 255, 255, 0.36)",
      frost: "rgba(255, 255, 255, 0.30)",
      frostStrong: "rgba(255, 255, 255, 0.46)",
      scrimSoft: "rgba(195, 214, 228, 0.14)",
    },

    focus: {
      ring: "rgba(118, 174, 218, 0.22)",
      ringStrong: "rgba(118, 174, 218, 0.38)",
    }
  },

  radius: {
    xs: "8px",
    sm: "10px",
    md: "12px",
    lg: "16px",
    xl: "20px",
    pill: "999px",
  },

  space: {
    2: "2px",
    4: "4px",
    6: "6px",
    8: "8px",
    10: "10px",
    12: "12px",
    14: "14px",
    16: "16px",
    20: "20px",
    24: "24px",
  },

  fontSize: {
    xs: "11px",
    sm: "12px",
    md: "13px",
    lg: "14px",
    xl: "16px",
    h3: "18px",
    h2: "22px",
    h1: "28px",
  },

  lineHeight: {
    tight: 1.1,
    normal: 1.4,
    relaxed: 1.55,
  },

  shadow: {
    panel: "0 8px 24px rgba(91, 122, 148, 0.10)",
    elevated: "0 14px 32px rgba(91, 122, 148, 0.14)",
    focus: "0 0 0 3px rgba(118, 174, 218, 0.18)",
    none: "none",
  },

  blur: {
    sm: "8px",
    md: "12px",
    lg: "16px",
  },

  stroke: {
    thin: "1px",
    strong: "1.5px",
    focus: "2px",
  },

  motion: {
    fast: "120ms ease",
    base: "180ms ease",
    slow: "260ms ease",
  },

  layout: {
    maxWidth: "100%",
    shellPaddingX: "12px",
    shellPaddingY: "8px",
    panelGap: "12px",
    tap: "40px",
    tapComfort: "44px",
    topbarHeight: "48px",
  }
} as const;
```

---

### CSS variables

```css
:root {
  --page: #EEF5FB;
  --page-alt: #E6F0F6;
  --surface: rgba(255, 255, 255, 0.62);
  --surface-strong: rgba(255, 255, 255, 0.78);
  --surface-soft: rgba(248, 251, 255, 0.58);
  --surface-tint: rgba(232, 241, 248, 0.72);

  --border: rgba(140, 159, 177, 0.34);
  --border-strong: rgba(124, 145, 166, 0.48);
  --border-soft: rgba(255, 255, 255, 0.56);

  --text: #203040;
  --text-muted: #516579;
  --text-soft: #7C8EA0;
  --text-inverse: #FFFFFF;

  --brand-primary: #76AEDA;
  --brand-primary-hover: #6AA4D2;
  --brand-primary-active: #5E98C8;
  --brand-primary-soft: rgba(118, 174, 218, 0.14);
  --brand-primary-border: rgba(118, 174, 218, 0.34);

  --brand-secondary: #86BFA8;
  --brand-secondary-hover: #78B398;
  --brand-secondary-active: #6BA78C;
  --brand-secondary-soft: rgba(134, 191, 168, 0.14);
  --brand-secondary-border: rgba(134, 191, 168, 0.34);

  --accent: #A9D7D8;
  --accent-soft: rgba(169, 215, 216, 0.16);

  --sky: #CFE6F7;
  --cloud: #F7FBFE;
  --grass: #9DBA84;
  --grass-soft: rgba(157, 186, 132, 0.14);
  --earth: #B8AA9A;
  --earth-soft: rgba(184, 170, 154, 0.12);
  --metal: #AAB7C4;
  --metal-soft: rgba(170, 183, 196, 0.16);

  --success: #7EAF8C;
  --success-soft: rgba(126, 175, 140, 0.16);
  --success-border: rgba(126, 175, 140, 0.34);

  --warning: #D0B27C;
  --warning-soft: rgba(208, 178, 124, 0.16);
  --warning-border: rgba(208, 178, 124, 0.34);

  --danger: #C98A8A;
  --danger-soft: rgba(201, 138, 138, 0.16);
  --danger-border: rgba(201, 138, 138, 0.34);

  --info: #8CB9DD;
  --info-soft: rgba(140, 185, 221, 0.16);
  --info-border: rgba(140, 185, 221, 0.34);

  --haze: rgba(255, 255, 255, 0.22);
  --haze-strong: rgba(255, 255, 255, 0.36);
  --frost: rgba(255, 255, 255, 0.30);
  --frost-strong: rgba(255, 255, 255, 0.46);
  --scrim-soft: rgba(195, 214, 228, 0.14);

  --focus-ring: rgba(118, 174, 218, 0.22);
  --focus-ring-strong: rgba(118, 174, 218, 0.38);

  --radius-xs: 8px;
  --radius-sm: 10px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-pill: 999px;

  --space-2: 2px;
  --space-4: 4px;
  --space-6: 6px;
  --space-8: 8px;
  --space-10: 10px;
  --space-12: 12px;
  --space-14: 14px;
  --space-16: 16px;
  --space-20: 20px;
  --space-24: 24px;

  --font-xs: 11px;
  --font-sm: 12px;
  --font-md: 13px;
  --font-lg: 14px;
  --font-xl: 16px;
  --font-h3: 18px;
  --font-h2: 22px;
  --font-h1: 28px;

  --lh-tight: 1.1;
  --lh-normal: 1.4;
  --lh-relaxed: 1.55;

  --shadow-panel: 0 8px 24px rgba(91, 122, 148, 0.10);
  --shadow-elevated: 0 14px 32px rgba(91, 122, 148, 0.14);
  --shadow-focus: 0 0 0 3px rgba(118, 174, 218, 0.18);

  --blur-sm: 8px;
  --blur-md: 12px;
  --blur-lg: 16px;

  --motion-fast: 120ms ease;
  --motion-base: 180ms ease;
  --motion-slow: 260ms ease;

  --tap-size: 44px;
  --shell-px: 12px;
  --shell-py: 8px;
  --panel-gap: 12px;
}
```

---

## Full CSS refactor foundation

```css
:root {
  --page: #EEF5FB;
  --page-alt: #E6F0F6;
  --surface: rgba(255, 255, 255, 0.62);
  --surface-strong: rgba(255, 255, 255, 0.78);
  --surface-soft: rgba(248, 251, 255, 0.58);
  --surface-tint: rgba(232, 241, 248, 0.72);

  --border: rgba(140, 159, 177, 0.34);
  --border-strong: rgba(124, 145, 166, 0.48);
  --border-soft: rgba(255, 255, 255, 0.56);

  --text: #203040;
  --text-muted: #516579;
  --text-soft: #7C8EA0;
  --text-inverse: #FFFFFF;

  --brand-primary: #76AEDA;
  --brand-primary-hover: #6AA4D2;
  --brand-primary-active: #5E98C8;
  --brand-primary-soft: rgba(118, 174, 218, 0.14);
  --brand-primary-border: rgba(118, 174, 218, 0.34);

  --brand-secondary: #86BFA8;
  --brand-secondary-hover: #78B398;
  --brand-secondary-active: #6BA78C;
  --brand-secondary-soft: rgba(134, 191, 168, 0.14);
  --brand-secondary-border: rgba(134, 191, 168, 0.34);

  --accent: #A9D7D8;
  --accent-soft: rgba(169, 215, 216, 0.16);

  --sky: #CFE6F7;
  --cloud: #F7FBFE;
  --grass: #9DBA84;
  --grass-soft: rgba(157, 186, 132, 0.14);
  --earth: #B8AA9A;
  --earth-soft: rgba(184, 170, 154, 0.12);
  --metal: #AAB7C4;
  --metal-soft: rgba(170, 183, 196, 0.16);

  --success: #7EAF8C;
  --success-soft: rgba(126, 175, 140, 0.16);
  --success-border: rgba(126, 175, 140, 0.34);

  --warning: #D0B27C;
  --warning-soft: rgba(208, 178, 124, 0.16);
  --warning-border: rgba(208, 178, 124, 0.34);

  --danger: #C98A8A;
  --danger-soft: rgba(201, 138, 138, 0.16);
  --danger-border: rgba(201, 138, 138, 0.34);

  --info: #8CB9DD;
  --info-soft: rgba(140, 185, 221, 0.16);
  --info-border: rgba(140, 185, 221, 0.34);

  --haze: rgba(255, 255, 255, 0.22);
  --haze-strong: rgba(255, 255, 255, 0.36);
  --frost: rgba(255, 255, 255, 0.30);
  --frost-strong: rgba(255, 255, 255, 0.46);
  --scrim-soft: rgba(195, 214, 228, 0.14);

  --focus-ring: rgba(118, 174, 218, 0.22);
  --focus-ring-strong: rgba(118, 174, 218, 0.38);

  --radius-xs: 8px;
  --radius-sm: 10px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-pill: 999px;

  --space-2: 2px;
  --space-4: 4px;
  --space-6: 6px;
  --space-8: 8px;
  --space-10: 10px;
  --space-12: 12px;
  --space-14: 14px;
  --space-16: 16px;
  --space-20: 20px;
  --space-24: 24px;

  --font-xs: 11px;
  --font-sm: 12px;
  --font-md: 13px;
  --font-lg: 14px;
  --font-xl: 16px;
  --font-h3: 18px;
  --font-h2: 22px;
  --font-h1: 28px;

  --lh-tight: 1.1;
  --lh-normal: 1.4;
  --lh-relaxed: 1.55;

  --shadow-panel: 0 8px 24px rgba(91, 122, 148, 0.10);
  --shadow-elevated: 0 14px 32px rgba(91, 122, 148, 0.14);
  --shadow-focus: 0 0 0 3px rgba(118, 174, 218, 0.18);

  --blur-sm: 8px;
  --blur-md: 12px;
  --blur-lg: 16px;

  --motion-fast: 120ms ease;
  --motion-base: 180ms ease;
  --motion-slow: 260ms ease;

  --tap-size: 44px;
  --shell-px: 12px;
  --shell-py: 8px;
  --panel-gap: 12px;
}

.page {
  position: relative;
  min-height: 100dvh;
  background:
    linear-gradient(rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.32)),
    url("../../app/public/main-bg.png") center center / cover no-repeat;
  color: var(--text);
}

.page::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 18% 12%, rgba(118, 174, 218, 0.10), transparent 28%),
    radial-gradient(circle at 80% 78%, rgba(157, 186, 132, 0.08), transparent 24%);
  pointer-events: none;
}

.shell {
  position: relative;
  z-index: 1;
  width: 100%;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: var(--shell-py) var(--shell-px) 12px;
  box-sizing: border-box;
}

.header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-bottom: 8px;
}

.eyebrow,
.headerMetaText,
.metaText,
.panelText,
.noteText,
.subtitle,
.slotText,
.classCardText,
.keyLabel,
.muted,
.syncFeedback {
  color: var(--text-muted);
}

.syncFeedbackError {
  color: var(--danger);
}

.syncFeedbackSuccess {
  color: var(--success);
}

.eyebrow {
  font-size: var(--font-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.title {
  margin: 0;
  font-size: 20px;
  line-height: var(--lh-tight);
  letter-spacing: 0.02em;
  color: var(--text);
}

.titleRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.subtitle {
  margin: 0;
  max-width: 72ch;
  font-size: var(--font-xs);
  line-height: 1.25;
}

.headerMetaText {
  font-size: 9px;
  font-weight: 600;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  justify-content: flex-end;
}

.menuWrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.menu {
  position: relative;
}

.menuSummary {
  display: inline-flex;
  align-items: center;
  list-style: none;
  cursor: pointer;
}

.menuSummary::-webkit-details-marker {
  display: none;
}

.heroPanel,
.panel,
.menuContent,
.inlinePopoverCard,
.visualMapShell,
.visualMapFrame,
.mapStageCard,
.mapNodeCard,
.resultBattleCard,
.slotCard,
.classCard,
.zoneCard,
.visualMapStageCard,
.pre,
.details,
.errorBox,
.infoBox,
.successBox {
  position: relative;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background:
    linear-gradient(180deg, var(--frost-strong), var(--frost)),
    var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(var(--blur-md)) saturate(112%);
  -webkit-backdrop-filter: blur(var(--blur-md)) saturate(112%);
  overflow: hidden;
}

.menuContent {
  margin-top: 6px;
  padding: 12px;
  min-width: min(320px, calc(100vw - 24px));
  box-shadow: var(--shadow-elevated);
}

.heroPanel {
  padding: 16px;
}

.panel,
.visualMapShell,
.mapStageCard,
.resultBattleCard,
.slotCard,
.classCard,
.zoneCard,
.visualMapStageCard,
.pre,
.details,
.visualMapFrame {
  padding: 12px;
}

.button,
.iconButton {
  appearance: none;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  box-shadow: none;
  transition:
    background var(--motion-base),
    border-color var(--motion-base),
    color var(--motion-base),
    box-shadow var(--motion-base),
    opacity var(--motion-base);
}

.button {
  min-height: var(--tap-size);
  padding: 0 14px;
  border-radius: var(--radius-sm);
  font: inherit;
  font-weight: 600;
}

.iconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--tap-size);
  min-height: var(--tap-size);
  border-radius: var(--radius-pill);
}

.button:hover,
.iconButton:hover {
  background: rgba(255, 255, 255, 0.14);
  border-color: var(--brand-primary-border);
  color: var(--brand-primary-active);
}

.button:active,
.iconButton:active {
  background: rgba(255, 255, 255, 0.22);
}

.buttonPrimary,
.iconButtonPrimary {
  background: transparent;
  border-color: var(--brand-primary-border);
  color: var(--brand-primary-active);
}

.buttonPrimary:hover,
.iconButtonPrimary:hover {
  background: var(--brand-primary-soft);
  border-color: var(--brand-primary);
  color: var(--brand-primary-active);
}

.buttonPrimary:active,
.iconButtonPrimary:active {
  background: rgba(118, 174, 218, 0.22);
}

.buttonDanger {
  background: transparent;
  border-color: var(--danger-border);
  color: var(--danger);
}

.buttonDanger:hover {
  background: var(--danger-soft);
}

.iconButtonActive {
  border-color: var(--brand-primary);
  color: var(--brand-primary-active);
  background: var(--brand-primary-soft);
}

.button:disabled,
.iconButton:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.iconSvg {
  width: 13px;
  height: 13px;
}

.panelGrid,
.dashboardGrid,
.mapWindowGrid,
.formGrid,
.stack {
  display: grid;
  gap: var(--panel-gap);
}

.characterStage {
  flex: 1 1 auto;
  min-height: 0;
  align-content: stretch;
}

.heroTitle,
.panelTitle,
.characterHeroName,
.characterSummaryValue,
.keyValue,
.levelValue,
.pathLabel,
.resultBattleTitle,
.slotTitle,
.classCardTitle,
.panelTextStrong {
  color: var(--text);
}

.heroTitle {
  margin: 0;
  font-size: clamp(28px, 5vw, 44px);
  line-height: 1.05;
  max-width: 12ch;
}

.characterPanelFull {
  min-height: 0;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 14px;
}

.characterSummaryGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  align-items: start;
}

.characterSummaryCell {
  min-height: 32px;
  display: flex;
  align-items: center;
}

.characterSummaryActions {
  justify-content: flex-end;
}

.characterPanelHeader {
  width: 100%;
  margin-bottom: 12px;
}

.characterPanelTopRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
}

.characterIdentityRow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.characterIdentityRow::-webkit-scrollbar {
  display: none;
}

.panelFooterRow {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.characterSummaryValue {
  font-size: var(--font-md);
  font-weight: 600;
}

.characterHeroName {
  margin: 0;
  font-size: 14px;
  line-height: 1.05;
  font-weight: 700;
  flex-shrink: 0;
}

.classTag,
.secondaryTag,
.visualMapStageChip,
.mapSubnodePill,
.badge {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.16);
  color: var(--text-muted);
  font-size: var(--font-sm);
  font-weight: 700;
  letter-spacing: 0.02em;
}

.classTag {
  min-height: 24px;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.secondaryTag {
  min-height: 22px;
  font-size: 10px;
  flex-shrink: 0;
}

.characterSummaryMetric {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.inlineMetricIcon {
  width: 16px;
  height: 16px;
  color: var(--danger);
}

.syncControlStack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  width: 100%;
}

.syncControlRow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.syncFeedback,
.syncFeedbackError,
.syncFeedbackSuccess {
  max-width: 240px;
  font-size: 12px;
  line-height: 1.5;
  text-align: right;
}

.inlinePopover {
  position: relative;
}

.inlinePopover > summary {
  list-style: none;
  cursor: pointer;
}

.inlinePopover > summary::-webkit-details-marker {
  display: none;
}

.inlinePopoverCard {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 10;
  width: min(280px, calc(100vw - 80px));
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
}

.panelTitleRow {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.panelTitle {
  margin: 0;
  font-size: 15px;
  line-height: 1.3;
}

.panelText,
.noteText {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}

.inlineStack,
.buttonRow,
.mapSubnodeRow,
.visualMapStageNodes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.metricStack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.slotGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.slotCard {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  min-height: 170px;
  text-align: left;
}

.slotCardEmpty {
  border-style: dashed;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.10)),
    rgba(248, 251, 255, 0.42);
}

.slotEyebrow {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-soft);
}

.slotTitle {
  font-size: 18px;
  font-weight: 700;
}

.slotText {
  font-size: 14px;
  line-height: 1.6;
}

.classGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.classCard {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-height: 150px;
  text-align: left;
}

.classCardSelected,
.zoneCardSelected,
.mapNodeCardCurrent {
  border-color: var(--brand-primary-border);
  box-shadow: 0 0 0 2px rgba(118, 174, 218, 0.10);
}

.classCardTitle {
  font-size: 16px;
  font-weight: 700;
}

.classCardText {
  font-size: 13px;
  line-height: 1.6;
}

.zoneCardGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.zoneCard {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  min-height: 170px;
  text-align: left;
}

.zoneCardUnlocked {
  background:
    linear-gradient(180deg, rgba(169, 215, 216, 0.12), rgba(255, 255, 255, 0.22)),
    var(--surface);
}

.zoneCardLocked {
  border-style: dashed;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.10)),
    rgba(248, 251, 255, 0.42);
  color: var(--text-soft);
}

.visualMapShell {
  gap: 14px;
}

.visualMapFrame {
  overflow-x: auto;
}

.visualMapSvg {
  display: block;
  min-width: 100%;
  width: 100%;
  height: auto;
  color: var(--text);
}

.visualMapEdge,
.pathEdge {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.visualMapEdgeBranch,
.pathEdgeBranch {
  stroke: var(--warning);
}

.visualMapEdgeMuted,
.visualMapPointMuted {
  opacity: 0.35;
}

.visualMapPoint,
.pathShape {
  fill: rgba(255, 255, 255, 0.34);
  stroke: var(--border-strong);
  stroke-width: 2;
}

.visualMapPointDone,
.pathShapeDone,
.visualMapStageChipDone,
.mapNodeCardDone,
.mapSubnodePillDone,
.badgeSuccess {
  background: var(--success-soft);
  border-color: var(--success-border);
  color: var(--success);
}

.visualMapPointCurrent,
.pathShapeCurrent,
.visualMapStageChipCurrent,
.mapSubnodePillCurrent,
.badgeInfo {
  background: var(--brand-primary-soft);
  border-color: var(--brand-primary-border);
  color: var(--brand-primary-active);
}

.visualMapPointBranch,
.pathShapeBranch,
.visualMapStageChipBranch,
.mapNodeCardBranch,
.badgeWarning {
  background: var(--warning-soft);
  border-color: var(--warning-border);
  color: var(--warning);
}

.visualMapGlyph,
.pathLabel {
  fill: currentColor;
  font-size: 12px;
  font-weight: 700;
}

.visualMapStageGrid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.visualMapStageCard {
  display: grid;
  gap: 10px;
}

.mapStageCard {
  padding: 14px;
}

.mapNodeList {
  display: grid;
  gap: 10px;
}

.mapNodeCard {
  padding: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.input,
.textarea,
.select {
  width: 100%;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.34);
  color: var(--text);
  padding: 10px 12px;
  font: inherit;
  transition:
    background var(--motion-base),
    border-color var(--motion-base),
    box-shadow var(--motion-base),
    color var(--motion-base);
}

.input::placeholder,
.textarea::placeholder {
  color: var(--text-soft);
}

.textarea {
  min-height: 110px;
  resize: vertical;
}

.input:disabled,
.textarea:disabled,
.select:disabled {
  background: rgba(255, 255, 255, 0.20);
  color: var(--text-soft);
}

.button:focus-visible,
.iconButton:focus-visible,
.input:focus-visible,
.textarea:focus-visible,
.select:focus-visible,
.menuSummary:focus-visible,
.inlinePopover > summary:focus-visible,
.details > summary:focus-visible {
  outline: none;
  border-color: var(--brand-primary);
  box-shadow: var(--shadow-focus);
}

.keyValueGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
}

.keyValueItem {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.keyLabel {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.keyValue {
  font-size: 14px;
  overflow-wrap: anywhere;
}

.levelValue {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}

.errorBox,
.infoBox,
.successBox {
  padding: 12px;
  font-size: 14px;
  line-height: 1.5;
}

.errorBox {
  border-color: var(--danger-border);
  background: var(--danger-soft);
  color: var(--danger);
}

.infoBox {
  border-color: var(--info-border);
  background: var(--info-soft);
  color: var(--info);
}

.successBox {
  border-color: var(--success-border);
  background: var(--success-soft);
  color: var(--success);
}

.badge {
  padding: 4px 10px;
  font-size: 12px;
  letter-spacing: 0.02em;
}

.badgeNeutral {
  background: rgba(255, 255, 255, 0.18);
  color: var(--text-muted);
}

.badgeDanger {
  background: var(--danger-soft);
  border-color: var(--danger-border);
  color: var(--danger);
}

.divider {
  height: 1px;
  background: var(--border);
  margin: 8px 0;
}

.pre {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.details > summary {
  cursor: pointer;
  font-weight: 600;
}

.resultBattleList {
  display: grid;
  gap: 12px;
}

.resultBattleTitle {
  margin: 0;
  font-size: 16px;
  line-height: 1.3;
}

.stepperScroll {
  overflow-x: auto;
  padding-bottom: 4px;
}

.pathDiagram {
  display: block;
  width: max-content;
  min-width: 100%;
  height: auto;
}

.list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton,
.skeletonLine,
.skeletonPanel {
  border-radius: var(--radius-sm);
  background:
    linear-gradient(
      90deg,
      rgba(232, 241, 248, 0.8) 0%,
      rgba(255, 255, 255, 0.96) 50%,
      rgba(232, 241, 248, 0.8) 100%
    );
  background-size: 200% 100%;
  animation: pulse 1.4s ease infinite;
}

.skeletonLine {
  height: 14px;
}

.skeletonPanel {
  height: 144px;
}

@keyframes pulse {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -200% 0;
  }
}

@media (min-width: 900px) {
  .dashboardGrid {
    grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.9fr);
    align-items: start;
  }
}

@media (orientation: landscape) and (max-height: 540px) {
  .shell {
    padding: 8px 10px 10px;
  }

  .header {
    gap: 4px 6px;
    margin-bottom: 6px;
  }

  .title {
    font-size: 18px;
  }

  .subtitle,
  .headerMetaText {
    font-size: 10px;
    line-height: 1.2;
  }

  .dashboardGrid {
    grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.95fr);
    gap: 10px;
    align-items: stretch;
  }

  .heroPanel,
  .panel,
  .visualMapShell,
  .visualMapFrame,
  .slotCard,
  .classCard,
  .zoneCard,
  .mapStageCard,
  .resultBattleCard,
  .menuContent,
  .inlinePopoverCard {
    padding: 10px;
  }

  .slotGrid,
  .zoneCardGrid,
  .classGrid,
  .visualMapStageGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .characterSummaryGrid,
  .keyValueGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 10px;
  }

  .menuContent,
  .inlinePopoverCard {
    min-width: min(300px, calc(100vw - 20px));
  }

  .button,
  .iconButton,
  .input,
  .textarea,
  .select {
    min-height: 40px;
  }
}

@media (max-width: 720px) {
  .characterStage {
    min-height: 0;
  }

  .characterSummaryGrid {
    grid-template-columns: minmax(0, 1fr);
  }

  .characterSummaryActions {
    justify-content: flex-start;
  }

  .syncControlStack {
    align-items: flex-start;
  }

  .syncFeedback,
  .syncFeedbackError,
  .syncFeedbackSuccess {
    text-align: left;
    max-width: none;
  }

  .characterPanelTopRow {
    flex-direction: column;
    align-items: flex-start;
  }
}
```

---

## Agent prompt

```text
You are updating the UI stylesheet for RUNARA.

Project visual direction:
- bright, open, vast, breezy, grassy, sunlit, spacious
- anime-adjacent atmospheric world
- calm reclaimed ruins under daylight
- soft sky, light clouds, worn pale metal, muted grass
- not dark sci-fi, not terminal, not glossy SaaS

Target platform:
- mobile-first
- full-screen
- landscape orientation

Critical UI direction:
- preserve openness and a sense of huge space
- buttons must be transparent and bordered, not filled, so they do not feel visually restrictive
- surfaces may be lightly frosted and atmospheric, but should stay airy
- use restrained borders, pale translucent panels, soft shadows, deep slate text
- do not use heavy dark overlays
- do not use saturated generic web-app blue
- do not use thick glossy glassmorphism
- do not use heavy shadows
- do not use background-attachment: fixed

Your task:
1. Keep the existing class names and overall component structure.
2. Apply the provided bright atmospheric token system throughout the stylesheet.
3. Replace hardcoded literal colors with semantic token usage wherever possible.
4. Preserve state meanings and behavior:
   - current
   - done
   - branch
   - locked
   - unlocked
   - success
   - warning
   - danger
   - info
5. Keep the environment background visible and breathable.
6. Make all buttons and icon buttons transparent, bordered, and lightweight by default.
7. Use hover/active states that remain subtle and airy:
   - faint translucent fills
   - stronger border emphasis
   - no heavy solid fills
8. Keep panels lightly frosted, pale, and translucent.
9. Increase touch targets for landscape handheld use.
10. Tighten spacing for reduced vertical height in landscape mobile.
11. Keep focus-visible states clear and accessible.
12. Keep the output production-ready and internally consistent.

Implementation rules:
- Add the full token block at the top.
- Refactor page, shell, surfaces, buttons, inputs, badges, maps, cards, and status states to use tokens.
- Buttons:
  - default background transparent
  - bordered
  - subtle hover fill only
  - primary still transparent-bordered, with brand-colored border/text
  - danger transparent-bordered, with danger-colored border/text
- Use light atmospheric surfaces instead of white-heavy glossy surfaces.
- Keep backdrop blur moderate only.
- Preserve current layout logic unless necessary for mobile landscape fit.
- Do not leave old hardcoded light-theme utility colors behind.

Output rules:
- Return the final updated stylesheet only.
- Do not explain.
- Do not summarize.
- Do not add TODO comments.
- Complete the refactor in one pass.
```
