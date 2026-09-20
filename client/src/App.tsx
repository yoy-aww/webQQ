import { Routes, Route } from 'react-router-dom';
import { useStore } from './store';
import { LoginPage } from './pages/LoginPage';
import { MainPanel } from './pages/MainPanel';

export function App() {
  const me = useStore((s) => s.me);

  if (!me) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="*" element={<MainPanel />} />
    </Routes>
  );
}

export default App;
