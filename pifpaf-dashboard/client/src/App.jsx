import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import BloggerProfile from './pages/BloggerProfile';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/blogger/:username" element={<BloggerProfile />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;