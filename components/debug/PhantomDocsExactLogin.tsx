'use client';

import { useModal, usePhantom } from '@phantom/react-sdk';

export default function PhantomDocsExactLogin() {
  const { open } = useModal();
  const { isConnected, addresses } = usePhantom();

  if (isConnected) {
    return (
      <div
        style={{
          display: 'grid',
          gap: '12px',
          textAlign: 'center',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.8rem' }}>Connected</h1>
        <p style={{ margin: 0 }}>Wallet: {addresses[0]?.address ?? 'unknown'}</p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: '16px',
        textAlign: 'center',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '1.8rem' }}>Phantom docs exact repro</h1>
      <p style={{ margin: 0 }}>
        This page follows Phantom&apos;s official React SDK social login pattern as closely as possible.
      </p>
      <div>
        <button
          onClick={open}
          style={{
            border: 'none',
            borderRadius: '999px',
            padding: '12px 18px',
            background: '#2b2116',
            color: '#f6efe4',
            cursor: 'pointer',
          }}
        >
          Continue with Google or Apple
        </button>
      </div>
    </div>
  );
}
