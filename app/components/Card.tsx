import Link from "next/link";

interface CardProps {
  title: string;
  icon: string;
  features: string[];
  /** When set, the whole card links here and shows a call-to-action. */
  href?: string;
  cta?: string;
}

export default function Card({ title, icon, features, href, cta }: CardProps) {
  const base =
    "rounded-xl border border-navy/10 bg-cream px-6 py-6 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md";

  const inner = (
    <>
      <span className="text-3xl">{icon}</span>
      <h3 className="mt-3 text-lg font-semibold text-navy">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-navy/70">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <span className="mt-0.5 text-blue">•</span>
            {feature}
          </li>
        ))}
      </ul>
      {href && (
        <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue">
          {cta ?? "Learn more"} <span aria-hidden>→</span>
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`block ${base} hover:border-blue/40`}>
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}
