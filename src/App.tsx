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
import AdminExpenses from "@/pages/admin/Expenses";
import AdminJobStates from "@/pages/admin/JobStates";
import AdminSettings from "@/pages/admin/Settings";
import AdminSupplyHouses from "@/pages/admin/SupplyHouses";
import AdminUsers from "@/pages/admin/Users";
import TokenForm from "@/pages/forms/TokenForm";
import DailyCheckInForm from "@/pages/forms/DailyCheckInForm";
import InspectionDateForm from "@/pages/forms/InspectionDateForm";
import InspectionFixDetailsForm from "@/pages/forms/InspectionFixDetailsForm";
import WalkthroughPunchListForm from "@/pages/forms/WalkthroughPunchListForm";
import QuickLogForm from "@/pages/forms/QuickLogForm";
import Login from "@/pages/auth/Login";
import AuthCallback from "@/pages/auth/AuthCallback";
import DecisionConfirm from "@/pages/actions/DecisionConfirm";
import CompletionReports from "@/pages/reports/CompletionReports";
import WeeklyReport from "@/pages/reports/WeeklyReport";
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
            {/* Standalone login door (no app shell, no session required) */}
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Token-gated forms (no app shell, no session required) */}
            <Route path="/forms/daily-check-in" element={
              <TokenForm tokenAction="daily_check_in" title="Daily Check-In">
                {(payload) => <DailyCheckInForm payload={payload} />}
              </TokenForm>
            } />
            <Route path="/forms/inspection-date" element={
              <TokenForm tokenAction="inspection_date" title="Set Inspection Date">
                {(payload) => <InspectionDateForm payload={payload} />}
              </TokenForm>
            } />
            <Route path="/action/decision" element={<DecisionConfirm />} />
            <Route path="/forms/inspection-fix-details" element={
              <TokenForm tokenAction="inspection_fix_details" title="Inspection Fix Details">
                {(payload) => <InspectionFixDetailsForm payload={payload} />}
              </TokenForm>
            } />
            <Route path="/forms/walkthrough-punch-list" element={
              <TokenForm tokenAction="walkthrough_punch_details" title="Walkthrough Punch List">
                {(payload) => <WalkthroughPunchListForm payload={payload} />}
              </TokenForm>
            } />
            <Route path="/forms/quick-log" element={
              <TokenForm tokenAction="quick_log" title="Quick Log">
                {(payload) => <QuickLogForm payload={payload} />}
              </TokenForm>
            } />
            <Route path="/crew-completion" element={<TokenForm tokenAction="crew_completion" title="Crew Completion" />} />
            <Route path="/action/confirm" element={<TokenForm tokenAction="confirm" title="Confirm Action" consumeOnLoad />} />

            {/* App shell (session required) */}
            <Route element={<AppShell />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/jobs" element={<JobsList />} />
              <Route path="/jobs/:id" element={<JobDetail />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/reports/completion" element={<CompletionReports />} />
              <Route path="/reports/weekly-preview" element={<WeeklyReport />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
              <Route path="/admin/job-states" element={<AdminJobStates />} />
              <Route path="/admin/supply-houses" element={<AdminSupplyHouses />} />
              <Route path="/admin/expenses" element={<AdminExpenses />} />
              <Route path="/admin/users" element={<AdminUsers />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </SessionProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
