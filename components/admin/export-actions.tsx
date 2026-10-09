"use client"

const FORMATS = [
  { format: "zip", label: "ZIP archive" },
  { format: "json", label: "JSON" },
  { format: "csv", label: "CSV" },
]

export default function ExportActions() {
  return (
    <div className="actions">
      {FORMATS.map(({ format, label }) => (
        <a
          key={format}
          className="btn btn--sm"
          href={`/api/admin/export?format=${format}`}
          onClick={(event) => {
            if (!confirm("This export may contain response data and link tokens. Store it securely. Continue?")) event.preventDefault()
          }}
        >
          {label}
        </a>
      ))}
    </div>
  )
}
