export default function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-zone" />
        Zone
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-sky-500 ring-2 ring-sky-200" />
        You Are Here
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-red-200" />
        Destination
      </span>
    </div>
  );
}
