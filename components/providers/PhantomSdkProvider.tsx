'use client';

import type { ReactNode } from 'react';
import { AddressType, PhantomProvider, darkTheme } from '@phantom/react-sdk';

type PhantomSdkProviderProps = {
  children: ReactNode;
};

const PHANTOM_APP_ID = '5a98fa34-66b8-4652-bf30-89a1f690c92e';
const PHANTOM_REDIRECT_URL = 'https://www.runara.quest';

export default function PhantomSdkProvider({ children }: PhantomSdkProviderProps) {
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
