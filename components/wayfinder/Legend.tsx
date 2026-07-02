const ITEMS: { category: string; label: string; className: string }[] = [
  { category: 'zone', label: 'Zone', className: 'bg-zone' },
  { category: 'room', label: 'Room', className: 'bg-room' },
  { category: 'facility', label: 'Facility', className: 'bg-facility' },
];

export default function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
      {ITEMS.map((item) => (
        <span key={item.category} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${item.className}`} />
          {item.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200" />
        Start
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-red-200" />
        Destination
      </span>
    </div>
  );
}
