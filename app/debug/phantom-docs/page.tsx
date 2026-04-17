import PhantomDocsExactLogin from '../../../components/debug/PhantomDocsExactLogin';
import PhantomDocsExactProvider from '../../../components/debug/PhantomDocsExactProvider';

export default function PhantomDocsExactPage() {
  return (
    <PhantomDocsExactProvider>
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'linear-gradient(180deg, #f6efe4 0%, #efe0c5 100%)',
          color: '#2b2116',
        }}
      >
        <PhantomDocsExactLogin />
      </main>
    </PhantomDocsExactProvider>
  );
}
