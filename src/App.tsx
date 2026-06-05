import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/lib/session";
import AppShell from "@/components/AppShell";
import Dashboard from "@/pages/Dashboard";
import JobDetail from "@/pages/jobs/JobDetail";
import JobsList from "@/pages/jobs/JobsList";
import SearchPage from "@/pages/Search";
import AdminJobStates from "@/pages/admin/JobStates";
import PlaceholderPage from "@/pages/PlaceholderPage";
import TokenForm from "@/pages/forms/TokenForm";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <SessionProvider>
          <Routes>
            {/* Token-gated forms (no app shell, no session required) */}
            <Route path="/forms/daily-check-in" element={<TokenForm tokenAction="daily_check_in" title="Daily Check-In" />} />
            <Route path="/forms/inspection-date" element={<TokenForm tokenAction="inspection_date" title="Set Inspection Date" />} />
            <Route path="/forms/inspection-fix-details" element={<TokenForm tokenAction="inspection_fix_details" title="Inspection Fix Details" />} />
            <Route path="/forms/walkthrough-punch-list" element={<TokenForm tokenAction="walkthrough_punch_list" title="Walkthrough Punch List" />} />
            <Route path="/forms/quick-log" element={<TokenForm tokenAction="quick_log" title="Quick Log" />} />
            <Route path="/crew-completion" element={<TokenForm tokenAction="crew_completion" title="Crew Completion" />} />
            <Route path="/action/confirm" element={<TokenForm tokenAction="confirm" title="Confirm Action" />} />

            {/* App shell (session required) */}
            <Route element={<AppShell />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/jobs" element={<JobsList />} />
              <Route path="/jobs/:id" element={<JobDetail />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/reports/completion" element={<PlaceholderPage title="Completion Reports" />} />
              <Route path="/reports/weekly-preview" element={<PlaceholderPage title="Weekly Report Preview" />} />
              <Route path="/admin/settings" element={<PlaceholderPage title="Company Settings" note="Company variables (check-in time, owner/office/supply contacts, brand, defaults) land in Phase 2." />} />
              <Route path="/admin/job-states" element={<AdminJobStates />} />
              <Route path="/admin/supply-houses" element={<PlaceholderPage title="Supply Houses" />} />
              <Route path="/admin/expenses" element={<PlaceholderPage title="Expenses & PO Value Entry" />} />
              <Route path="/admin/users" element={<PlaceholderPage title="App Users & Roles" />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </SessionProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
