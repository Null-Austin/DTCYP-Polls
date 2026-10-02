import pkg from "@/package.json" with { type: "json" };

export default function VersionText() {
  return pkg.version;
}