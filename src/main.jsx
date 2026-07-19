import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import WorkoutTracker from './WorkoutTracker.jsx';
import Auth from './Auth.jsx';
import { supabase } from './supabaseClient.js';
import './index.css';

function Root() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if someone's already logged in when the app starts
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    // React whenever they log in or out
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return null;                 // brief blank while we check
  if (!session) return <Auth />;            // nobody logged in → show login
  return <WorkoutTracker />;                // logged in → show the app
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);