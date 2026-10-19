'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ShieldAlert, Users, UserPlus, LogOut, Menu, X, ShieldCheck } from 'lucide-react';

interface AdminNavBarProps {
  userEmail?: string;
}

export function AdminNavBar({ userEmail = 'admin@odc.local' }: AdminNavBarProps): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await fetch('/api/odc/auth/logout', { method: 'POST' });
    } catch {
      // Continue with redirect
    }
    // Hard navigate to clear any in-memory state
    window.location.href = '/odc/login';
  };

  const navLinks = [
    {
      name: 'Tenants',
      href: '/odc',
      icon: Users,
      isActive: pathname === '/odc' || pathname.startsWith('/odc/tenants')
    },
    {
      name: 'Onboard Client',
      href: '/odc/onboard',
      icon: UserPlus,
      isActive: pathname === '/odc/onboard'
    }
  ];

  return (
    <nav className="border-b border-zinc-800 bg-zinc-900/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand */}
          <div className="flex items-center space-x-8">
            <Link
              href="/odc"
              className="flex items-center space-x-2.5 text-white font-bold text-lg tracking-tight hover:opacity-90 transition-opacity"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span>
                ODC <span className="text-amber-400 font-semibold">SuperAdmin</span>
              </span>
            </Link>

            {/* Desktop Links */}
            <div className="hidden md:flex items-center space-x-1">
              {navLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.name}
                    href={link.href}
                    className={`flex items-center space-x-2 px-3.5 py-2 rounded-md text-sm font-medium transition-colors ${
                      link.isActive
                        ? 'bg-zinc-800 text-white shadow-inner'
                        : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{link.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Right Action: User & Sign Out */}
          <div className="hidden md:flex items-center space-x-4">
            <div className="flex items-center space-x-2.5 px-3 py-1.5 rounded-full bg-zinc-800/80 border border-zinc-700/60 text-xs text-zinc-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="font-mono text-zinc-400 truncate max-w-[180px]">{userEmail}</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                SuperAdmin
              </span>
            </div>

            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              title="Sign Out of ODC SuperAdmin"
            >
              <LogOut className="w-4 h-4" />
              <span>{isSigningOut ? 'Signing out...' : 'Sign Out'}</span>
            </button>
          </div>

          {/* Mobile hamburger */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 focus:outline-none"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-zinc-800 bg-zinc-900 px-4 pt-2 pb-4 space-y-2">
          {navLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.name}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-md text-sm font-medium ${
                  link.isActive
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{link.name}</span>
              </Link>
            );
          })}

          <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
            <div className="text-xs text-zinc-400 font-mono truncate max-w-[200px]">{userEmail}</div>
            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium text-red-400 hover:bg-red-500/10"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
