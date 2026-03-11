import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import VerifyEmail from "./pages/VerifyEmail";
import AdminHome from "./pages/AdminHome";
import SLFPortal from "./pages/SLFPortal";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Client Side */}
        <Route path="/" element={<SLFPortal />} />
        <Route path="/slf-monitoring" element={<SLFPortal />} />

        {/* Admin Side */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/admin" element={<AdminHome />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
