'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AddressType,
  type AuthProviderType,
  useConnect,
  useDisconnect,
  usePhantom,
  useSolana,
} from '@phantom/react-sdk';

import { logPhantomConnectClientEvent } from '../../../lib/observability/phantomConnectClient';
import { normalizeWalletError } from '../../../lib/solana/phantomBrowser';

type ReproEvent = {
  createdAt: string;
  message: string;
};

const CONNECT_PROVIDERS: AuthProviderType[] = ['google', 'apple', 'injected'];

function pushReproEvent(
  setEvents: React.Dispatch<React.SetStateAction<ReproEvent[]>>,
  message: string,
) {
  setEvents((current) => [{ createdAt: new Date().toISOString(), message }, ...current].slice(0, 20));
}

export default function PhantomReproPage() {
  const { connect, isConnecting: explicitConnectPending, error: explicitConnectError } = useConnect();
  const { disconnect, isDisconnecting } = useDisconnect();
  const { isConnected, isConnecting, isLoading, errors, addresses } = usePhantom();
  const { solana } = useSolana();

  const [events, setEvents] = useState<ReproEvent[]>([]);
  const [lastActionError, setLastActionError] = useState<string | null>(null);

  const solanaAddress = useMemo(
    () =>
      addresses.find((address) => address.addressType === AddressType.solana)?.address ??
      solana.publicKey ??
      null,
    [addresses, solana.publicKey],
  );

  useEffect(() => {
    const snapshot = JSON.stringify({
      isConnected,
      isConnecting,
      isLoading,
      explicitConnectPending,
      addressCount: addresses.length,
      solanaAddress,
      explicitConnectError: explicitConnectError?.message ?? null,
      connectError: errors.connect?.message ?? null,
    });

    pushReproEvent(setEvents, `state ${snapshot}`);
    logPhantomConnectClientEvent({
      area: 'sdk',
      stage: 'phantom_repro_state_snapshot',
      message: 'Captured Phantom repro page state snapshot.',
      details: JSON.parse(snapshot) as Record<string, unknown>,
    });
  }, [
    addresses.length,
    errors.connect,
    explicitConnectError,
    explicitConnectPending,
    isConnected,
    isConnecting,
    isLoading,
    solanaAddress,
  ]);

  async function handleConnect(provider: AuthProviderType) {
    setLastActionError(null);
    pushReproEvent(setEvents, `connect start provider=${provider}`);
    logPhantomConnectClientEvent({
      area: 'ui',
      stage: 'phantom_repro_connect_start',
      message: 'Starting Phantom repro connect attempt.',
      details: {
        provider,
        href: window.location.href,
      },
    });

    try {
      const result = await connect({ provider });
      pushReproEvent(
        setEvents,
        `connect success provider=${provider} addresses=${result.addresses
          .map((address) => `${address.addressType}:${address.address}`)
          .join(',')}`,
      );
      logPhantomConnectClientEvent({
        area: 'sdk',
        stage: 'phantom_repro_connect_success',
        message: 'Phantom repro connect succeeded.',
        details: {
          provider,
          addresses: result.addresses,
        },
      });
    } catch (error) {
      const normalizedError = normalizeWalletError(error);
      setLastActionError(normalizedError);
      pushReproEvent(setEvents, `connect failed provider=${provider} error=${normalizedError}`);
      logPhantomConnectClientEvent({
        area: 'sdk',
        stage: 'phantom_repro_connect_failed',
        level: 'error',
        message: 'Phantom repro connect failed.',
        details: {
          provider,
          error: normalizedError,
        },
      });
    }
  }

  async function handleDisconnect() {
    setLastActionError(null);
    pushReproEvent(setEvents, 'disconnect start');

    try {
      await disconnect();
      pushReproEvent(setEvents, 'disconnect success');
    } catch (error) {
      const normalizedError = normalizeWalletError(error);
      setLastActionError(normalizedError);
      pushReproEvent(setEvents, `disconnect failed error=${normalizedError}`);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '32px 20px 48px',
        background: 'linear-gradient(180deg, #f6efe4 0%, #efe0c5 100%)',
        color: '#2b2116',
      }}
    >
      <div
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          display: 'grid',
          gap: '20px',
        }}
      >
        <section style={{ display: 'grid', gap: '8px' }}>
          <h1 style={{ margin: 0, fontSize: '1.8rem', lineHeight: 1.15 }}>Phantom minimal repro</h1>
          <p style={{ margin: 0 }}>
            This page does only raw Phantom React SDK connect and disconnect. No backend auth finalize.
          </p>
          <p style={{ margin: 0 }}>
            Debug log: <a href="/api/debug/phantom-connect?limit=100">/api/debug/phantom-connect?limit=100</a>
          </p>
        </section>

        <section
          style={{
            display: 'grid',
            gap: '10px',
            padding: '16px',
            borderRadius: '16px',
            background: 'rgba(255,255,255,0.55)',
          }}
        >
          <strong>State</strong>
          <div>isConnected: {String(isConnected)}</div>
          <div>isConnecting: {String(isConnecting)}</div>
          <div>isLoading: {String(isLoading)}</div>
          <div>explicitConnectPending: {String(explicitConnectPending)}</div>
          <div>isDisconnecting: {String(isDisconnecting)}</div>
          <div>solanaAddress: {solanaAddress ?? 'none'}</div>
          <div>addressCount: {addresses.length}</div>
          <div>explicitConnectError: {explicitConnectError?.message ?? 'none'}</div>
          <div>connectError: {errors.connect?.message ?? 'none'}</div>
          <div>lastActionError: {lastActionError ?? 'none'}</div>
        </section>

        <section
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          {CONNECT_PROVIDERS.map((provider) => (
            <button
              key={provider}
              onClick={() => void handleConnect(provider)}
              disabled={explicitConnectPending || isConnecting}
              style={{
                border: 'none',
                borderRadius: '999px',
                padding: '12px 18px',
                background: '#2b2116',
                color: '#f6efe4',
                cursor: explicitConnectPending || isConnecting ? 'default' : 'pointer',
              }}
            >
              Connect {provider}
            </button>
          ))}
          <button
            onClick={() => void handleDisconnect()}
            disabled={isDisconnecting}
            style={{
              border: '1px solid #5b4a34',
              borderRadius: '999px',
              padding: '12px 18px',
              background: 'transparent',
              color: '#2b2116',
              cursor: isDisconnecting ? 'default' : 'pointer',
            }}
          >
            Disconnect
          </button>
        </section>

        <section
          style={{
            display: 'grid',
            gap: '10px',
            padding: '16px',
            borderRadius: '16px',
            background: 'rgba(255,255,255,0.55)',
          }}
        >
          <strong>Recent events</strong>
          {events.length === 0 ? <div>No events yet.</div> : null}
          {events.map((event) => (
            <div key={`${event.createdAt}-${event.message}`}>
              <code>{event.createdAt}</code> {event.message}
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
