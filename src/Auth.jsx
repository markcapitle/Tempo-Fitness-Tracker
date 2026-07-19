import { useState } from 'react';
import { supabase } from './supabaseClient.js';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const signUp = async () => {
    setBusy(true); setMessage('');
    const { error } = await supabase.auth.signUp({ email, password });
    setMessage(error ? error.message : 'Account created — you can log in now.');
    setBusy(false);
  };

  const logIn = async () => {
    setBusy(true); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage(error.message);
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 w-full max-w-sm">
        <h1 className="text-xl font-bold text-slate-800 mb-1">TEMPO</h1>
        <p className="text-sm text-slate-500 mb-4">Log in or create an account.</p>

        <input type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-2 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />

        <input type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />

        <div className="flex gap-2">
          <button onClick={logIn} disabled={busy}
            className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-2 rounded-lg transition disabled:opacity-50">
            Log in
          </button>
          <button onClick={signUp} disabled={busy}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2 rounded-lg transition disabled:opacity-50">
            Sign up
          </button>
        </div>

        {message && <p className="text-xs text-slate-500 mt-3">{message}</p>}
      </div>
    </div>
  );
}