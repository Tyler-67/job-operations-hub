// Replaced by /dashboard via App router. Kept as a redirect-safe fallback.
import { Navigate } from "react-router-dom";
export default function Index() { return <Navigate to="/dashboard" replace />; }
