import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./mockups.module.css";
import type { MockKeyValueItem, MockTone } from "./mockupData";

type MockNavKey = "characters" | "run" | "sync";

type MockAppShellProps = {
  activeNav: MockNavKey;
  label?: string;
  children: ReactNode;
};

type MockSectionCardProps = {
  title: string;
  body?: string;
  badge?: ReactNode;
  fill?: boolean;
  children?: ReactNode;
};

type MockStatusBadgeProps = {
  label: string;
  tone?: MockTone;
};

type MockKeyValueListProps = {
  items: MockKeyValueItem[];
};

export function MockAppShell(props: MockAppShellProps) {
  return (
    <main className={styles.shellBackdrop}>
      <div className={styles.shellFrame}>
        <header className={styles.topBar}>
          <div className={styles.brand}>RUNARA</div>
          <div className={styles.topMeta}>{props.label ?? "Mockup"}</div>
        </header>

        <div className={styles.screenBody}>{props.children}</div>

        <nav className={styles.footNav} aria-label="Mockup navigation">
          <Link
            href="/mockups/characters"
            className={[
              styles.footNavLink,
              props.activeNav === "characters" ? styles.footNavLinkActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            Characters
          </Link>
          <Link
            href="/mockups/run"
            className={[
              styles.footNavLink,
              props.activeNav === "run" ? styles.footNavLinkActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            Run
          </Link>
          <Link
            href="/mockups/sync"
            className={[
              styles.footNavLink,
              props.activeNav === "sync" ? styles.footNavLinkActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            Sync
          </Link>
        </nav>
      </div>
    </main>
  );
}

export function MockScreenStack({ children }: { children: ReactNode }) {
  return <div className={styles.screenStack}>{children}</div>;
}

export function MockSectionCard(props: MockSectionCardProps) {
  return (
    <section
      className={[
        styles.sectionCard,
        props.fill ? styles.sectionCardFill : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>{props.title}</h2>
          {props.body ? <p className={styles.sectionText}>{props.body}</p> : null}
        </div>
        {props.badge ?? null}
      </div>
      {props.children ?? null}
    </section>
  );
}

export function MockScrollablePane({ children }: { children: ReactNode }) {
  return <div className={styles.scrollPane}>{children}</div>;
}

export function MockActionRow({ children }: { children: ReactNode }) {
  return <div className={styles.actionRow}>{children}</div>;
}

export function MockActionPair(props: {
  secondary: ReactNode;
  primary: ReactNode;
}) {
  return (
    <MockActionRow>
      {props.secondary}
      {props.primary}
    </MockActionRow>
  );
}

export function MockActionPanel(props: {
  secondary: ReactNode;
  primary: ReactNode;
}) {
  return (
    <section className={[styles.sectionCard, styles.actionPanel].join(" ")}>
      <MockActionPair secondary={props.secondary} primary={props.primary} />
    </section>
  );
}

export function MockButton(props: {
  href?: string;
  children: ReactNode;
  tone?: "primary" | "ghost";
  onClick?: () => void;
}) {
  const className = [
    styles.button,
    props.tone === "primary" ? styles.buttonPrimary : "",
    props.tone === "ghost" ? styles.buttonGhost : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (props.href) {
    return (
      <Link href={props.href} className={className}>
        {props.children}
      </Link>
    );
  }

  return (
    <button type="button" className={className} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

export function MockStatusBadge({
  label,
  tone = "neutral",
}: MockStatusBadgeProps) {
  const toneClass =
    tone === "outline"
      ? styles.badgeOutline
      : tone === "info"
      ? styles.badgeInfo
      : tone === "success"
        ? styles.badgeSuccess
        : tone === "warning"
          ? styles.badgeWarning
          : tone === "danger"
            ? styles.badgeDanger
            : styles.badgeNeutral;

  return <span className={[styles.badge, toneClass].join(" ")}>{label}</span>;
}

export function MockKeyValueList({ items }: MockKeyValueListProps) {
  return (
    <div className={styles.keyValueGrid}>
      {items.map((item) => (
        <div key={item.label} className={styles.keyValueItem}>
          <span className={styles.keyLabel}>{item.label}</span>
          <span className={styles.keyValue}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}
