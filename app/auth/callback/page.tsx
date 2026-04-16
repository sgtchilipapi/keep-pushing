'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AddressType, ConnectBox, usePhantom, useSolana } from '@phantom/react-sdk';
import { useRouter } from 'next/navigation';

import {
  clearPendingAuthProvider,
  readPendingAuthProvider,
} from '../../../lib/auth/phantomConnectClient';
import { logPhantomConnectClientEvent } from '../../../lib/observability/phantomConnectClient';
import { normalizeWalletError, signAuthorizationMessageUtf8 } from '../../../lib/solana/phantomBrowser';
import {
  createReactSdkSolanaProvider,
  getReactSdkSolanaAddress,
} from '../../../lib/solana/reactPhantomBridge';

type AuthNonceResponse = {
  ok: true;
  data: {
    nonceId: string;
    expiresAt: string;
    messageToSign: string;
  };
};

type ApiErrorShape = {
  error?: string;
};

type ApiEnvelopeErrorShape = {
  error?: {
    code?: string;
  };
};

type ApiError = Error & {
  status?: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function apiRequest<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => null)) as
    | T
    | ApiErrorShape
    | ApiEnvelopeErrorShape
    | null;

  if (!response.ok) {
    const message =
      isObject(data) && typeof data.error === 'string'
        ? data.error
        : isObject(data) &&
            'error' in data &&
            isObject(data.error) &&
            typeof data.error.code === 'string'
          ? data.error.code
          : `Request failed with status ${response.status}`;
    const error = new Error(message) as ApiError;
    error.status = response.status;
    throw error;
  }

  return data as T;
}

export default function PhantomAuthCallbackPage() {
  const router = useRouter();
  const { solana } = useSolana();
  const { isConnected, isConnecting, errors, addresses } = usePhantom();
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [isFinishingLogin, setIsFinishingLogin] = useState(false);
  const completedWalletRef = useRef<string | null>(null);
  const walletPublicKey = useMemo(
    () =>
      getReactSdkSolanaAddress(addresses, AddressType.solana) ??
      solana.publicKey ??
      null,
    [addresses, solana.publicKey],
  );
  const walletProvider = useMemo(
    () => createReactSdkSolanaProvider(solana, walletPublicKey),
    [solana, walletPublicKey],
  );

  useEffect(() => {
    logPhantomConnectClientEvent({
      area: 'sdk',
      stage: 'auth_callback_page_loaded',
      message: 'Loaded Phantom auth callback page.',
      details: {
        isConnected,
        isConnecting,
        addressCount: addresses.length,
        pendingAuthProvider: readPendingAuthProvider(),
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
    if (!isConnected || !walletPublicKey || walletProvider === null) {
      return;
    }

    if (completedWalletRef.current === walletPublicKey) {
      return;
    }

    const pendingAuthProvider = readPendingAuthProvider();
    if (pendingAuthProvider === 'injected') {
      clearPendingAuthProvider();
      router.replace('/');
      return;
    }

    completedWalletRef.current = walletPublicKey;
    let cancelled = false;
    setCallbackError(null);
    setIsFinishingLogin(true);
    logPhantomConnectClientEvent({
      area: 'auth',
      stage: 'auth_callback_finalize_started',
      message: 'Starting backend login finalization from auth callback.',
      details: {
        walletPublicKey,
        authProvider: pendingAuthProvider,
        addressCount: addresses.length,
      },
    });

    void apiRequest<AuthNonceResponse>('/api/v1/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({
        chain: 'solana',
        walletAddress: walletPublicKey,
      }),
    })
      .then(async (nonce) => {
        const signatureBase64 = await signAuthorizationMessageUtf8(
          walletProvider,
          nonce.data.messageToSign,
        );

        await apiRequest('/api/v1/auth/verify', {
          method: 'POST',
          headers: pendingAuthProvider
            ? { 'x-phantom-provider': pendingAuthProvider }
            : undefined,
          body: JSON.stringify({
            nonceId: nonce.data.nonceId,
            walletAddress: walletPublicKey,
            signatureBase64,
            signedMessage: nonce.data.messageToSign,
          }),
        });
      })
      .then(() => {
        if (cancelled) {
          return;
        }

        clearPendingAuthProvider();
        logPhantomConnectClientEvent({
          area: 'auth',
          stage: 'auth_callback_finalize_succeeded',
          message: 'Auth callback finished backend login successfully.',
          details: {
            walletPublicKey,
          },
        });
        router.replace('/');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        completedWalletRef.current = null;
        const normalizedError = normalizeWalletError(error);
        setCallbackError(normalizedError);
        setIsFinishingLogin(false);
        logPhantomConnectClientEvent({
          area: 'auth',
          stage: 'auth_callback_finalize_failed',
          level: 'error',
          message: 'Auth callback failed while finishing backend login.',
          details: {
            walletPublicKey,
            authProvider: pendingAuthProvider,
            error: normalizedError,
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [addresses.length, isConnected, router, walletProvider, walletPublicKey]);

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
          {isFinishingLogin ? (
            <p
              style={{
                margin: '8px 0 0',
                color: '#5b4a34',
              }}
            >
              Finalizing wallet login.
            </p>
          ) : null}
          {callbackError ? (
            <p
              style={{
                margin: '8px 0 0',
                color: '#9f2d18',
              }}
            >
              {callbackError}
            </p>
          ) : null}
        </div>
        <ConnectBox />
      </div>
    </main>
  );
}
