export function Footer() {
  return (
    <footer className="mt-12 border-t border-navy/10 bg-navy px-6 py-8 text-center text-sm text-white/70">
      <p className="font-semibold text-white">Storm Lake Pack &amp; Ship</p>
      <p className="mt-2">
        <a href="/admin" className="inline-flex items-center gap-2 text-white/70 hover:text-white" aria-label="Admin">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M12 17a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
            <path fillRule="evenodd" d="M6 10V8a6 6 0 1112 0v2h1a1 1 0 011 1v8a1 1 0 01-1 1H5a1 1 0 01-1-1v-8a1 1 0 011-1h1zm2-2a4 4 0 118 0v2H8V8z" clipRule="evenodd" />
          </svg>
          Admin
        </a>
      </p>
      <p className="mt-1">503 Lake Ave, Storm Lake, Iowa 50588</p>
      <p className="mt-1">(712) 560-1128 &middot; shipit@slpacknship.com</p>
      <p className="mt-4 text-white/40">&copy; 2026 Storm Lake Pack &amp; Ship. All rights reserved.</p>
    </footer>
  );
}