import { AuthProvider } from './hooks/useAuth';
import AppShell from './components/shell/AppShell';
import ErrorBoundary from './components/shell/ErrorBoundary';
import '@fontsource/poppins/latin-300.css';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/inter/latin-300.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/animations.css';
import './styles/shell.css';
import './styles/liquid-glass.css';

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <AppShell />
      </ErrorBoundary>
    </AuthProvider>
  );
}
