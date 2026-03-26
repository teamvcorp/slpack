import Image from "next/image";

export default function Hero() {
  return (
    <section className="relative overflow-hidden rounded-xl bg-cream">
      <div className="mx-auto max-w-7xl">
        <Image
          src="/images/frontdesk.jpeg"
          alt="Storm Lake Pack and Ship"
          width={1200}
          height={500}
          className="h-[350px] w-full object-cover transition-transform duration-500 hover:scale-105"
        />
      </div>
    </section>
  );
}