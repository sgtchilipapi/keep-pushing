'use client';

import { useEffect, type ReactNode } from 'react';
import { AddressType, PhantomProvider, darkTheme } from '@phantom/react-sdk';

import { logPhantomConnectClientEvent } from '../../lib/observability/phantomConnectClient';

type PhantomSdkProviderProps = {
  children: ReactNode;
};

const PHANTOM_APP_ID = '5a98fa34-66b8-4652-bf30-89a1f690c92e';
const PHANTOM_REDIRECT_URL = 'https://www.runara.quest/auth/callback/';

export default function PhantomSdkProvider({ children }: PhantomSdkProviderProps) {
  useEffect(() => {
    logPhantomConnectClientEvent({
      area: 'sdk',
      stage: 'react_sdk_provider_initialized',
      message: 'Mounted Phantom React SDK provider.',
      details: {
        appId: PHANTOM_APP_ID,
        redirectUrl: PHANTOM_REDIRECT_URL,
        providers: ['google', 'apple'],
        addressTypes: [AddressType.solana],
      },
    });
  }, []);

  return (
    <PhantomProvider
      config={{
        providers: ['google', 'apple'],
        addressTypes: [AddressType.solana],
        appId: PHANTOM_APP_ID,
        authOptions: {
          redirectUrl: PHANTOM_REDIRECT_URL,
        },
      }}
      theme={darkTheme}
      appName="Runara"
    >
      {children}
    </PhantomProvider>
  );
}
