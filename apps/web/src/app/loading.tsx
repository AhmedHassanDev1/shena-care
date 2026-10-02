export default function GlobalLoading() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '50vh',
    }}>
      <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
      <p style={{ marginTop: '1rem', color: 'var(--color-text-light)' }}>Loading...</p>
    </div>
  );
}
