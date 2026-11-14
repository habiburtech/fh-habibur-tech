import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'FH Habibur Tech | Management System', description: 'Client, campaign and finance management' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
