import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Shena Care - Beauty & Skincare',
  description: 'Premium beauty and skincare products',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container">
            <a href="/" className="logo">Shena Care</a>
            <nav className="nav">
              <a href="/products">Products</a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="container">
            <p>&copy; 2024 Shena Care. All rights reserved.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
