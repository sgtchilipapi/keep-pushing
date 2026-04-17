import { ConnectBox } from '@phantom/react-sdk';

import PhantomDocsExactProvider from '../../../../../components/debug/PhantomDocsExactProvider';

export default function PhantomDocsExactCallbackPage() {
  return (
    <PhantomDocsExactProvider>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: 'linear-gradient(180deg, #f6efe4 0%, #efe0c5 100%)',
        }}
      >
        <ConnectBox />
      </div>
    </PhantomDocsExactProvider>
  );
}
