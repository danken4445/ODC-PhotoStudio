import React from 'react';

export const metadata = {
  title: 'ODC-PhotoStudio — Portal & Customer Gallery',
  description: 'Commercial multi-tenant DSLR photobooth portal and expiring customer gallery',
  robots: {
    index: false,
    follow: false
  },
  referrer: 'no-referrer' as const
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          backgroundColor: '#09090B',
          color: '#FAFAFA',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        {children}
      </body>
    </html>
  );
}
