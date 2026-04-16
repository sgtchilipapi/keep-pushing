"use client";

import { useState } from "react";

import styles from "./game-shell.module.css";

type CopyShareUrlButtonProps = {
  shareUrl: string;
  shareText: string;
};

export default function CopyShareUrlButton(props: CopyShareUrlButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(props.shareText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className={`${styles.button} ${styles.buttonPrimary}`}
      onClick={() => void handleCopy()}
      title={props.shareUrl}
    >
      {copied ? "Share Link Copied" : "Copy Share Link"}
    </button>
  );
}
