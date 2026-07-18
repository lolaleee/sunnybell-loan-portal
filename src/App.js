import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import LoginPage from './LoginPage';
import SetNewPassword from './SetNewPassword';
import EmployeeDashboard from './EmployeeDashboard';
import HRDashboard from './HRDashboard';
import ContractorDashboard from './ContractorDashboard';
import './App.css';

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    // Check if already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for login/logout changes
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
        setLoading(false);
        return;
      }

      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Auto-logout after 15 minutes of no activity, when someone is logged in
  useEffect(() => {
    if (!session) return;

    const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
    let timer;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
      }, TIMEOUT_MS);
    };

    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach((evt) => window.addEventListener(evt, resetTimer));
    resetTimer();

    return () => {
      clearTimeout(timer);
      activityEvents.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [session]);

  const fetchProfile = async (userId) => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
    } else {
      setProfile(data);
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (isRecovery) {
    return (
      <SetNewPassword
        onDone={() => {
          setIsRecovery(false);
          supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            if (session) fetchProfile(session.user.id);
          });
        }}
      />
    );
  }

  if (!session || !profile) {
    return <LoginPage />;
  }

  // Route to the right dashboard based on role
  if (profile.role === 'hr') {
    return <HRDashboard profile={profile} onLogout={handleLogout} />;
  }

  if (profile.role === 'contractor') {
    return <ContractorDashboard profile={profile} onLogout={handleLogout} />;
  }

  return <EmployeeDashboard profile={profile} onLogout={handleLogout} />;
}

export default App;
