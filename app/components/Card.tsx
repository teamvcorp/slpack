interface CardProps {
  title: string;
  icon: string;
  features: string[];
}

export default function Card({ title, icon, features }: CardProps) {
  return (
    <div className="rounded-xl border border-navy/10 bg-cream px-6 py-6 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
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
    </div>
  );
}