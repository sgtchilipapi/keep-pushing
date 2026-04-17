'use client';

import type { ReactNode } from 'react';
import { AddressType, PhantomProvider, darkTheme } from '@phantom/react-sdk';

type PhantomDocsExactProviderProps = {
  children: ReactNode;
};

const PHANTOM_APP_ID = '5a98fa34-66b8-4652-bf30-89a1f690c92e';
const PHANTOM_DOCS_EXACT_REDIRECT_URL = 'https://www.runara.quest/debug/phantom-docs/auth/callback/';

export default function PhantomDocsExactProvider({
  children,
}: PhantomDocsExactProviderProps) {
  return (
    <PhantomProvider
      config={{
        providers: ['google', 'apple'],
        appId: PHANTOM_APP_ID,
        addressTypes: [AddressType.solana],
        authOptions: {
          redirectUrl: PHANTOM_DOCS_EXACT_REDIRECT_URL,
        },
      }}
      theme={darkTheme}
      appName="Runara"
    >
      {children}
    </PhantomProvider>
  );
}
