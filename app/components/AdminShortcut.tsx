"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Invisible component — listens for Ctrl+Shift held for 600ms on the landing
 * page and navigates to /admin/login.
 */
export default function AdminShortcut() {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const held = new Set<string>();

    function onKeyDown(e: KeyboardEvent) {
      held.add(e.key);
      if (held.has('Control') && held.has('Shift') && !timer) {
        timer = setTimeout(() => {
          router.push('/admin/login');
        }, 600);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      held.delete(e.key);
      if (timer && (!held.has('Control') || !held.has('Shift'))) {
        clearTimeout(timer);
        timer = null;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  return null;
}
