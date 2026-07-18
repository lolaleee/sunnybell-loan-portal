import React, { useState } from 'react';
import { supabase } from './supabaseClient';

function SetNewPassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError('Error: ' + error.message);
    } else {
      onDone();
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <img src="/favicon.png" alt="Sunnybell Height Concept Ltd" className="login-logo" style={{ width: '64px' }} />
        <h1>Set a New Password</h1>
        <p>Choose a new password for your account</p>

        <form onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}

          <div className="login-field">
            <label>New Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="login-field">
            <label>Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Save New Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default SetNewPassword;
