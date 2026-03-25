import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { ListTodo, Users, Briefcase, BarChart3, FileText, Settings, Zap } from 'lucide-react';
import { TaskBoard } from './pages/TaskBoard';
import { Sessions } from './pages/Sessions';
import { Decisions } from './pages/Decisions';
import { Quality } from './pages/Quality';
import { Artifacts } from './pages/Artifacts';
import { Settings as SettingsPage } from './pages/Settings';
import { Wheelhaus } from './pages/Wheelhaus';
import { ProjectSwitcher } from './components/ProjectSwitcher';
import { ConnectionStatus } from './components/ConnectionStatus';
import { CommandPalette, useCommandPalette } from './components/CommandPalette';
import { useDashboardRealtime } from './hooks/useRealtimeData';
import './App.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchInterval: 10000,
    },
  },
});

function Layout({ children }: { children: React.ReactNode }) {
  const { isConnected, lastUpdate, forceRefresh } = useDashboardRealtime();
  const { open: commandPaletteOpen, setOpen: setCommandPaletteOpen } = useCommandPalette();

  return (
    <div className="app-layout">
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
      <nav className="sidebar">
        <div className="logo">
          <h1>Enginehaus</h1>
          <span className="tagline">Mission Control</span>
        </div>

        <div className="project-section">
          <ProjectSwitcher />
        </div>

        <div className="nav-links">
          <NavLink to="/" className={({ isActive }) => isActive ? 'active wheelhaus-link' : 'wheelhaus-link'}>
            <Zap size={20} />
            <span>Wheelhaus</span>
          </NavLink>
          <NavLink to="/tasks" className={({ isActive }) => isActive ? 'active' : ''}>
            <ListTodo size={20} />
            <span>Tasks</span>
          </NavLink>
          <NavLink to="/sessions" className={({ isActive }) => isActive ? 'active' : ''}>
            <Users size={20} />
            <span>Sessions</span>
          </NavLink>
          <NavLink to="/decisions" className={({ isActive }) => isActive ? 'active' : ''}>
            <Briefcase size={20} />
            <span>Decisions</span>
          </NavLink>
          <NavLink to="/artifacts" className={({ isActive }) => isActive ? 'active' : ''}>
            <FileText size={20} />
            <span>Artifacts</span>
          </NavLink>
          <NavLink to="/quality" className={({ isActive }) => isActive ? 'active' : ''}>
            <BarChart3 size={20} />
            <span>Quality</span>
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>
            <Settings size={20} />
            <span>Settings</span>
          </NavLink>
        </div>

        <div className="nav-footer">
          <ConnectionStatus
            isConnected={isConnected}
            lastUpdate={lastUpdate}
            onRefresh={forceRefresh}
          />
        </div>
      </nav>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            {/* Wheelhaus is home - consolidated from Dashboard */}
            <Route path="/" element={<Wheelhaus />} />
            <Route path="/wheelhaus" element={<Navigate to="/" replace />} />
            <Route path="/tasks" element={<TaskBoard />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/decisions" element={<Decisions />} />
            <Route path="/artifacts" element={<Artifacts />} />
            {/* Quality now includes Review tab */}
            <Route path="/quality" element={<Quality />} />
            <Route path="/review" element={<Navigate to="/quality?tab=review" replace />} />
            {/* Settings now includes Audit Log tab */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/audit" element={<Navigate to="/settings?tab=history" replace />} />
            {/* Legacy routes redirect */}
            <Route path="/visualizations" element={<Navigate to="/?view=graph" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
