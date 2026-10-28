import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthGuard } from './components/auth-guard'
import DashboardPage from './pages/DashboardPage'
import ProfilePage from './pages/ProfilePage'
import SettingsPage from './pages/SettingsPage'
import FormDetailPage from './pages/FormDetailPage'
import FormEditorPage from './pages/FormEditorPage'
import PublicFormPage from './pages/PublicFormPage'
import TestimonialDetailPage from './pages/TestimonialDetailPage'
import IntegrationsPage from './pages/IntegrationsPage'
import SecurityPage from './pages/SecurityPage'
import NotificationsPage from './pages/NotificationsPage'
import { BusinessDirectoryPage, DirectoryAuth, DirectoryDashboard, DirectoryHome, DirectoryModeration, DirectoryPrinciples, ManageDirectoryBusiness } from './pages/DirectoryPages'
import { DonationPage, ManageDonationsPage } from './pages/DonationPages'
import './App.css'

// Apply saved theme before first render to avoid flash
const savedTheme = localStorage.getItem('rk-theme')
if (savedTheme === 'light') {
  document.documentElement.classList.add('light')
}

function App() {
  const location = useLocation()

  return (
    <div key={location.key} className="animate-in fade-in slide-in-from-bottom-3 duration-200">
      <Routes location={location}>
        <Route
          path="/login"
          element={<DirectoryAuth />}
        />
        <Route path="/signup" element={<DirectoryAuth />} />
        <Route path="/" element={<DirectoryHome />} />
        <Route path="/business/:domain" element={<BusinessDirectoryPage />} />
        <Route path="/principles" element={<DirectoryPrinciples />} />
        <Route path="/donate" element={<DonationPage />} />
        <Route path="/donations" element={<Navigate to="/donate" replace />} />

        {/* Public Form Route */}
        <Route path="/f/:slug" element={<PublicFormPage />} />

        {/* Protected Routes */}
        <Route element={<AuthGuard />}>
          <Route path="/dashboard" element={<DirectoryDashboard />} />
          <Route path="/moderation" element={<DirectoryModeration />} />
          <Route path="/donations/manage" element={<ManageDonationsPage />} />
          <Route path="/business/:domain/manage" element={<ManageDirectoryBusiness />} />
          <Route path="/workspace" element={<DashboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/integrations" element={<IntegrationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/forms/:id" element={<FormDetailPage />} />
          <Route path="/forms/:id/edit" element={<FormEditorPage />} />
          <Route path="/forms/:formId/testimonials/:id" element={<TestimonialDetailPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export default App
