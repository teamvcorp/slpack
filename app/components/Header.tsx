import Image from "next/image";
import Navbar from "./Navbar";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-navy/10 bg-white/95 backdrop-blur-sm">
      <div className="flex items-center justify-between px-6 py-3">
        {/* Logo + Name */}
        <div className="flex items-center gap-3">
          <Image
            src="/images/logo.png"
            alt="Storm Lake Pack and Ship logo"
            width={100}
            height={100}
            className="h-[100px] w-[100px] rounded-lg object-contain"
          />
          <div>
            <h1 className="text-xl font-bold uppercase leading-tight tracking-tight text-navy">
              Storm Lake <span className="text-blue">Pack &amp; Ship</span>
            </h1>
            <p className="text-xs font-medium tracking-wide text-tan">Locally Owned &amp; Operated</p>
          </div>
        </div>
        <Navbar />
      </div>
    </header>
  );
}