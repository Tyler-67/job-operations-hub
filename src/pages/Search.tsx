// /search — thin wrapper around the shared GlobalSearch (the Dashboard embeds the same
// component in compact form between Active jobs and the Office queue).
import GlobalSearch from "@/components/GlobalSearch";

export default function SearchPage() {
  return <GlobalSearch />;
}
