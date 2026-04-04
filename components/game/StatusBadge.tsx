'use client';

import styles from './game-shell.module.css';

type Tone = 'neutral' | 'warning' | 'success' | 'danger' | 'info';

type StatusBadgeProps = {
  label: string;
  tone?: Tone;
};

export default function StatusBadge({ label, tone = 'neutral' }: StatusBadgeProps) {
  return <span className={`${styles.badge} ${styles[`badge${tone[0]!.toUpperCase()}${tone.slice(1)}`]}`}>{label}</span>;
}
