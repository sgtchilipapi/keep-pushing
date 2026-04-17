"use client";

import { useState, type TouchEvent } from "react";
import Link from "next/link";

import {
  MockActionPanel,
  MockActionPair,
  MockActionRow,
  MockAppShell,
  MockButton,
  MockKeyValueList,
  MockScreenStack,
  MockScrollablePane,
  MockSectionCard,
  MockStatusBadge,
} from "./AppShell";
import {
  mockCharacterSummary,
  mockCharacterSlots,
  mockCreateClasses,
  mockEncounterLog,
  mockPlayerAccount,
  mockRunSummary,
  mockSyncAttempts,
  mockSyncSummary,
  mockZoneCards,
} from "./mockupData";
import styles from "./mockups.module.css";

export function MockLandingScreen() {
  return (
    <main className={styles.landingPage}>
      <div className={styles.landingShell}>
        <section className={styles.landingHero}>
          <span className={styles.landingEyebrow}>Portrait App Shell</span>
          <h1 className={styles.landingTitle}>RUNARA mockup review space.</h1>
          <p className={styles.landingText}>
            These routes are skeletal layout studies only. They keep the live UI
            untouched while locking app-shell composition, navigation placement,
            and reusable page primitives.
          </p>
        </section>

        <section className={styles.landingGrid}>
          <Link href="/mockups/characters" className={styles.linkCard}>
            <span className={styles.linkCardTitle}>Characters</span>
            <span className={styles.linkCardBody}>
              Roster list, create entry, and contextual character detail.
            </span>
          </Link>
          <Link href="/mockups/run" className={styles.linkCard}>
            <span className={styles.linkCardTitle}>Run</span>
            <span className={styles.linkCardBody}>
              Portrait-first run selection, route state, and compact action
              surfaces.
            </span>
          </Link>
          <Link href="/mockups/sync" className={styles.linkCard}>
            <span className={styles.linkCardTitle}>Sync</span>
            <span className={styles.linkCardBody}>
              Pending work, device feedback, and scroll-bounded attempt history.
            </span>
          </Link>
          <Link href="/mockups/runs/run_014" className={styles.linkCard}>
            <span className={styles.linkCardTitle}>Run Result</span>
            <span className={styles.linkCardBody}>
              Summary pinned high, encounter history constrained to the content
              region.
            </span>
          </Link>
        </section>
      </div>
    </main>
  );
}

export function MockCharactersScreen() {
  const subtitle = mockPlayerAccount.verifiedAccount
    ? undefined
    : "Sign-up to unlock 2 more slots.";

  return (
    <MockAppShell activeNav="characters" label="Characters">
      <MockScreenStack>
        <div className={[styles.screenStack, styles.screenFill].join(" ")}>
          <div>
            <h2 className={styles.sectionTitle}>Characters</h2>
            {subtitle ? <p className={styles.sectionText}>{subtitle}</p> : null}
          </div>
          <MockScrollablePane>
            {mockCharacterSlots.map((slot) =>
              slot.state === "occupied" ? (
                <Link
                  key={slot.character.id}
                  href={`/mockups/characters/${encodeURIComponent(slot.character.id)}`}
                  className={styles.linkCard}
                >
                  <div className={styles.listCardHeader}>
                    <div>
                      <div className={styles.listCardTitle}>{slot.character.name}</div>
                      <div className={styles.listCardBody}>
                        {slot.character.className}
                      </div>
                    </div>
                    <MockStatusBadge
                      label={`Lvl ${slot.character.level}`}
                      tone="warning"
                    />
                  </div>
                  <div className={styles.listCardBody}>
                    {slot.character.summary}
                  </div>
                </Link>
              ) : slot.state === "open" ? (
                <Link
                  key={`open-slot-${slot.slot}`}
                  href="/mockups/characters/create"
                  className={styles.linkCard}
                >
                  <div className={styles.listCardHeader}>
                    <div>
                      <div className={styles.listCardTitle}>Empty</div>
                      <div className={styles.listCardBody}>{slot.summary}</div>
                    </div>
                    <MockStatusBadge label="EMPTY" tone="outline" />
                  </div>
                </Link>
              ) : (
                <div
                  key={`locked-slot-${slot.slot}`}
                  className={[styles.linkCard, styles.linkCardLocked].join(" ")}
                >
                  <div className={styles.listCardHeader}>
                    <div>
                      <div className={styles.listCardTitle}>Locked</div>
                      <div className={styles.listCardBody}>{slot.summary}</div>
                    </div>
                    <MockStatusBadge label="LOCKED" tone="neutral" />
                  </div>
                </div>
              ),
            )}
          </MockScrollablePane>
        </div>
      </MockScreenStack>
    </MockAppShell>
  );
}

export function MockCreateCharacterScreen() {
  const [selectedClassId, setSelectedClassId] = useState(
    mockCreateClasses[0]?.id ?? "",
  );

  return (
    <MockAppShell activeNav="characters" label="Create">
      <MockScreenStack>
        <MockSectionCard title="Choose a class" fill>
          <MockScrollablePane>
            <div className={styles.classGrid}>
              {mockCreateClasses.map((item) => {
                const isActive = item.id === selectedClassId;

                return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSelectedClassId(item.id)}
                  className={[
                    styles.classCard,
                    styles.classCardButton,
                    isActive ? styles.classCardActive : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className={styles.classCardHeader}>
                    <div className={styles.classCardSummary}>
                      <div className={styles.listCardTitle}>{item.name}</div>
                      <div className={styles.listCardBody}>{item.body}</div>
                    </div>
                    <span
                      className={[
                        styles.radioDot,
                        isActive ? styles.radioDotActive : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  </div>
                  {isActive ? (
                    <div className={styles.classCardExpand}>
                      <div className={styles.listCardBody}>{item.details}</div>
                      <div className={styles.classCardStats}>
                        {item.stats.map((stat) => (
                          <span key={stat} className={styles.classCardStat}>
                            {stat}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </button>
                );
              })}
            </div>

            <div className={styles.fieldGrid}>
              <label className={styles.fieldLabel}>
                Character name
                <input className={styles.input} value="Aegis" readOnly />
              </label>
            </div>
          </MockScrollablePane>
        </MockSectionCard>

        <MockActionPanel
          secondary={
            <MockButton href="/mockups/characters" tone="ghost">
              Back
            </MockButton>
          }
          primary={
            <MockButton href="/mockups/characters/rookie-01" tone="primary">
              Create and continue
            </MockButton>
          }
        />
      </MockScreenStack>
    </MockAppShell>
  );
}

export function MockCharacterOverviewScreen() {
  return (
    <MockAppShell activeNav="characters" label="Character">
      <MockScreenStack>
        <MockSectionCard
          title="Astra"
          body="Warden"
          badge={<MockStatusBadge label="Lvl 7" tone="warning" />}
        >
          <div className={styles.keyValueGrid}>
            <div className={styles.keyValueItem}>
              <span className={styles.keyLabel}>Exp</span>
              <span className={styles.keyValue}>820 / 1000</span>
            </div>
            <div className={styles.keyValueItem}>
              <span className={styles.keyLabel}>Sync</span>
              <span className={styles.keyValueInline}>
                <span className={styles.keyValue}>UNSYNCED</span>
                <Link
                  href="/mockups/sync"
                  className={styles.miniIconButton}
                  aria-label="Open sync"
                  title="Open sync"
                >
                  ↻
                </Link>
              </span>
            </div>
            <div className={styles.keyValueItem}>
              <span className={styles.keyLabel}>Highest zone</span>
              <span className={styles.keyValue}>Zone 2</span>
            </div>
          </div>
        </MockSectionCard>
        <MockActionPanel
          secondary={
            <MockButton href="/mockups/characters" tone="ghost">
              Back
            </MockButton>
          }
          primary={
            <MockButton href="/mockups/run" tone="primary">
              Run
            </MockButton>
          }
        />
      </MockScreenStack>
    </MockAppShell>
  );
}

export function MockRunScreen() {
  const latestUnlockedIndex = Math.max(
    0,
    mockZoneCards.findLastIndex((zone) => zone.status !== "Locked"),
  );
  const [activeZoneIndex, setActiveZoneIndex] = useState(latestUnlockedIndex);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const maxZoneIndex = Math.max(0, mockZoneCards.length - 1);
  const activeZone =
    mockZoneCards[Math.min(activeZoneIndex, maxZoneIndex)] ?? mockZoneCards[0];
  const canGoLeft = activeZoneIndex > 0;
  const canGoRight = activeZoneIndex < maxZoneIndex;

  function moveZone(direction: -1 | 1) {
    setActiveZoneIndex((current) =>
      Math.min(maxZoneIndex, Math.max(0, current + direction)),
    );
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    setTouchStartX(event.changedTouches[0]?.clientX ?? null);
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = touchStartX;
    const endX = event.changedTouches[0]?.clientX ?? null;
    setTouchStartX(null);

    if (startX === null || endX === null) {
      return;
    }

    const deltaX = endX - startX;
    if (Math.abs(deltaX) < 36) {
      return;
    }

    if (deltaX < 0 && canGoRight) {
      moveZone(1);
      return;
    }

    if (deltaX > 0 && canGoLeft) {
      moveZone(-1);
    }
  }

  return (
    <MockAppShell activeNav="run" label="Run">
      <MockScreenStack>
        <div className={[styles.screenStack, styles.screenFill].join(" ")}>
          <div>
            <h2 className={styles.sectionTitle}>Zones</h2>
          </div>
          <div
            className={styles.carouselShell}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className={styles.carouselFrame}>
              <button
                type="button"
                className={[
                  styles.carouselIndicator,
                  styles.carouselIndicatorButton,
                  styles.carouselIndicatorLeft,
                ].join(" ")}
                onClick={(event) => {
                  event.stopPropagation();
                  moveZone(-1);
                }}
                disabled={!canGoLeft}
                aria-label="Previous zone"
              >
                ‹
              </button>
              <div className={[styles.listCard, styles.carouselSlide].join(" ")}>
                <div className={styles.listCardHeader}>
                  <div>
                    <div className={styles.listCardTitle}>
                      {activeZone?.zoneId.replace("Zone ", "")} · {activeZone?.title}
                    </div>
                    <div className={styles.listCardBody}>{activeZone?.body}</div>
                  </div>
                  <MockStatusBadge
                    label={activeZone?.status ?? ""}
                    tone={
                      activeZone?.status === "Unlocked"
                        ? "outline"
                        : activeZone?.status === "Locked"
                          ? "neutral"
                          : activeZone?.tone ?? "neutral"
                    }
                  />
                </div>
              </div>
              <button
                type="button"
                className={[
                  styles.carouselIndicator,
                  styles.carouselIndicatorButton,
                  styles.carouselIndicatorRight,
                ].join(" ")}
                onClick={(event) => {
                  event.stopPropagation();
                  moveZone(1);
                }}
                disabled={!canGoRight}
                aria-label="Next zone"
              >
                ›
              </button>
            </div>
            <div className={styles.carouselDots} aria-hidden="true">
              {mockZoneCards.map((zone, index) => (
                <span
                  key={zone.zoneId}
                  className={[
                    styles.carouselDot,
                    index === activeZoneIndex ? styles.carouselDotActive : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              ))}
            </div>
          </div>
        </div>
        <MockActionPanel
          secondary={
            <MockButton href="/mockups/runs/run_014" tone="ghost">
              View route
            </MockButton>
          }
          primary={
            <MockButton href="/mockups/runs/run_014" tone="primary">
              Start run
            </MockButton>
          }
        />
      </MockScreenStack>
    </MockAppShell>
  );
}

export function MockSyncScreen() {
  return (
    <MockAppShell activeNav="sync" label="Sync">
      <MockScreenStack>
        <MockSectionCard
          title="Pending work"
          body="Sync keeps the high-priority action near the top and pushes history into a bounded pane."
          badge={<MockStatusBadge label="Settlement" tone="warning" />}
        >
          <MockKeyValueList items={mockSyncSummary} />
        </MockSectionCard>
        <MockActionPanel
          secondary={<MockButton tone="ghost">Refresh state</MockButton>}
          primary={<MockButton tone="primary">Submit oldest run</MockButton>}
        />

        <MockSectionCard
          title="Attempt history"
          body="This is one of the few areas allowed to scroll."
          fill
        >
          <MockScrollablePane>
            {mockSyncAttempts.map((attempt) => (
              <div key={attempt.id} className={styles.listCard}>
                <div className={styles.listCardHeader}>
                  <div>
                    <div className={styles.listCardTitle}>{attempt.title}</div>
                    <div className={styles.listCardBody}>{attempt.time}</div>
                  </div>
                  <MockStatusBadge label={attempt.status} tone={attempt.tone} />
                </div>
                <div className={styles.listCardBody}>{attempt.detail}</div>
              </div>
            ))}
          </MockScrollablePane>
        </MockSectionCard>
      </MockScreenStack>
    </MockAppShell>
  );
}

export function MockRunResultScreen(props: { publicView?: boolean }) {
  return (
    <MockAppShell activeNav="run" label={props.publicView ? "Shared run" : "Run result"}>
      <MockScreenStack>
        <MockSectionCard
          title={props.publicView ? "Shared run" : "Run result"}
          body="The run summary stays fixed high in the shell while the long log scrolls below."
          badge={<MockStatusBadge label="COMPLETED" tone="success" />}
        >
          <MockKeyValueList items={mockRunSummary} />
        </MockSectionCard>
        <MockActionPanel
          secondary={
            <MockButton href="/mockups/run" tone="ghost">
              Back to run
            </MockButton>
          }
          primary={
            <MockButton tone="primary">
              {props.publicView ? "Open result" : "Copy share link"}
            </MockButton>
          }
        />

        <MockSectionCard
          title="Encounter log"
          body="Only the battle list scrolls when the run gets long."
          fill
        >
          <MockScrollablePane>
            {mockEncounterLog.map((battle) => (
              <div key={battle.id} className={styles.listCard}>
                <div className={styles.listCardHeader}>
                  <div>
                    <div className={styles.listCardTitle}>{battle.enemy}</div>
                    <div className={styles.listCardBody}>Node {battle.node}</div>
                  </div>
                  <MockStatusBadge label={battle.status} tone={battle.tone} />
                </div>
                <div className={styles.keyValueGrid}>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyLabel}>Winner</span>
                    <span className={styles.keyValue}>{battle.winner}</span>
                  </div>
                  <div className={styles.keyValueItem}>
                    <span className={styles.keyLabel}>Rounds</span>
                    <span className={styles.keyValue}>{battle.rounds}</span>
                  </div>
                </div>
              </div>
            ))}
          </MockScrollablePane>
        </MockSectionCard>
      </MockScreenStack>
    </MockAppShell>
  );
}
