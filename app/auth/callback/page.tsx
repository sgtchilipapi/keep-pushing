'use client';

import { useEffect } from 'react';
import { ConnectBox, usePhantom } from '@phantom/react-sdk';
import { useRouter } from 'next/navigation';

import { logPhantomConnectClientEvent } from '../../../lib/observability/phantomConnectClient';

export default function PhantomAuthCallbackPage() {
  const router = useRouter();
  const { isConnected, isConnecting, errors, addresses } = usePhantom();

  useEffect(() => {
    logPhantomConnectClientEvent({
      area: 'sdk',
      stage: 'auth_callback_page_loaded',
      message: 'Loaded Phantom auth callback page.',
      details: {
        isConnected,
        isConnecting,
        addressCount: addresses.length,
      },
    });
  }, [addresses.length, isConnected, isConnecting]);

  useEffect(() => {
    if (!errors.connect) {
      return;
    }

    logPhantomConnectClientEvent({
      area: 'sdk',
      stage: 'auth_callback_connect_error',
      level: 'error',
      message: 'Phantom auth callback encountered a connect error.',
      details: {
        errorName: errors.connect.name,
        errorMessage: errors.connect.message,
      },
    });
  }, [errors.connect]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    logPhantomConnectClientEvent({
      area: 'sdk',
      stage: 'auth_callback_connected',
      message: 'Phantom auth callback completed and returned a connected wallet.',
      details: {
        addressCount: addresses.length,
      },
    });
    router.replace('/');
  }, [addresses.length, isConnected, router]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'linear-gradient(180deg, #f6efe4 0%, #efe0c5 100%)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          display: 'grid',
          gap: '16px',
          justifyItems: 'center',
          textAlign: 'center',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: '1.5rem',
              lineHeight: 1.2,
              color: '#2b2116',
            }}
          >
            Completing sign-in
          </h1>
          <p
            style={{
              margin: '8px 0 0',
              color: '#5b4a34',
            }}
          >
            Finish the Phantom connection to continue into Runara.
          </p>
        </div>
        <ConnectBox />
      </div>
    </main>
  );
}
