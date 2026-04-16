'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  AddressType,
  DebugLevel,
  PhantomProvider,
  darkTheme,
  type DebugMessage,
  type PhantomSDKConfig,
} from '@phantom/react-sdk';

import { logPhantomConnectClientEvent } from '../../lib/observability/phantomConnectClient';

type PhantomSdkProviderProps = {
  children: ReactNode;
};

type PhantomSDKConfigWithAutoConnect = PhantomSDKConfig & {
  autoConnect?: boolean;
};

const PHANTOM_APP_ID = '5a98fa34-66b8-4652-bf30-89a1f690c92e';
const PHANTOM_REDIRECT_URL = 'https://www.runara.quest/auth/callback/';

function mapDebugLevel(level: DebugLevel): 'info' | 'warn' | 'error' {
  switch (level) {
    case DebugLevel.ERROR:
      return 'error';
    case DebugLevel.WARN:
      return 'warn';
    default:
      return 'info';
  }
}

export default function PhantomSdkProvider({ children }: PhantomSdkProviderProps) {
  const pathname = usePathname();
  const autoConnect = pathname === '/auth/callback' || pathname === '/auth/callback/';

  useEffect(() => {
    logPhantomConnectClientEvent({
      area: 'sdk',
      stage: 'react_sdk_provider_initialized',
      message: 'Mounted Phantom React SDK provider.',
      details: {
        appId: PHANTOM_APP_ID,
        redirectUrl: PHANTOM_REDIRECT_URL,
        providers: ['google', 'apple', 'injected'],
        addressTypes: [AddressType.solana],
        autoConnect,
        pathname,
      },
    });
  }, [autoConnect, pathname]);

  const debugConfig = useMemo(
    () => ({
      enabled: true,
      level: DebugLevel.INFO,
      callback: (message: DebugMessage) => {
        logPhantomConnectClientEvent({
          area: 'sdk',
          stage: `sdk_native_${message.category.toLowerCase()}`,
          level: mapDebugLevel(message.level),
          message: message.message,
          details: {
            category: message.category,
            data: message.data ?? null,
            timestamp: message.timestamp,
          },
        });
      },
    }),
    [],
  );

  const config = useMemo<PhantomSDKConfigWithAutoConnect>(
    () => ({
      providers: ['google', 'apple', 'injected'],
      addressTypes: [AddressType.solana],
      appId: PHANTOM_APP_ID,
      autoConnect,
      authOptions: {
        redirectUrl: PHANTOM_REDIRECT_URL,
      },
    }),
    [autoConnect],
  );

  return (
    <PhantomProvider
      config={config}
      debugConfig={debugConfig}
      theme={darkTheme}
      appName="Runara"
    >
      {children}
    </PhantomProvider>
  );
}
