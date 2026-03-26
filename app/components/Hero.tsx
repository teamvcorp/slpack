import Image from "next/image";

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      <Image
        src="/images/frontdesk.jpeg"
        alt="Storm Lake Pack and Ship"
        width={1200}
        height={500}
        className="block h-[400px] w-full object-cover"
      />
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-navy/60" />
      {/* Centered text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Your One-Stop Ship &amp; Print Shop
        </h1>
        <h3 className="mt-4 max-w-xl text-lg font-medium text-white/80">
          Fast, affordable shipping, professional packing, and quality printing — all under one roof in Storm Lake.
        </h3>
      </div>
    </section>
  );
}