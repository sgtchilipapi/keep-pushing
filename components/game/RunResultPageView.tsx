import Link from "next/link";

import type { RunResultReadModel } from "../../types/api/frontend";
import CopyShareUrlButton from "./CopyShareUrlButton";
import StatusBadge from "./StatusBadge";
import styles from "./game-shell.module.css";

function shareTone(
  shareStatus: RunResultReadModel["shareStatus"],
): "warning" | "success" | "danger" {
  switch (shareStatus) {
    case "SYNCED":
      return "success";
    case "EXPIRED":
      return "danger";
    case "PENDING":
    default:
      return "warning";
  }
}

function terminalTone(
  terminalStatus: string,
): "success" | "warning" | "danger" | "info" {
  switch (terminalStatus) {
    case "COMPLETED":
      return "success";
    case "ABANDONED":
      return "warning";
    case "FAILED":
    case "EXPIRED":
    case "SEASON_CUTOFF":
    default:
      return "danger";
  }
}

type RunResultPageViewProps = {
  run: RunResultReadModel;
  publicView?: boolean;
  origin: string;
};

export default function RunResultPageView(props: RunResultPageViewProps) {
  const shareUrl = new URL(props.run.shareUrl, props.origin).toString();
  const resultUrl = new URL(props.run.resultUrl, props.origin).toString();
  const shareText = `${props.run.characterName} finished Zone ${props.run.zoneId} in RUNARA. ${shareUrl}`;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.stack}>
            <span className={styles.eyebrow}>
              {props.publicView ? "Shared Run" : "Run Result"}
            </span>
            <h1 className={styles.title}>
              {props.run.characterName} · Zone {props.run.zoneId}
            </h1>
            <p className={styles.subtitle}>
              {props.publicView
                ? "Public-by-link recap of a completed or pending run."
                : "Canonical run result keyed by run id."}
            </p>
          </div>

          <div className={styles.toolbar}>
            <StatusBadge
              label={props.run.terminalStatus}
              tone={terminalTone(props.run.terminalStatus)}
            />
            <StatusBadge
              label={props.run.shareStatusLabel}
              tone={shareTone(props.run.shareStatus)}
            />
          </div>
        </header>

        <div className={styles.panelGrid}>
          <section className={styles.panel}>
            <div className={styles.panelTitleRow}>
              <div className={styles.stack}>
                <h2 className={styles.panelTitle}>Summary</h2>
                <p className={styles.panelText}>{props.run.shareStatusDetail}</p>
              </div>
              <div className={styles.buttonRow}>
                {!props.publicView ? (
                  <CopyShareUrlButton shareUrl={shareUrl} shareText={shareText} />
                ) : null}
                <Link href="/" className={styles.button}>
                  Back to Game
                </Link>
              </div>
            </div>

            <div className={styles.keyValueGrid}>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Run ID</span>
                <span className={styles.keyValue}>{props.run.runId}</span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Class</span>
                <span className={styles.keyValue}>{props.run.classId}</span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Season</span>
                <span className={styles.keyValue}>Season {props.run.seasonId}</span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Topology</span>
                <span className={styles.keyValue}>
                  v{props.run.topologyVersion} · {props.run.topologyHash}
                </span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Battles</span>
                <span className={styles.keyValue}>
                  {props.run.rewardedBattleCount}/{props.run.battleCount} rewarded
                </span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Closed At</span>
                <span className={styles.keyValue}>
                  {props.run.closedAt
                    ? new Date(props.run.closedAt).toLocaleString()
                    : "Pending completion"}
                </span>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Result URL</span>
                <a href={resultUrl} className={styles.keyValue}>
                  {resultUrl}
                </a>
              </div>
              <div className={styles.keyValueItem}>
                <span className={styles.keyLabel}>Share URL</span>
                <a href={shareUrl} className={styles.keyValue}>
                  {shareUrl}
                </a>
              </div>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitleRow}>
              <div className={styles.stack}>
                <h2 className={styles.panelTitle}>Encounter Log</h2>
                <p className={styles.panelText}>
                  Reward and settlement state for each battle resolved inside this run.
                </p>
              </div>
            </div>

            <div className={styles.resultBattleList}>
              {props.run.battles.map((battle) => (
                <article
                  key={battle.battleId}
                  className={styles.resultBattleCard}
                >
                  <div className={styles.panelTitleRow}>
                    <div className={styles.stack}>
                      <h3 className={styles.resultBattleTitle}>
                        {battle.enemyName}
                      </h3>
                      <p className={styles.noteText}>
                        {battle.nodeId ?? "unknown-node"} /{" "}
                        {battle.subnodeId ?? "unknown-subnode"}
                      </p>
                    </div>
                    <div className={styles.inlineStack}>
                      <StatusBadge
                        label={battle.rewardEligible ? "Rewarded" : "No Reward"}
                        tone={battle.rewardEligible ? "success" : "warning"}
                      />
                      {battle.settlementStatus ? (
                        <StatusBadge
                          label={battle.settlementStatus}
                          tone={
                            battle.settlementStatus === "COMMITTED"
                              ? "success"
                              : battle.settlementStatus ===
                                  "LOCAL_ONLY_ARCHIVED"
                                ? "danger"
                                : "warning"
                          }
                        />
                      ) : null}
                    </div>
                  </div>

                  <div className={styles.keyValueGrid}>
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyLabel}>Battle</span>
                      <span className={styles.keyValue}>{battle.battleId}</span>
                    </div>
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyLabel}>Winner</span>
                      <span className={styles.keyValue}>
                        {battle.winnerEntityId}
                      </span>
                    </div>
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyLabel}>Rounds</span>
                      <span className={styles.keyValue}>
                        {battle.roundsPlayed}
                      </span>
                    </div>
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyLabel}>Resolved At</span>
                      <span className={styles.keyValue}>
                        {new Date(battle.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
